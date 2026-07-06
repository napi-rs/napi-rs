use std::{
  collections::VecDeque,
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, MutexGuard, OnceLock, Weak,
  },
  task::{Context, Poll},
};

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
use std::{
  path::Path,
  thread,
  time::{Duration, Instant},
};

use futures::task::{waker_ref, ArcWake};
#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
use napi::bindgen_prelude::spawn_blocking;
use napi::bindgen_prelude::{
  register_async_runtime, spawn_blocking_on_custom_runtime, try_block_on_custom_runtime,
  try_shutdown_async_runtime, try_start_async_runtime, AsyncRuntime, AsyncRuntimeGuard,
  AsyncRuntimeTask, Env, Error, JsObjectValue, Object, PromiseRaw, Result, Status,
};
use napi_derive::napi;

static RUNTIME_STATE: OnceLock<Arc<RuntimeState>> = OnceLock::new();

#[derive(Default)]
struct RuntimeState {
  queue: Mutex<VecDeque<Arc<Task>>>,
  draining: AtomicBool,
  accepting: AtomicBool,
  reject_next_spawn: AtomicBool,
  fail_next_shutdown: AtomicBool,
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
  fn enqueue(self: &Arc<Self>, task: Arc<Task>) {
    if task.queued.swap(true, Ordering::AcqRel) {
      return;
    }
    lock(&self.queue).push_back(task);
  }

  fn drain(self: &Arc<Self>) {
    if self.draining.swap(true, Ordering::AcqRel) {
      return;
    }

    loop {
      loop {
        let Some(task) = lock(&self.queue).pop_front() else {
          break;
        };
        task.queued.store(false, Ordering::Release);
        task.poll();
      }

      self.draining.store(false, Ordering::Release);
      if lock(&self.queue).is_empty() || self.draining.swap(true, Ordering::AcqRel) {
        return;
      }
    }
  }

  fn has_ready_tasks(&self) -> bool {
    !lock(&self.queue).is_empty()
  }
}

struct Task {
  future: Mutex<Option<Pin<Box<dyn Future<Output = ()> + Send + 'static>>>>,
  runtime: Weak<RuntimeState>,
  queued: AtomicBool,
}

