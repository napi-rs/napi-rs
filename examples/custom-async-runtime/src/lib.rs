use std::{
  collections::{HashMap, VecDeque},
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Condvar, Mutex, MutexGuard, Once, OnceLock, Weak,
  },
  task::{Context, Poll},
};

#[cfg(any(not(target_family = "wasm"), custom_runtime_wasi_threads))]
use std::thread;
#[cfg(not(target_family = "wasm"))]
use std::{
  path::Path,
  task::Waker,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
use std::sync::mpsc;

use futures::task::{waker_ref, ArcWake};
use napi::bindgen_prelude::{
  register_async_runtime, spawn_blocking_on_custom_runtime, try_block_on_custom_runtime,
  try_shutdown_async_runtime, try_start_async_runtime, AsyncGenerator, AsyncRuntime,
  AsyncRuntimeGuard, AsyncRuntimeRejection, AsyncRuntimeTask, Buffer, Env, Error, FnArgs,
  JsObjectValue, JsValue, Object, PromiseRaw, Result, Status, Unknown,
};
#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
use napi::bindgen_prelude::{spawn_blocking, spawn_on_custom_runtime, JoinError};
#[cfg(not(target_family = "wasm"))]
use napi::bindgen_prelude::{AsyncBlock, AsyncBlockBuilder};
use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;

#[cfg(not(target_family = "wasm"))]
mod cancellation_order;

static RUNTIME_STATE: OnceLock<Arc<RuntimeState>> = OnceLock::new();
static RUNTIME_REGISTRATION: Once = Once::new();
static BACKEND_IDENTITY: OnceLock<String> = OnceLock::new();
#[cfg(not(target_family = "wasm"))]
static EXTERNALLY_RETAINED_TASK_WAKER: Mutex<Option<Waker>> = Mutex::new(None);

type BlockingWork = Box<dyn FnOnce() + Send + 'static>;

#[cfg(not(target_family = "wasm"))]
const BLOCKING_WORKER_COUNT: usize = 2;
#[cfg(not(target_family = "wasm"))]
const BLOCKING_QUEUE_CAPACITY: usize = 64;
#[cfg(all(target_family = "wasm", not(custom_runtime_wasi_threads)))]
const THREADLESS_WASI_BLOCKING_UNSUPPORTED: &str =
  "custom async runtime blocking work is unsupported on threadless wasm32-wasip1";

#[derive(Default)]
struct SchedulerState {
  queue: VecDeque<Arc<Task>>,
  tasks: HashMap<usize, Arc<Task>>,
  task_refs: Vec<Weak<Task>>,
  block_on_refs: Vec<Weak<BlockOnWaker>>,
  accepting: bool,
  generation: usize,
  next_task_id: usize,
  draining: bool,
  active_polls: usize,
}

impl SchedulerState {
  fn reserve_task_id(&mut self) -> usize {
    loop {
      self.next_task_id = self.next_task_id.wrapping_add(1);
      if !self.tasks.contains_key(&self.next_task_id) {
        return self.next_task_id;
      }
    }
  }
}

#[cfg(not(target_family = "wasm"))]
#[derive(Default)]
struct BlockingPoolState {
  queue: VecDeque<BlockingWork>,
  workers: Vec<thread::JoinHandle<()>>,
  accepting: bool,
  active: usize,
  generation: usize,
}

#[derive(Default)]
struct RuntimeState {
  scheduler: Mutex<SchedulerState>,
  scheduler_idle: Condvar,
  #[cfg(not(target_family = "wasm"))]
  blocking_pool: Mutex<BlockingPoolState>,
  #[cfg(not(target_family = "wasm"))]
  blocking_ready: Condvar,
  accepting: AtomicBool,
  reject_next_spawn: AtomicBool,
  defer_next_spawn_drain: AtomicBool,
  defer_next_task_wake: AtomicBool,
  fail_next_shutdown: AtomicBool,
  panic_next_shutdown: AtomicBool,
  #[cfg(not(target_family = "wasm"))]
  start_transition_barrier: Mutex<Option<LifecycleHookBarrier>>,
  #[cfg(not(target_family = "wasm"))]
  shutdown_transition_barrier: Mutex<Option<LifecycleHookBarrier>>,
  #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
  shutdown_probe: Mutex<Option<ShutdownProbe>>,
  #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
  shutdown_probe_starts: AtomicUsize,
  #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
  shutdown_probe_stops: AtomicUsize,
  #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
  shutdown_probe_active: AtomicBool,
  module_init_calls: AtomicUsize,
  runtime_registration_calls: AtomicUsize,
  backend_drop_calls: AtomicUsize,
  start_calls: AtomicUsize,
  shutdown_calls: AtomicUsize,
  enter_calls: AtomicUsize,
  exit_calls: AtomicUsize,
  active_guards: AtomicUsize,
  spawn_calls: AtomicUsize,
  synchronous_spawn_completions: AtomicUsize,
  spawn_blocking_calls: AtomicUsize,
  wake_calls: AtomicUsize,
  task_polls: AtomicUsize,
  completed_tasks: AtomicUsize,
  block_on_calls: AtomicUsize,
  block_on_polls: AtomicUsize,
}

impl RuntimeState {
  fn start_scheduler(&self) -> Result<()> {
    let mut scheduler = lock(&self.scheduler);
    if scheduler.accepting {
      self.accepting.store(true, Ordering::Release);
      return Ok(());
    }
    scheduler.task_refs.retain(|task| task.strong_count() != 0);
    scheduler
      .block_on_refs
      .retain(|waker| waker.strong_count() != 0);
    if scheduler.draining
      || scheduler.active_polls != 0
      || !scheduler.tasks.is_empty()
      || !scheduler.queue.is_empty()
      || !scheduler.task_refs.is_empty()
      || !scheduler.block_on_refs.is_empty()
    {
      return Err(Error::new(
        Status::GenericFailure,
        "custom async runtime cannot restart before its previous scheduler generation is quiescent",
      ));
    }
    scheduler.generation = scheduler.generation.wrapping_add(1);
    scheduler.accepting = true;
    drop(scheduler);
    self.accepting.store(true, Ordering::Release);
    Ok(())
  }

  fn register_task(
    self: &Arc<Self>,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<Arc<Task>, AsyncRuntimeTask> {
    let mut scheduler = lock(&self.scheduler);
    if !scheduler.accepting {
      return Err(task);
    }
    let id = scheduler.reserve_task_id();
    let task = Arc::new(Task {
      id,
      generation: scheduler.generation,
      future: Mutex::new(Some(Box::pin(task))),
      runtime: Arc::downgrade(self),
      queued: AtomicBool::new(true),
      cancelled: AtomicBool::new(false),
    });
    scheduler.task_refs.retain(|task| task.strong_count() != 0);
    scheduler.task_refs.push(Arc::downgrade(&task));
    scheduler.tasks.insert(id, Arc::clone(&task));
    scheduler.queue.push_back(Arc::clone(&task));
    Self::notify_block_on_waiters(&mut scheduler);
    Ok(task)
  }

  fn enqueue(self: &Arc<Self>, task: Arc<Task>) -> bool {
    if task.cancelled.load(Ordering::Acquire) {
      return false;
    }
    if task.queued.swap(true, Ordering::AcqRel) {
      return false;
    }
    let mut scheduler = lock(&self.scheduler);
    let registered = scheduler
      .tasks
      .get(&task.id)
      .is_some_and(|registered| Arc::ptr_eq(registered, &task));
    if !scheduler.accepting
      || scheduler.generation != task.generation
      || !registered
      || task.cancelled.load(Ordering::Acquire)
    {
      task.queued.store(false, Ordering::Release);
      return false;
    }
    scheduler.queue.push_back(task);
    Self::notify_block_on_waiters(&mut scheduler);
    true
  }

  fn notify_block_on_waiters(scheduler: &mut SchedulerState) {
    scheduler
      .block_on_refs
      .retain(|waker| waker.strong_count() != 0);
    for waiter in &scheduler.block_on_refs {
      if let Some(waiter) = waiter.upgrade() {
        waiter.notify();
      }
    }
  }

  fn drain(self: &Arc<Self>) {
    {
      let mut scheduler = lock(&self.scheduler);
      if scheduler.draining || !scheduler.accepting || scheduler.queue.is_empty() {
        return;
      }
      scheduler.draining = true;
    }

    let mut drain = DrainGuard {
      runtime: Arc::clone(self),
      active: true,
    };
    while let Some(task) = self.next_task() {
      task.queued.store(false, Ordering::Release);
      task.poll();
    }
    drain.active = false;
  }

  fn has_ready_tasks(&self) -> bool {
    let scheduler = lock(&self.scheduler);
    scheduler.accepting && !scheduler.queue.is_empty()
  }

  fn next_task(&self) -> Option<Arc<Task>> {
    let mut scheduler = lock(&self.scheduler);
    if scheduler.accepting {
      if let Some(task) = scheduler.queue.pop_front() {
        return Some(task);
      }
    }
    scheduler.draining = false;
    self.scheduler_idle.notify_all();
    None
  }

  fn finish_drain(&self) {
    let mut scheduler = lock(&self.scheduler);
    scheduler.draining = false;
    self.scheduler_idle.notify_all();
  }

  fn begin_poll(self: &Arc<Self>, task: &Arc<Task>) -> Option<PollGuard> {
    let mut scheduler = lock(&self.scheduler);
    let registered = scheduler
      .tasks
      .get(&task.id)
      .is_some_and(|registered| Arc::ptr_eq(registered, task));
    if !scheduler.accepting
      || scheduler.generation != task.generation
      || !registered
      || task.cancelled.load(Ordering::Acquire)
    {
      return None;
    }
    scheduler.active_polls += 1;
    Some(PollGuard {
      runtime: Arc::clone(self),
    })
  }

  fn finish_poll(&self) {
    let mut scheduler = lock(&self.scheduler);
    scheduler.active_polls -= 1;
    self.scheduler_idle.notify_all();
  }

  fn finish_task(&self, task: &Task) {
    let mut scheduler = lock(&self.scheduler);
    if scheduler
      .tasks
      .get(&task.id)
      .is_some_and(|registered| std::ptr::eq(Arc::as_ptr(registered), task))
    {
      scheduler.tasks.remove(&task.id);
    }
  }

  fn shutdown_scheduler(&self) {
    self.accepting.store(false, Ordering::Release);
    let (tasks, queued, task_refs, block_on_refs) = {
      let mut scheduler = lock(&self.scheduler);
      scheduler.accepting = false;
      let tasks = std::mem::take(&mut scheduler.tasks)
        .into_values()
        .collect::<Vec<_>>();
      let queued = std::mem::take(&mut scheduler.queue);
      let task_refs = std::mem::take(&mut scheduler.task_refs);
      let block_on_refs = std::mem::take(&mut scheduler.block_on_refs);
      (tasks, queued, task_refs, block_on_refs)
    };

    for task in &tasks {
      task.cancel();
    }
    drop(queued);

    let mut scheduler = lock(&self.scheduler);
    while scheduler.draining || scheduler.active_polls != 0 {
      scheduler = self
        .scheduler_idle
        .wait(scheduler)
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
    drop(scheduler);
    drop(tasks);

    // Every scheduler-owned strong reference is gone at this point. An
    // upgrade can therefore only come from a reference retained outside the
    // scheduler, including a cloned task Waker whose vtable lives in this
    // addon image. Returning would let Node unload code that the reference can
    // still invoke, so the unsafe AsyncRuntime contract requires failing
    // closed.
    let retained_task_waker = task_refs.into_iter().any(|task| task.upgrade().is_some());
    let retained_block_on_waker = block_on_refs
      .into_iter()
      .any(|waker| waker.upgrade().is_some());
    if retained_task_waker || retained_block_on_waker {
      eprintln!(
        "custom async runtime shutdown found an externally retained task waker or block_on waker"
      );
      std::process::abort();
    }
  }

  #[cfg(not(target_family = "wasm"))]
  fn start_blocking_pool(self: &Arc<Self>) -> Result<()> {
    let mut pool = lock(&self.blocking_pool);
    if pool.accepting {
      return Ok(());
    }
    if pool.active != 0 || !pool.queue.is_empty() || !pool.workers.is_empty() {
      return Err(Error::new(
        Status::GenericFailure,
        "custom async runtime cannot restart before its previous blocking worker generation is quiescent",
      ));
    }

    pool.generation = pool.generation.wrapping_add(1);
    let generation = pool.generation;
    pool.accepting = true;
    for index in 0..BLOCKING_WORKER_COUNT {
      let state = Arc::clone(self);
      match thread::Builder::new()
        .name(format!("napi-custom-runtime-blocking-{generation}-{index}"))
        .spawn(move || state.blocking_worker_loop())
      {
        Ok(worker) => pool.workers.push(worker),
        Err(error) => {
          pool.accepting = false;
          let queued = std::mem::take(&mut pool.queue);
          let workers = std::mem::take(&mut pool.workers);
          self.blocking_ready.notify_all();
          drop(pool);
          drop(queued);
          let mut worker_panicked = false;
          for worker in workers {
            worker_panicked |= worker.join().is_err();
          }
          let suffix = if worker_panicked {
            "; a partially started blocking worker panicked during rollback"
          } else {
            ""
          };
          return Err(Error::new(
            Status::GenericFailure,
            format!("failed to start custom runtime blocking worker: {error}{suffix}"),
          ));
        }
      }
    }
    Ok(())
  }

  #[cfg(not(target_family = "wasm"))]
  fn submit_blocking_work(&self, work: BlockingWork) -> std::result::Result<(), BlockingWork> {
    let mut pool = lock(&self.blocking_pool);
    if !pool.accepting || pool.queue.len() >= BLOCKING_QUEUE_CAPACITY {
      return Err(work);
    }
    pool.queue.push_back(work);
    self.blocking_ready.notify_one();
    Ok(())
  }

  #[cfg(not(target_family = "wasm"))]
  fn blocking_worker_loop(self: Arc<Self>) {
    loop {
      let work = {
        let mut pool = lock(&self.blocking_pool);
        while pool.accepting && pool.queue.is_empty() {
          pool = self
            .blocking_ready
            .wait(pool)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        if !pool.accepting {
          return;
        }
        let work = pool
          .queue
          .pop_front()
          .expect("an accepting blocking worker wakes only for queued work");
        pool.active += 1;
        work
      };
      let _active = BlockingWorkGuard {
        runtime: Arc::clone(&self),
      };
      work();
    }
  }

  #[cfg(not(target_family = "wasm"))]
  fn finish_blocking_work(&self) {
    let mut pool = lock(&self.blocking_pool);
    pool.active -= 1;
  }

  #[cfg(not(target_family = "wasm"))]
  fn shutdown_blocking_pool(&self) -> Result<()> {
    let (queued, workers) = {
      let mut pool = lock(&self.blocking_pool);
      pool.accepting = false;
      let queued = std::mem::take(&mut pool.queue);
      let workers = std::mem::take(&mut pool.workers);
      self.blocking_ready.notify_all();
      (queued, workers)
    };

    drop(queued);
    let mut worker_panicked = false;
    for worker in workers {
      worker_panicked |= worker.join().is_err();
    }
    let pool = lock(&self.blocking_pool);
    debug_assert_eq!(pool.active, 0);
    debug_assert!(pool.queue.is_empty());
    debug_assert!(pool.workers.is_empty());
    drop(pool);

    if worker_panicked {
      Err(Error::new(
        Status::GenericFailure,
        "custom async runtime blocking worker panicked",
      ))
    } else {
      Ok(())
    }
  }

  #[cfg(not(target_family = "wasm"))]
  fn arm_lifecycle_hook_barrier(
    &self,
    hook: LifecycleHook,
    entered_path: String,
    release_path: String,
  ) -> Result<()> {
    let mut barrier = lock(match hook {
      LifecycleHook::Start => &self.start_transition_barrier,
      LifecycleHook::Shutdown => &self.shutdown_transition_barrier,
    });
    if barrier.is_some() {
      return Err(Error::new(
        Status::GenericFailure,
        format!("custom runtime {hook} barrier is already armed"),
      ));
    }
    *barrier = Some(LifecycleHookBarrier {
      entered_path,
      release_path,
    });
    Ok(())
  }

  #[cfg(not(target_family = "wasm"))]
  fn wait_for_lifecycle_hook_barrier(&self, hook: LifecycleHook) -> Result<()> {
    let barrier = lock(match hook {
      LifecycleHook::Start => &self.start_transition_barrier,
      LifecycleHook::Shutdown => &self.shutdown_transition_barrier,
    })
    .take();
    let Some(barrier) = barrier else {
      return Ok(());
    };

    write_file(Path::new(&barrier.entered_path), "entered").map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("failed to publish custom runtime {hook} barrier: {error}"),
      )
    })?;
    if !wait_for_file(Path::new(&barrier.release_path)) {
      return Err(Error::new(
        Status::GenericFailure,
        format!("timed out waiting to release custom runtime {hook} barrier"),
      ));
    }
    Ok(())
  }

  #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
  fn start_shutdown_probe(
    self: &Arc<Self>,
    started_path: String,
    stopped_path: String,
  ) -> Result<()> {
    let mut probe = lock(&self.shutdown_probe);
    if probe.is_some() {
      return Err(Error::new(
        Status::GenericFailure,
        "custom runtime shutdown probe is already running",
      ));
    }

    let (stop_tx, stop_rx) = mpsc::sync_channel(0);
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let state = Arc::clone(self);
    let worker = thread::Builder::new()
      .name("napi-custom-runtime-shutdown-probe".to_owned())
      .spawn(move || {
        state.shutdown_probe_active.store(true, Ordering::Release);
        state.shutdown_probe_starts.fetch_add(1, Ordering::Relaxed);
        let start_result = write_file(Path::new(&started_path), "started")
          .map_err(|error| format!("failed to publish shutdown probe startup: {error}"));
        let started = start_result.is_ok();
        let _ = started_tx.send(start_result);
        if started {
          let _ = stop_rx.recv();
          let _ = write_file(Path::new(&stopped_path), "stopped");
        }
        state.shutdown_probe_active.store(false, Ordering::Release);
        state.shutdown_probe_stops.fetch_add(1, Ordering::Relaxed);
      })
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("failed to start custom runtime shutdown probe: {error}"),
        )
      })?;

    match started_rx.recv_timeout(Duration::from_secs(10)) {
      Ok(Ok(())) => {
        *probe = Some(ShutdownProbe {
          stop: stop_tx,
          worker,
        });
        Ok(())
      }
      Ok(Err(error)) => {
        let _ = worker.join();
        Err(Error::new(Status::GenericFailure, error))
      }
      Err(error) => {
        drop(stop_tx);
        let _ = worker.join();
        Err(Error::new(
          Status::GenericFailure,
          format!("custom runtime shutdown probe did not start: {error}"),
        ))
      }
    }
  }

  #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
  fn stop_shutdown_probe(&self) -> Result<()> {
    let Some(probe) = lock(&self.shutdown_probe).take() else {
      return Ok(());
    };
    let _ = probe.stop.send(());
    probe.worker.join().map_err(|_| {
      Error::new(
        Status::GenericFailure,
        "custom runtime shutdown probe panicked",
      )
    })
  }
}