impl Task {
  fn poll(self: Arc<Self>) {
    let Some(mut future) = lock(&self.future).take() else {
      return;
    };
    let Some(runtime) = self.runtime.upgrade() else {
      return;
    };

    runtime.task_polls.fetch_add(1, Ordering::Relaxed);
    let waker = waker_ref(&self);
    let mut context = Context::from_waker(&waker);
    match future.as_mut().poll(&mut context) {
      Poll::Ready(()) => {
        runtime.completed_tasks.fetch_add(1, Ordering::Relaxed);
      }
      Poll::Pending => {
        *lock(&self.future) = Some(future);
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
    runtime.enqueue(task.clone());
    runtime.drain();
  }
}

struct BlockOnWaker {
  notified: AtomicBool,
}

impl ArcWake for BlockOnWaker {
  fn wake_by_ref(waker: &Arc<Self>) {
    waker.notified.store(true, Ordering::Release);
  }
}

struct TestRuntime {
  state: Arc<RuntimeState>,
}

impl AsyncRuntime for TestRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    if self.state.reject_next_spawn.swap(false, Ordering::AcqRel)
      || !self.state.accepting.load(Ordering::Acquire)
    {
      return Err(task);
    }
    self.state.spawn_calls.fetch_add(1, Ordering::Relaxed);
    let task = Arc::new(Task {
      future: Mutex::new(Some(Box::pin(task))),
      runtime: Arc::downgrade(&self.state),
      queued: AtomicBool::new(false),
    });
    self.state.enqueue(Arc::clone(&task));
    self.state.drain();
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
    work: Box<dyn FnOnce() + Send + 'static>,
  ) -> std::result::Result<(), Box<dyn FnOnce() + Send + 'static>> {
    if !self.state.accepting.load(Ordering::Acquire) {
      return Err(work);
    }
    self
      .state
      .spawn_blocking_calls
      .fetch_add(1, Ordering::Relaxed);
    work();
    Ok(())
  }

  fn block_on(&self, mut future: Pin<&mut dyn Future<Output = ()>>) {
    self.state.block_on_calls.fetch_add(1, Ordering::Relaxed);
    let signal = Arc::new(BlockOnWaker {
      notified: AtomicBool::new(true),
    });
    let waker = waker_ref(&signal);
    let mut context = Context::from_waker(&waker);

    loop {
      signal.notified.store(false, Ordering::Release);
      self.state.block_on_polls.fetch_add(1, Ordering::Relaxed);
      if future.as_mut().poll(&mut context).is_ready() {
        return;
      }

      self.state.drain();
      while !signal.notified.swap(false, Ordering::AcqRel) {
        if self.state.has_ready_tasks() {
          self.state.drain();
        } else {
          std::hint::spin_loop();
        }
      }
    }
  }

  fn enter(&self) -> Box<dyn AsyncRuntimeGuard + '_> {
    self.state.enter_calls.fetch_add(1, Ordering::Relaxed);
    self.state.active_guards.fetch_add(1, Ordering::Relaxed);
    Box::new(TestRuntimeGuard {
      state: self.state.clone(),
    })
  }

  fn start(&self) -> Result<()> {
    #[cfg(not(target_family = "wasm"))]
    if std::env::var_os("NAPI_CUSTOM_RUNTIME_TEST_START_ERROR").is_some() {
      return Err(Error::new(
        Status::GenericFailure,
        "injected custom runtime start error",
      ));
    }
    self.state.accepting.store(true, Ordering::Release);
    self.state.start_calls.fetch_add(1, Ordering::Relaxed);
    Ok(())
  }

  fn shutdown(&self) -> Result<()> {
    self.state.shutdown_calls.fetch_add(1, Ordering::Relaxed);
    if self.state.fail_next_shutdown.swap(false, Ordering::AcqRel) {
      return Err(Error::new(
        Status::GenericFailure,
        "injected custom runtime shutdown error",
      ));
    }
    self.state.accepting.store(false, Ordering::Release);
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

#[napi_derive::module_init]
fn init() {
  let state = Arc::new(RuntimeState::default());
  assert!(
    RUNTIME_STATE.set(state.clone()).is_ok(),
    "Custom async runtime was initialized more than once"
  );
  #[cfg(not(target_family = "wasm"))]
  if std::env::var_os("NAPI_CUSTOM_RUNTIME_TEST_MISSING").is_some() {
    return;
  }

  register_async_runtime(TestRuntime {
    state: state.clone(),
  });

  #[cfg(not(target_family = "wasm"))]
  if std::env::var_os("NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE").is_some() {
    register_async_runtime(TestRuntime { state });
  }
}

struct WrappedExports;

#[napi(module_exports)]
pub fn preserve_exports_wrap_slot(mut exports: Object) -> Result<()> {
  #[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
  if std::env::var_os("NAPI_CUSTOM_RUNTIME_LIFECYCLE_TEST").is_some() {
    exports.create_named_method(
      "startTokioRetirementProbe",
      start_tokio_retirement_probe_c_callback,
    )?;
    exports.create_named_method("failNextShutdown", fail_next_shutdown_c_callback)?;
  }
  exports.wrap(WrappedExports, None)
}

#[napi(object)]
pub struct RuntimeMetrics {
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
}

#[napi]
pub fn get_runtime_metrics() -> RuntimeMetrics {
  let state = state();
  RuntimeMetrics {
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
pub fn reject_next_spawn() {
  state().reject_next_spawn.store(true, Ordering::Release);
}

#[cfg(not(target_family = "wasm"))]
#[napi(no_export)]
pub fn fail_next_shutdown() {
  state().fail_next_shutdown.store(true, Ordering::Release);
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

#[napi]
pub fn spawn_blocking_value(value: u32) -> Result<u32> {
  try_block_on_custom_runtime(spawn_blocking_on_custom_runtime(move || value + 1))?.map_err(
    |error| {
      Error::new(
        Status::GenericFailure,
        format!("custom runtime blocking work failed: {error}"),
      )
    },
  )
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
fn wait_for_file(path: &Path) -> bool {
  let deadline = Instant::now() + Duration::from_secs(30);
  while !path.exists() {
    if Instant::now() >= deadline {
      return false;
    }
    thread::sleep(Duration::from_millis(5));
  }
  true
}

#[cfg(all(feature = "tokio-rt", not(target_family = "wasm")))]
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

    let explicit_start_result = explicit_start_during_automatic_transition();
    if write_file(
      Path::new(&explicit_start_result_path),
      &explicit_start_result,
    )
    .is_err()
    {
      return;
    }

    let explicit_shutdown_result = explicit_shutdown_during_automatic_transition();
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