#[cfg(not(target_family = "wasm"))]
#[derive(Clone, Copy)]
enum LifecycleHook {
  Start,
  Shutdown,
}

#[cfg(not(target_family = "wasm"))]
impl LifecycleHook {
  fn parse(value: &str) -> Result<Self> {
    match value {
      "start" => Ok(Self::Start),
      "shutdown" => Ok(Self::Shutdown),
      _ => Err(Error::new(
        Status::InvalidArg,
        format!("unknown custom runtime lifecycle hook: {value}"),
      )),
    }
  }
}

#[cfg(not(target_family = "wasm"))]
impl std::fmt::Display for LifecycleHook {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    formatter.write_str(match self {
      Self::Start => "start",
      Self::Shutdown => "shutdown",
    })
  }
}

#[cfg(not(target_family = "wasm"))]
struct LifecycleHookBarrier {
  entered_path: String,
  release_path: String,
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
struct ShutdownProbe {
  stop: mpsc::SyncSender<()>,
  worker: thread::JoinHandle<()>,
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
#[derive(Default)]
struct DuplicateProbeRuntime {
  stopped_path: Mutex<Option<String>>,
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
impl DuplicateProbeRuntime {
  fn with_probe(started_path: String, stopped_path: String) -> Result<Self> {
    // `module_init` runs while the native loader lock is held. Keep a
    // rejected duplicate dormant: a worker started here can block on lazy
    // symbol resolution while this thread waits to join it.
    write_file(Path::new(&started_path), "started").map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("failed to publish duplicate probe startup: {error}"),
      )
    })?;
    Ok(Self {
      stopped_path: Mutex::new(Some(stopped_path)),
    })
  }
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
unsafe impl AsyncRuntime for DuplicateProbeRuntime {
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
    Err(AsyncRuntimeRejection::new(
      task,
      Error::from_reason("duplicate probe runtime does not accept tasks"),
    ))
  }

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) -> Result<()> {
    Ok(())
  }

  fn shutdown(&self) -> Result<()> {
    let Some(stopped_path) = lock(&self.stopped_path).take() else {
      return Ok(());
    };
    write_file(Path::new(&stopped_path), "stopped").map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("failed to publish duplicate probe shutdown: {error}"),
      )
    })
  }
}

struct DrainGuard {
  runtime: Arc<RuntimeState>,
  active: bool,
}

impl Drop for DrainGuard {
  fn drop(&mut self) {
    if self.active {
      self.runtime.finish_drain();
    }
  }
}

struct PollGuard {
  runtime: Arc<RuntimeState>,
}

impl Drop for PollGuard {
  fn drop(&mut self) {
    self.runtime.finish_poll();
  }
}

#[cfg(not(target_family = "wasm"))]
struct BlockingWorkGuard {
  runtime: Arc<RuntimeState>,
}

#[cfg(not(target_family = "wasm"))]
impl Drop for BlockingWorkGuard {
  fn drop(&mut self) {
    self.runtime.finish_blocking_work();
  }
}

struct Task {
  id: usize,
  generation: usize,
  future: Mutex<Option<Pin<Box<dyn Future<Output = ()> + Send + 'static>>>>,
  runtime: Weak<RuntimeState>,
  queued: AtomicBool,
  cancelled: AtomicBool,
}

impl Task {
  fn cancel(self: &Arc<Self>) {
    self.cancelled.store(true, Ordering::Release);
    self.queued.store(false, Ordering::Release);
    let future = lock(&self.future).take();
    drop(future);
    if let Some(runtime) = self.runtime.upgrade() {
      runtime.finish_task(self);
    }
  }

  fn poll(self: Arc<Self>) {
    let Some(runtime) = self.runtime.upgrade() else {
      self.cancel();
      return;
    };
    let Some(_poll) = runtime.begin_poll(&self) else {
      self.cancel();
      return;
    };
    let Some(mut future) = lock(&self.future).take() else {
      return;
    };

    runtime.task_polls.fetch_add(1, Ordering::Relaxed);
    let waker = waker_ref(&self);
    let mut context = Context::from_waker(&waker);
    match future.as_mut().poll(&mut context) {
      Poll::Ready(()) => {
        self.cancelled.store(true, Ordering::Release);
        runtime.finish_task(&self);
        runtime.completed_tasks.fetch_add(1, Ordering::Relaxed);
      }
      Poll::Pending => {
        let mut pending = Some(future);
        {
          let mut slot = lock(&self.future);
          if !self.cancelled.load(Ordering::Acquire) {
            *slot = pending.take();
          }
        }
        drop(pending);
        if self.cancelled.load(Ordering::Acquire) {
          runtime.finish_task(&self);
        }
      }
    }
  }
}

impl ArcWake for Task {
  fn wake_by_ref(task: &Arc<Self>) {
    let Some(runtime) = task.runtime.upgrade() else {
      return;
    };
    runtime.wake_calls.fetch_add(1, Ordering::Relaxed);
    if runtime.enqueue(task.clone()) && !runtime.defer_next_task_wake.swap(false, Ordering::AcqRel)
    {
      runtime.drain();
    }
  }
}

struct BlockOnWaker {
  notified: AtomicBool,
  #[cfg(any(not(target_family = "wasm"), custom_runtime_wasi_threads))]
  thread: thread::Thread,
}

impl BlockOnWaker {
  fn prepare_poll(&self) {
    self.notified.store(false, Ordering::Release);
  }

  fn notify(&self) {
    self.notified.store(true, Ordering::Release);
    #[cfg(any(not(target_family = "wasm"), custom_runtime_wasi_threads))]
    self.thread.unpark();
  }

  fn wait(&self, runtime: &RuntimeState) -> bool {
    #[cfg(any(not(target_family = "wasm"), custom_runtime_wasi_threads))]
    {
      while !self.notified.swap(false, Ordering::AcqRel) && !runtime.has_ready_tasks() {
        thread::park();
      }
      true
    }

    #[cfg(all(target_family = "wasm", not(custom_runtime_wasi_threads)))]
    {
      self.notified.swap(false, Ordering::AcqRel) || runtime.has_ready_tasks()
    }
  }
}

impl ArcWake for BlockOnWaker {
  fn wake_by_ref(waker: &Arc<Self>) {
    waker.notify();
  }
}

struct TestRuntime {
  state: Arc<RuntimeState>,
}

impl Drop for TestRuntime {
  fn drop(&mut self) {
    let _drop_calls = self
      .state
      .backend_drop_calls
      .fetch_add(1, Ordering::Relaxed)
      + 1;
    #[cfg(not(target_family = "wasm"))]
    if let Some(path) = std::env::var_os("NAPI_CUSTOM_RUNTIME_DROP_PROBE") {
      let identity = BACKEND_IDENTITY
        .get()
        .map(String::as_str)
        .unwrap_or("uninitialized");
      let _ = std::fs::write(path, format!("{identity}\n{_drop_calls}\n"));
    }
  }
}

// SAFETY: accepted tasks are tracked by weak identity until shutdown. Shutdown
// closes admission, drops every scheduler-owned future and queue reference,
// waits for active drains and polls, and aborts if any task or block_on waker
// identity still has an external strong reference. Native shutdown also drops
// queued blocking work and joins every blocking worker before checking those
// identities. Backend-owned probe threads are joined before a non-panicking
// shutdown returns.
unsafe impl AsyncRuntime for TestRuntime {
  fn spawn(
    &self,
    task: AsyncRuntimeTask,
  ) -> std::result::Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
    if self.state.reject_next_spawn.swap(false, Ordering::AcqRel) {
      return Err(AsyncRuntimeRejection::new(
        task,
        Error::new(Status::QueueFull, "custom runtime rejected the async task"),
      ));
    }
    let task = self.state.register_task(task).map_err(|task| {
      AsyncRuntimeRejection::new(
        task,
        Error::new(Status::Cancelled, "custom runtime is not accepting tasks"),
      )
    })?;
    self.state.spawn_calls.fetch_add(1, Ordering::Relaxed);
    if !self
      .state
      .defer_next_spawn_drain
      .swap(false, Ordering::AcqRel)
    {
      self.state.drain();
    }
    if lock(&task.future).is_none() {
      self
        .state
        .synchronous_spawn_completions
        .fetch_add(1, Ordering::Relaxed);
    }
    Ok(())
  }

  fn spawn_blocking(
    &self,
    work: BlockingWork,
  ) -> std::result::Result<(), AsyncRuntimeRejection<BlockingWork>> {
    if !self.state.accepting.load(Ordering::Acquire) {
      return Err(AsyncRuntimeRejection::new(
        work,
        Error::new(
          Status::Cancelled,
          "custom runtime is not accepting blocking work",
        ),
      ));
    }

    #[cfg(not(target_family = "wasm"))]
    {
      self.state.submit_blocking_work(work).map_err(|work| {
        AsyncRuntimeRejection::new(
          work,
          Error::new(
            Status::QueueFull,
            "custom runtime blocking queue is full or stopped",
          ),
        )
      })?;
      self
        .state
        .spawn_blocking_calls
        .fetch_add(1, Ordering::Relaxed);
      Ok(())
    }

    #[cfg(all(target_family = "wasm", not(custom_runtime_wasi_threads)))]
    {
      Err(AsyncRuntimeRejection::new(
        work,
        Error::new(Status::GenericFailure, THREADLESS_WASI_BLOCKING_UNSUPPORTED),
      ))
    }

    #[cfg(all(target_family = "wasm", custom_runtime_wasi_threads))]
    {
      work();
      self
        .state
        .spawn_blocking_calls
        .fetch_add(1, Ordering::Relaxed);
      Ok(())
    }
  }

  fn block_on(&self, mut future: Pin<&mut dyn Future<Output = ()>>) -> Result<()> {
    self.state.block_on_calls.fetch_add(1, Ordering::Relaxed);
    let signal = Arc::new(BlockOnWaker {
      notified: AtomicBool::new(false),
      #[cfg(any(not(target_family = "wasm"), custom_runtime_wasi_threads))]
      thread: thread::current(),
    });
    {
      let mut scheduler = lock(&self.state.scheduler);
      scheduler
        .block_on_refs
        .retain(|waker| waker.strong_count() != 0);
      scheduler.block_on_refs.push(Arc::downgrade(&signal));
    }
    let waker = waker_ref(&signal);
    let mut context = Context::from_waker(&waker);

    loop {
      signal.prepare_poll();
      self.state.block_on_polls.fetch_add(1, Ordering::Relaxed);
      if future.as_mut().poll(&mut context).is_ready() {
        return Ok(());
      }

      self.state.drain();
      if !signal.wait(&self.state) {
        return Err(Error::new(
          Status::WouldDeadlock,
          "custom runtime block_on cannot make progress without a wake",
        ));
      }
    }
  }

  fn enter(&self) -> Result<Box<dyn AsyncRuntimeGuard + '_>> {
    self.state.enter_calls.fetch_add(1, Ordering::Relaxed);
    self.state.active_guards.fetch_add(1, Ordering::Relaxed);
    Ok(Box::new(TestRuntimeGuard {
      state: self.state.clone(),
    }))
  }

  fn start(&self) -> Result<()> {
    #[cfg(not(target_family = "wasm"))]
    self
      .state
      .wait_for_lifecycle_hook_barrier(LifecycleHook::Start)?;
    #[cfg(not(target_family = "wasm"))]
    if std::env::var_os("NAPI_CUSTOM_RUNTIME_TEST_START_ERROR").is_some() {
      #[cfg(feature = "tokio-rt")]
      if let (Ok(started_path), Ok(stopped_path)) = (
        std::env::var("NAPI_CUSTOM_RUNTIME_TEST_START_PROBE_STARTED"),
        std::env::var("NAPI_CUSTOM_RUNTIME_TEST_START_PROBE_STOPPED"),
      ) {
        self
          .state
          .start_shutdown_probe(started_path, stopped_path)?;
      }
      return Err(Error::new(
        Status::GenericFailure,
        "injected custom runtime start error",
      ));
    }
    self.state.start_scheduler()?;
    #[cfg(not(target_family = "wasm"))]
    self.state.start_blocking_pool()?;
    self.state.start_calls.fetch_add(1, Ordering::Relaxed);
    Ok(())
  }

  fn shutdown(&self) -> Result<()> {
    self.state.shutdown_calls.fetch_add(1, Ordering::Relaxed);
    #[cfg(not(target_family = "wasm"))]
    cancellation_order::mark_active_poll_shutdown_entered();
    #[cfg(not(target_family = "wasm"))]
    let lifecycle_barrier = self
      .state
      .wait_for_lifecycle_hook_barrier(LifecycleHook::Shutdown);
    let fail = self.state.fail_next_shutdown.swap(false, Ordering::AcqRel);
    let panic = self.state.panic_next_shutdown.swap(false, Ordering::AcqRel);
    self.state.accepting.store(false, Ordering::Release);
    #[cfg(not(target_family = "wasm"))]
    let blocking_shutdown = self.state.shutdown_blocking_pool();
    self.state.shutdown_scheduler();
    if panic {
      panic!("injected custom runtime shutdown panic");
    }
    #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
    let probe_shutdown = self.state.stop_shutdown_probe();
    #[cfg(not(target_family = "wasm"))]
    lifecycle_barrier?;
    #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
    probe_shutdown?;
    #[cfg(not(target_family = "wasm"))]
    blocking_shutdown?;
    if fail {
      return Err(Error::new(
        Status::GenericFailure,
        "injected custom runtime shutdown error",
      ));
    }
    Ok(())
  }
}

struct TestRuntimeGuard {
  state: Arc<RuntimeState>,
}

impl AsyncRuntimeGuard for TestRuntimeGuard {}

impl Drop for TestRuntimeGuard {
  fn drop(&mut self) {
    self.state.active_guards.fetch_sub(1, Ordering::Relaxed);
    self.state.exit_calls.fetch_add(1, Ordering::Relaxed);
  }
}

struct YieldOnce {
  yielded: bool,
}

impl Future for YieldOnce {
  type Output = ();

  fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
    if self.yielded {
      Poll::Ready(())
    } else {
      self.yielded = true;
      context.waker().wake_by_ref();
      Poll::Pending
    }
  }
}

fn yield_once() -> YieldOnce {
  YieldOnce { yielded: false }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn state() -> &'static RuntimeState {
  RUNTIME_STATE
    .get()
    .map(Arc::as_ref)
    .expect("Custom async runtime was not initialized")
}

fn load(counter: &AtomicUsize) -> u32 {
  counter.load(Ordering::Relaxed) as u32
}

fn backend_identity(state: &Arc<RuntimeState>) -> String {
  #[cfg(not(target_family = "wasm"))]
  {
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos();
    format!(
      "{}-{timestamp:032x}-{:x}",
      std::process::id(),
      Arc::as_ptr(state) as usize
    )
  }
  #[cfg(target_family = "wasm")]
  format!("wasm-{:x}", Arc::as_ptr(state) as usize)
}

#[napi_derive::module_init]
fn init() {
  let state = Arc::clone(RUNTIME_STATE.get_or_init(|| Arc::new(RuntimeState::default())));
  BACKEND_IDENTITY.get_or_init(|| backend_identity(&state));
  state.module_init_calls.fetch_add(1, Ordering::Relaxed);
  RUNTIME_REGISTRATION.call_once(|| {
    #[cfg(not(target_family = "wasm"))]
    if std::env::var_os("NAPI_CUSTOM_RUNTIME_TEST_MISSING").is_some() {
      return;
    }

    state
      .runtime_registration_calls
      .fetch_add(1, Ordering::Relaxed);
    register_async_runtime(TestRuntime {
      state: Arc::clone(&state),
    });

    #[cfg(not(target_family = "wasm"))]
    if std::env::var_os("NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE").is_some() {
      #[cfg(feature = "tokio-rt")]
      {
        let duplicate = match (
          std::env::var("NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE_PROBE_STARTED"),
          std::env::var("NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE_PROBE_STOPPED"),
        ) {
          (Ok(started_path), Ok(stopped_path)) => {
            DuplicateProbeRuntime::with_probe(started_path, stopped_path)
              .expect("failed to start duplicate runtime probe")
          }
          _ => DuplicateProbeRuntime::default(),
        };
        register_async_runtime(duplicate);
      }
      #[cfg(not(feature = "tokio-rt"))]
      register_async_runtime(TestRuntime { state });
    }
  });
}

struct WrappedExports;

#[napi(module_exports)]
pub fn preserve_exports_wrap_slot(mut exports: Object) -> Result<()> {
  #[cfg(not(target_family = "wasm"))]
  if std::env::var_os("NAPI_CUSTOM_RUNTIME_LIFECYCLE_TEST").is_some() {
    exports.create_named_method(
      "armSubmissionTransitionBarrier",
      arm_submission_transition_barrier_c_callback,
    )?;
    #[cfg(feature = "tokio-rt")]
    {
      exports.create_named_method(
        "startTokioRetirementProbe",
        start_tokio_retirement_probe_c_callback,
      )?;
      exports.create_named_method("failNextShutdown", fail_next_shutdown_c_callback)?;
      exports.create_named_method("panicNextShutdown", panic_next_shutdown_c_callback)?;
      exports.create_named_method(
        "startShutdownPanicProbe",
        start_shutdown_panic_probe_c_callback,
      )?;
      exports.create_named_method(
        "probeSubmissionTransition",
        probe_submission_transition_c_callback,
      )?;
    }
  }
  exports.wrap(WrappedExports, None)
}

#[napi(object)]
pub struct RuntimeMetrics {
  #[napi(js_name = "backendIdentity")]
  pub backend_identity: String,
  #[napi(js_name = "tokioRuntimeEnabled")]
  pub tokio_runtime_enabled: bool,
  #[napi(js_name = "moduleInitCalls")]
  pub module_init_calls: u32,
  #[napi(js_name = "runtimeRegistrationCalls")]
  pub runtime_registration_calls: u32,
  #[napi(js_name = "backendDropCalls")]
  pub backend_drop_calls: u32,
  #[napi(js_name = "startCalls")]
  pub start_calls: u32,
  #[napi(js_name = "shutdownCalls")]
  pub shutdown_calls: u32,
  #[napi(js_name = "enterCalls")]
  pub enter_calls: u32,
  #[napi(js_name = "exitCalls")]
  pub exit_calls: u32,
  #[napi(js_name = "activeGuards")]
  pub active_guards: u32,
  #[napi(js_name = "spawnCalls")]
  pub spawn_calls: u32,
  #[napi(js_name = "synchronousSpawnCompletions")]
  pub synchronous_spawn_completions: u32,
  #[napi(js_name = "spawnBlockingCalls")]
  pub spawn_blocking_calls: u32,
  #[napi(js_name = "wakeCalls")]
  pub wake_calls: u32,
  #[napi(js_name = "taskPolls")]
  pub task_polls: u32,
  #[napi(js_name = "completedTasks")]
  pub completed_tasks: u32,
  #[napi(js_name = "blockOnCalls")]
  pub block_on_calls: u32,
  #[napi(js_name = "blockOnPolls")]
  pub block_on_polls: u32,
  #[napi(js_name = "shutdownProbeStarts")]
  pub shutdown_probe_starts: u32,
  #[napi(js_name = "shutdownProbeStops")]
  pub shutdown_probe_stops: u32,
  #[napi(js_name = "shutdownProbeActive")]
  pub shutdown_probe_active: bool,
}

#[napi]
pub fn get_runtime_metrics() -> RuntimeMetrics {
  let state = state();
  RuntimeMetrics {
    backend_identity: BACKEND_IDENTITY
      .get()
      .expect("Custom async runtime backend identity was not initialized")
      .clone(),
    tokio_runtime_enabled: cfg!(feature = "tokio-rt"),
    module_init_calls: load(&state.module_init_calls),
    runtime_registration_calls: load(&state.runtime_registration_calls),
    backend_drop_calls: load(&state.backend_drop_calls),
    start_calls: load(&state.start_calls),
    shutdown_calls: load(&state.shutdown_calls),
    enter_calls: load(&state.enter_calls),
    exit_calls: load(&state.exit_calls),
    active_guards: load(&state.active_guards),
    spawn_calls: load(&state.spawn_calls),
    synchronous_spawn_completions: load(&state.synchronous_spawn_completions),
    spawn_blocking_calls: load(&state.spawn_blocking_calls),
    wake_calls: load(&state.wake_calls),
    task_polls: load(&state.task_polls),
    completed_tasks: load(&state.completed_tasks),
    block_on_calls: load(&state.block_on_calls),
    block_on_polls: load(&state.block_on_polls),
    #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
    shutdown_probe_starts: load(&state.shutdown_probe_starts),
    #[cfg(not(all(feature = "tokio-rt", not(target_family = "wasm"))))]
    shutdown_probe_starts: 0,
    #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
    shutdown_probe_stops: load(&state.shutdown_probe_stops),
    #[cfg(not(all(feature = "tokio-rt", not(target_family = "wasm"))))]
    shutdown_probe_stops: 0,
    #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
    shutdown_probe_active: state.shutdown_probe_active.load(Ordering::Acquire),
    #[cfg(not(all(feature = "tokio-rt", not(target_family = "wasm"))))]
    shutdown_probe_active: false,
  }
}

#[napi]
pub async fn async_double(value: u32) -> u32 {
  yield_once().await;
  value * 2
}

#[napi]
pub async fn async_error() -> Result<()> {
  yield_once().await;
  Err(Error::new(
    Status::GenericFailure,
    "custom runtime async error",
  ))
}

#[napi]
pub async fn tsfn_throw_from_js_catch_recover(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> Result<()> {
  match tsfn.call_async_catch(("trigger".to_owned(),).into()).await {
    Ok(()) => Err(Error::new(
      Status::GenericFailure,
      "expected JavaScript callback to throw",
    )),
    Err(error) if error.status == Status::PendingException => {
      Err(error.try_clone().unwrap_or_else(|clone_error| clone_error))
    }
    Err(error) => Err(Error::new(
      Status::GenericFailure,
      format!("expected PendingException, got {:?}", error.status),
    )),
  }
}

#[napi]
pub async fn tsfn_throw_from_js_catch_drop(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> Result<()> {
  match tsfn.call_async_catch(("trigger".to_owned(),).into()).await {
    Ok(()) => Err(Error::new(
      Status::GenericFailure,
      "expected JavaScript callback to throw",
    )),
    Err(error) if error.status == Status::PendingException => {
      let cloned = error.try_clone()?;
      drop(error);
      drop(cloned);
      Ok(())
    }
    Err(error) => Err(error),
  }
}

#[napi]
pub async fn async_panic() {
  yield_once().await;
  panic!("custom runtime async panic");
}

#[napi]
pub async fn async_panic_string(value: u32) {
  yield_once().await;
  // Panics with a formatted `String` payload (not a `&'static str`), exercising the
  // `downcast_ref::<String>()` fallback in the async-runtime reject path.
  panic!("custom runtime async string panic: {}", value);
}

#[napi]
pub async fn async_never() {
  std::future::pending::<()>().await;
}

#[napi]
pub fn test_buffer() -> Buffer {
  Buffer::from(vec![0, 1, 255])
}

#[napi(async_iterator)]
pub struct RuntimeAsyncIterator {
  current: u32,
  max: u32,
  pending_first: bool,
}

#[napi]
impl AsyncGenerator for RuntimeAsyncIterator {
  type Yield = u32;
  type Next = ();
  type Return = ();

  #[allow(clippy::manual_async_fn)]
  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let current = self.current;
    self.current += 1;
    let max = self.max;
    let pending = self.pending_first && current == 0;
    async move {
      if pending {
        std::future::pending::<()>().await;
      } else {
        yield_once().await;
      }
      Ok((current < max).then_some(current))
    }
  }

  fn catch(
    &mut self,
    _env: Env,
    value: Unknown,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let result = value.coerce_to_string().map(|_| None);
    async move { result }
  }
}

#[napi]
impl RuntimeAsyncIterator {
  #[napi(constructor)]
  pub fn new(max: Option<u32>, pending_first: Option<bool>) -> Self {
    Self {
      current: 0,
      max: max.unwrap_or(3),
      pending_first: pending_first.unwrap_or(false),
    }
  }
}

#[cfg(not(target_family = "wasm"))]
fn runtime_transition_result(result: Result<()>) -> String {
  match result {
    Ok(()) => "Ok".to_owned(),
    Err(error) => format!("{}\n{}", error.status.as_ref(), error.reason),
  }
}

#[cfg(not(target_family = "wasm"))]
struct AsyncIteratorAdmissionLifecycleFuture {
  start_result_path: String,
  value: Option<u32>,
}

#[cfg(not(target_family = "wasm"))]
impl Future for AsyncIteratorAdmissionLifecycleFuture {
  type Output = Result<Option<u32>>;

  fn poll(mut self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Self::Output> {
    Poll::Ready(Ok(self.value.take()))
  }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for AsyncIteratorAdmissionLifecycleFuture {
  fn drop(&mut self) {
    let result = runtime_transition_result(try_start_async_runtime());
    let _ = std::fs::write(&self.start_result_path, result);
  }
}

#[cfg(not(target_family = "wasm"))]
#[napi(object)]
pub struct AsyncIteratorAdmissionValue {
  pub value: u32,
}

#[cfg(not(target_family = "wasm"))]
#[napi(async_iterator)]
pub struct AsyncIteratorAdmissionLifecycle {
  start_result_path: String,
  yielded: bool,
}

#[cfg(not(target_family = "wasm"))]
#[napi]
impl AsyncGenerator for AsyncIteratorAdmissionLifecycle {
  type Yield = u32;
  type Next = AsyncIteratorAdmissionValue;
  type Return = ();

  fn next(
    &mut self,
    value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let value = (!self.yielded).then_some(value.map_or(7, |value| value.value));
    self.yielded = true;
    AsyncIteratorAdmissionLifecycleFuture {
      start_result_path: self.start_result_path.clone(),
      value,
    }
  }
}

#[cfg(not(target_family = "wasm"))]
#[napi]
impl AsyncIteratorAdmissionLifecycle {
  #[napi(constructor)]
  pub fn new(start_result_path: String) -> Self {
    Self {
      start_result_path,
      yielded: false,
    }
  }
}

#[cfg(not(target_family = "wasm"))]
struct SetupRejectionFuture {
  _drop_probe: SetupRejectionDropProbe,
}

#[cfg(not(target_family = "wasm"))]
impl Future for SetupRejectionFuture {
  type Output = Result<()>;

  fn poll(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Self::Output> {
    Poll::Pending
  }
}

#[cfg(not(target_family = "wasm"))]
struct SetupRejectionDropProbe(Arc<AtomicBool>);

#[cfg(not(target_family = "wasm"))]
impl Drop for SetupRejectionDropProbe {
  fn drop(&mut self) {
    self.0.store(true, Ordering::Release);
  }
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn stopped_async_block_cleanup_order(env: &Env, result_path: String) -> Result<AsyncBlock<()>> {
  let future_dropped = Arc::new(AtomicBool::new(false));
  let resolver_dropped = Arc::new(AtomicBool::new(false));
  let finalizer_future_dropped = Arc::clone(&future_dropped);
  let finalizer_resolver_dropped = Arc::clone(&resolver_dropped);
  let resolver_probe = SetupRejectionDropProbe(resolver_dropped);
  AsyncBlockBuilder::new(SetupRejectionFuture {
    _drop_probe: SetupRejectionDropProbe(future_dropped),
  })
  .with_dispose(move |_| {
    drop(resolver_probe);
    Ok(())
  })
  .with_terminal_finalizer(move || {
    let future_dropped = finalizer_future_dropped.load(Ordering::Acquire);
    let resolver_dropped = finalizer_resolver_dropped.load(Ordering::Acquire);
    let shutdown = runtime_transition_result(try_shutdown_async_runtime());
    let _ = std::fs::write(
      result_path,
      format!("future={future_dropped}\nresolver={resolver_dropped}\nshutdown={shutdown}"),
    );
  })
  .build(env)
}

#[cfg(not(target_family = "wasm"))]
struct ShutdownOnUnpolledDrop {
  result_path: String,
}

#[cfg(not(target_family = "wasm"))]
impl Future for ShutdownOnUnpolledDrop {
  type Output = Result<()>;

  fn poll(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Self::Output> {
    Poll::Pending
  }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for ShutdownOnUnpolledDrop {
  fn drop(&mut self) {
    let marker = match try_shutdown_async_runtime() {
      Ok(()) => "Ok\nnested runtime shutdown unexpectedly succeeded".to_owned(),
      Err(error) => format!("{}\n{}", error.status.as_ref(), error.reason),
    };
    let _ = std::fs::write(&self.result_path, marker);
  }
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn unpolled_shutdown_on_drop(env: &Env, result_path: String) -> Result<AsyncBlock<()>> {
  AsyncBlockBuilder::new(ShutdownOnUnpolledDrop { result_path }).build(env)
}

#[cfg(not(target_family = "wasm"))]
struct RetainTaskWaker;

#[cfg(not(target_family = "wasm"))]
impl Future for RetainTaskWaker {
  type Output = ();

  fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
    *lock(&EXTERNALLY_RETAINED_TASK_WAKER) = Some(context.waker().clone());
    Poll::Pending
  }
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub async fn retain_task_waker() {
  RetainTaskWaker.await;
}

#[napi]
pub fn reject_next_spawn() {
  state().reject_next_spawn.store(true, Ordering::Release);
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn defer_next_spawn_drain() {
  state()
    .defer_next_spawn_drain
    .store(true, Ordering::Release);
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn defer_next_task_wake() {
  state().defer_next_task_wake.store(true, Ordering::Release);
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn drain_runtime_tasks() {
  RUNTIME_STATE
    .get()
    .expect("Custom async runtime was not initialized")
    .drain();
}

#[cfg(not(target_family = "wasm"))]
#[napi(no_export)]
pub fn fail_next_shutdown() {
  state().fail_next_shutdown.store(true, Ordering::Release);
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
#[napi(no_export)]
pub fn panic_next_shutdown() {
  state().panic_next_shutdown.store(true, Ordering::Release);
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
#[napi(no_export)]
pub fn start_shutdown_panic_probe(started_path: String, stopped_path: String) -> Result<()> {
  RUNTIME_STATE
    .get()
    .expect("Custom async runtime was not initialized")
    .start_shutdown_probe(started_path, stopped_path)
}

#[cfg(not(target_family = "wasm"))]
#[napi(no_export)]
pub fn arm_submission_transition_barrier(
  hook: String,
  entered_path: String,
  release_path: String,
) -> Result<()> {
  if std::env::var_os("NAPI_CUSTOM_RUNTIME_LIFECYCLE_TEST").is_none() {
    return Err(Error::new(
      Status::GenericFailure,
      "custom runtime lifecycle barriers require NAPI_CUSTOM_RUNTIME_LIFECYCLE_TEST",
    ));
  }
  state().arm_lifecycle_hook_barrier(LifecycleHook::parse(&hook)?, entered_path, release_path)
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
fn submission_join_error<'env>(env: &'env Env, error: JoinError) -> Result<Object<'env>> {
  let is_runtime_error = error.is_runtime_error();
  let is_cancelled = error.is_cancelled();
  let message = error.to_string();
  let (status, reason) = match error.try_into_runtime_error() {
    Ok(error) => (Some(error.status.as_ref().to_owned()), Some(error.reason)),
    Err(_) => (None, None),
  };
  let mut result = Object::new(env)?;
  result.set("isRuntimeError", is_runtime_error)?;
  result.set("isCancelled", is_cancelled)?;
  result.set("message", message)?;
  result.set("status", status)?;
  result.set("reason", reason)?;
  Ok(result)
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
#[napi(no_export)]
pub fn probe_submission_transition<'env>(env: &'env Env) -> Result<Object<'env>> {
  let future = futures::executor::block_on(spawn_on_custom_runtime(async { 42 }))
    .err()
    .ok_or_else(|| {
      Error::new(
        Status::GenericFailure,
        "custom runtime future unexpectedly ran during a lifecycle transition",
      )
    })?;
  let blocking_work_ran = Arc::new(AtomicBool::new(false));
  let blocking_work_ran_in_task = Arc::clone(&blocking_work_ran);
  let blocking = futures::executor::block_on(spawn_blocking_on_custom_runtime(move || {
    blocking_work_ran_in_task.store(true, Ordering::Release);
    43
  }))
  .err()
  .ok_or_else(|| {
    Error::new(
      Status::GenericFailure,
      "custom runtime blocking work unexpectedly ran during a lifecycle transition",
    )
  })?;

  let future = submission_join_error(env, future)?;
  let blocking = submission_join_error(env, blocking)?;
  let mut result = Object::new(env)?;
  result.set("future", future)?;
  result.set("blocking", blocking)?;
  result.set("blockingWorkRan", blocking_work_ran.load(Ordering::Acquire))?;
  Ok(result)
}

#[napi]
pub fn spawn_future<'env>(env: &'env Env, value: u32) -> Result<PromiseRaw<'env, u32>> {
  env.spawn_future(async move {
    yield_once().await;
    Ok(value + 1)
  })
}

#[napi(async_runtime)]
pub fn runtime_context_is_active() -> bool {
  state().active_guards.load(Ordering::Relaxed) > 0
}

#[napi(async_runtime)]
pub fn runtime_context_add(value: u32) -> u32 {
  assert!(state().active_guards.load(Ordering::Relaxed) > 0);
  value + 1
}

#[napi]
pub fn block_on_value(value: u32) -> Result<u32> {
  try_block_on_custom_runtime(async move {
    yield_once().await;
    value + 1
  })
}

fn blocking_work_error(error: impl std::fmt::Display) -> Error {
  #[cfg(all(target_family = "wasm", not(custom_runtime_wasi_threads)))]
  let reason = format!("{THREADLESS_WASI_BLOCKING_UNSUPPORTED}: {error}");
  #[cfg(not(all(target_family = "wasm", not(custom_runtime_wasi_threads))))]
  let reason = format!("custom runtime blocking work failed: {error}");
  Error::new(Status::GenericFailure, reason)
}

#[napi]
pub fn spawn_blocking_value(value: u32) -> Result<u32> {
  try_block_on_custom_runtime(spawn_blocking_on_custom_runtime(move || value + 1))?
    .map_err(blocking_work_error)
}

#[cfg(not(target_family = "wasm"))]
#[napi(object)]
pub struct BlockingThreadProbe {
  #[napi(js_name = "ranOffCallerThread")]
  pub ran_off_caller_thread: bool,
  #[napi(js_name = "observedTimerRelease")]
  pub observed_timer_release: bool,
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub async fn probe_blocking_thread(release_path: String) -> Result<BlockingThreadProbe> {
  let caller_thread = thread::current().id();
  let (ran_off_caller_thread, observed_timer_release) =
    spawn_blocking_on_custom_runtime(move || {
      (
        thread::current().id() != caller_thread,
        wait_for_file_timeout(Path::new(&release_path), Duration::from_secs(5)),
      )
    })
    .await
    .map_err(blocking_work_error)?;
  Ok(BlockingThreadProbe {
    ran_off_caller_thread,
    observed_timer_release,
  })
}

#[cfg(not(target_family = "wasm"))]
fn wait_for_file(path: &Path) -> bool {
  wait_for_file_timeout(path, Duration::from_secs(30))
}

#[cfg(not(target_family = "wasm"))]
fn wait_for_file_timeout(path: &Path, timeout: Duration) -> bool {
  let deadline = Instant::now() + timeout;
  while !path.exists() {
    if Instant::now() >= deadline {
      return false;
    }
    thread::sleep(Duration::from_millis(5));
  }
  true
}

#[cfg(not(target_family = "wasm"))]
fn write_file(path: &Path, contents: &str) -> std::io::Result<()> {
  let temporary_path = path.with_extension("tmp");
  std::fs::write(&temporary_path, contents)?;
  std::fs::rename(temporary_path, path)
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
fn explicit_start_during_automatic_transition() -> String {
  let deadline = Instant::now() + Duration::from_secs(30);
  loop {
    match try_start_async_runtime() {
      Err(error)
        if error.status == Status::WouldDeadlock
          && error.reason == "Tokio runtime is still shutting down" =>
      {
        if Instant::now() >= deadline {
          return "Timeout\nautomatic runtime registration did not start".to_owned();
        }
        thread::sleep(Duration::from_millis(5));
      }
      Ok(()) => return "Ok\nexplicit start unexpectedly succeeded".to_owned(),
      Err(error) => return format!("{}\n{}", error.status.as_ref(), error.reason),
    }
  }
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
fn explicit_shutdown_during_automatic_transition() -> String {
  match try_shutdown_async_runtime() {
    Ok(()) => "Ok\nexplicit shutdown unexpectedly succeeded".to_owned(),
    Err(error) => format!("{}\n{}", error.status.as_ref(), error.reason),
  }
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
#[napi(no_export)]
pub fn start_tokio_retirement_probe(
  entered_path: String,
  explicit_attempt_path: String,
  explicit_start_result_path: String,
  explicit_shutdown_result_path: String,
  release_path: String,
) {
  drop(spawn_blocking(move || {
    if write_file(Path::new(&entered_path), "entered").is_err() {
      return;
    }
    if !wait_for_file(Path::new(&explicit_attempt_path)) {
      let _ = write_file(
        Path::new(&explicit_start_result_path),
        "Timeout\ntimed out waiting to attempt the explicit start",
      );
      return;
    }

    // Tokio blocking callbacks are runtime operations. Use a plain child thread
    // so this probe still observes transition contention rather than same-call
    // lifecycle reentry.
    let lifecycle_results = thread::spawn(|| {
      (
        explicit_start_during_automatic_transition(),
        explicit_shutdown_during_automatic_transition(),
      )
    })
    .join();
    let (explicit_start_result, explicit_shutdown_result) = match lifecycle_results {
      Ok(results) => results,
      Err(_) => (
        "Panic\nexplicit lifecycle probe panicked".to_owned(),
        "Panic\nexplicit lifecycle probe panicked".to_owned(),
      ),
    };
    if write_file(
      Path::new(&explicit_start_result_path),
      &explicit_start_result,
    )
    .is_err()
    {
      return;
    }

    if write_file(
      Path::new(&explicit_shutdown_result_path),
      &explicit_shutdown_result,
    )
    .is_err()
    {
      return;
    }

    wait_for_file(Path::new(&release_path));
  }));
}

#[napi]
pub fn start_runtime() -> Result<()> {
  try_start_async_runtime()
}

#[napi]
pub fn shutdown_runtime() -> Result<()> {
  try_shutdown_async_runtime()
}

#[napi]
pub fn is_wasm() -> bool {
  cfg!(target_family = "wasm")
}

#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
  use std::{
    sync::{
      atomic::{AtomicBool, AtomicUsize, Ordering},
      mpsc, Arc, Mutex,
    },
    task::{Context, Poll, Waker},
    time::Duration,
  };

  use super::*;

  fn schedule_test_future(
    runtime: &Arc<RuntimeState>,
    future: impl Future<Output = ()> + Send + 'static,
  ) -> Arc<Task> {
    let mut scheduler = lock(&runtime.scheduler);
    assert!(scheduler.accepting);
    let id = scheduler.reserve_task_id();
    let task = Arc::new(Task {
      id,
      generation: scheduler.generation,
      future: Mutex::new(Some(Box::pin(future))),
      runtime: Arc::downgrade(runtime),
      queued: AtomicBool::new(true),
      cancelled: AtomicBool::new(false),
    });
    scheduler.task_refs.push(Arc::downgrade(&task));
    scheduler.tasks.insert(id, Arc::clone(&task));
    scheduler.queue.push_back(Arc::clone(&task));
    task
  }

  #[test]
  fn scheduler_start_is_idempotent() {
    let runtime = Arc::new(RuntimeState::default());
    runtime.start_scheduler().unwrap();
    let generation = lock(&runtime.scheduler).generation;

    runtime.start_scheduler().unwrap();

    assert_eq!(lock(&runtime.scheduler).generation, generation);
    runtime.shutdown_scheduler();
  }

  struct CapturedWakeFuture {
    polls: Arc<AtomicUsize>,
    dropped: Arc<AtomicBool>,
    waker: Arc<Mutex<Option<Waker>>>,
  }

  impl Future for CapturedWakeFuture {
    type Output = ();

    fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
      self.polls.fetch_add(1, Ordering::SeqCst);
      *lock(&self.waker) = Some(context.waker().clone());
      Poll::Pending
    }
  }

  impl Drop for CapturedWakeFuture {
    fn drop(&mut self) {
      lock(&self.waker).take();
      self.dropped.store(true, Ordering::SeqCst);
    }
  }

  #[test]
  fn shutdown_cancels_retained_tasks_and_clears_external_wakers() {
    let runtime = Arc::new(RuntimeState::default());
    runtime.start_scheduler().unwrap();
    let polls = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicBool::new(false));
    let waker = Arc::new(Mutex::new(None));
    let task = schedule_test_future(
      &runtime,
      CapturedWakeFuture {
        polls: Arc::clone(&polls),
        dropped: Arc::clone(&dropped),
        waker: Arc::clone(&waker),
      },
    );

    runtime.drain();
    assert_eq!(polls.load(Ordering::SeqCst), 1);
    assert!(lock(&task.future).is_some());
    assert_eq!(lock(&runtime.scheduler).tasks.len(), 1);

    drop(task);
    runtime.shutdown_scheduler();
    assert!(dropped.load(Ordering::SeqCst));
    assert!(lock(&waker).is_none());
    {
      let scheduler = lock(&runtime.scheduler);
      assert!(scheduler.tasks.is_empty());
      assert!(scheduler.queue.is_empty());
    }
  }

  #[test]
  fn stale_wake_before_shutdown_cannot_requeue_a_cancelled_task() {
    let runtime = Arc::new(RuntimeState::default());
    runtime.start_scheduler().unwrap();
    let polls = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicBool::new(false));
    let waker = Arc::new(Mutex::new(None));
    let task = schedule_test_future(
      &runtime,
      CapturedWakeFuture {
        polls: Arc::clone(&polls),
        dropped: Arc::clone(&dropped),
        waker: Arc::clone(&waker),
      },
    );

    runtime.drain();
    assert_eq!(polls.load(Ordering::SeqCst), 1);
    let stale_waker = lock(&waker)
      .as_ref()
      .expect("future must capture its task waker")
      .clone();

    task.cancel();
    assert!(dropped.load(Ordering::SeqCst));
    assert!(lock(&waker).is_none());
    stale_waker.wake_by_ref();
    assert_eq!(polls.load(Ordering::SeqCst), 1);
    assert!(lock(&runtime.scheduler).queue.is_empty());
    drop(stale_waker);
    drop(task);

    runtime.shutdown_scheduler();
  }

  struct BlockingPollFuture {
    started: Option<mpsc::SyncSender<()>>,
    release: mpsc::Receiver<()>,
    dropped: Arc<AtomicBool>,
  }

  impl Future for BlockingPollFuture {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Self::Output> {
      self
        .started
        .take()
        .expect("blocking future is polled only once")
        .send(())
        .unwrap();
      self.release.recv().unwrap();
      Poll::Pending
    }
  }

  impl Drop for BlockingPollFuture {
    fn drop(&mut self) {
      self.dropped.store(true, Ordering::SeqCst);
    }
  }

  #[test]
  fn shutdown_waits_for_active_poll_and_drain_to_exit() {
    let runtime = Arc::new(RuntimeState::default());
    runtime.start_scheduler().unwrap();
    let (started_tx, started_rx) = mpsc::sync_channel(0);
    let (release_tx, release_rx) = mpsc::sync_channel(0);
    let dropped = Arc::new(AtomicBool::new(false));
    schedule_test_future(
      &runtime,
      BlockingPollFuture {
        started: Some(started_tx),
        release: release_rx,
        dropped: Arc::clone(&dropped),
      },
    );

    let drain_runtime = Arc::clone(&runtime);
    let drain = std::thread::spawn(move || drain_runtime.drain());
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();

    let shutdown_runtime = Arc::clone(&runtime);
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
      shutdown_runtime.shutdown_scheduler();
      shutdown_tx.send(()).unwrap();
    });
    assert!(
      shutdown_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "shutdown returned while a task poll was still active"
    );

    release_tx.send(()).unwrap();
    shutdown_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("shutdown did not finish after the active poll exited");
    drain.join().unwrap();
    shutdown.join().unwrap();
    assert!(dropped.load(Ordering::SeqCst));
  }

  #[test]
  fn blocking_pool_is_bounded_and_restartable() {
    let runtime = Arc::new(RuntimeState::default());
    runtime.start_blocking_pool().unwrap();
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let (started_tx, started_rx) = mpsc::channel();

    for _ in 0..BLOCKING_WORKER_COUNT {
      let started_tx = started_tx.clone();
      let release = Arc::clone(&release);
      assert!(runtime
        .submit_blocking_work(Box::new(move || {
          started_tx.send(()).unwrap();
          let (released, ready) = &*release;
          let mut released = lock(released);
          while !*released {
            released = ready
              .wait(released)
              .unwrap_or_else(std::sync::PoisonError::into_inner);
          }
        }))
        .is_ok());
    }
    drop(started_tx);
    for _ in 0..BLOCKING_WORKER_COUNT {
      started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    let queued_runs = Arc::new(AtomicUsize::new(0));
    for _ in 0..BLOCKING_QUEUE_CAPACITY {
      let queued_runs = Arc::clone(&queued_runs);
      assert!(runtime
        .submit_blocking_work(Box::new(move || {
          queued_runs.fetch_add(1, Ordering::SeqCst);
        }))
        .is_ok());
    }
    let rejected = runtime
      .submit_blocking_work(Box::new(|| {}))
      .expect_err("the bounded blocking queue must reject excess work");
    drop(rejected);

    let shutdown_runtime = Arc::clone(&runtime);
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let shutdown = thread::spawn(move || {
      shutdown_runtime.shutdown_blocking_pool().unwrap();
      shutdown_tx.send(()).unwrap();
    });
    assert!(
      shutdown_rx.recv_timeout(Duration::from_millis(50)).is_err(),
      "blocking pool shutdown returned while workers were still active"
    );

    let (released, ready) = &*release;
    *lock(released) = true;
    ready.notify_all();
    shutdown_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("blocking pool shutdown did not join released workers");
    shutdown.join().unwrap();
    assert_eq!(queued_runs.load(Ordering::SeqCst), 0);

    runtime.start_blocking_pool().unwrap();
    let (ran_tx, ran_rx) = mpsc::channel();
    assert!(runtime
      .submit_blocking_work(Box::new(move || ran_tx.send(()).unwrap()))
      .is_ok());
    ran_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("restarted blocking worker did not run accepted work");
    runtime.shutdown_blocking_pool().unwrap();
  }
}
