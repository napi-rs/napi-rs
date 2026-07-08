use std::{sync::Arc, thread, time::Duration};

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use std::cell::RefCell;

#[cfg(not(target_family = "wasm"))]
use std::{
  future::Future,
  pin::pin,
  sync::{
    atomic::{AtomicBool, AtomicI32, Ordering},
    mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender, SyncSender},
    Mutex,
  },
  task::{Context, Poll},
  thread::JoinHandle,
};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
  UnknownRef,
};

use crate::class::Animal;

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
type ForeignEnvReferTsfn = ThreadsafeFunction<(), (), (), Status, false, false, 0>;

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
thread_local! {
  static FOREIGN_ENV_REFER_TSFN: RefCell<Option<ForeignEnvReferTsfn>> = const { RefCell::new(None) };
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashThreadsafeFunctionForEnvOwnership")]
fn stash_threadsafe_function_for_env_ownership(
  #[napi(ts_arg_type = "() => void")] value: ForeignEnvReferTsfn,
) {
  FOREIGN_ENV_REFER_TSFN.with(|stored| *stored.borrow_mut() = Some(value));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "verifyThreadsafeFunctionOwnerEnv")]
#[allow(deprecated)]
fn verify_threadsafe_function_owner_env(env: &Env) -> Result<()> {
  FOREIGN_ENV_REFER_TSFN.with(|stored| {
    let mut stored = stored.borrow_mut();
    let value = stored
      .as_mut()
      .ok_or_else(|| Error::from_reason("no ThreadsafeFunction was stashed"))?;
    value.unref(env)?;
    value.refer(env)
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "referThreadsafeFunctionForEnvOwnership")]
#[allow(deprecated)]
fn refer_threadsafe_function_for_env_ownership(env: &Env) -> Result<()> {
  FOREIGN_ENV_REFER_TSFN.with(|stored| {
    stored
      .borrow_mut()
      .as_mut()
      .ok_or_else(|| Error::from_reason("no ThreadsafeFunction was stashed"))?
      .refer(env)
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "unrefThreadsafeFunctionForEnvOwnership")]
#[allow(deprecated)]
fn unref_threadsafe_function_for_env_ownership(env: &Env) -> Result<()> {
  FOREIGN_ENV_REFER_TSFN.with(|stored| {
    stored
      .borrow_mut()
      .as_mut()
      .ok_or_else(|| Error::from_reason("no ThreadsafeFunction was stashed"))?
      .unref(env)
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "disposeThreadsafeFunctionForEnvOwnership")]
fn dispose_threadsafe_function_for_env_ownership() {
  FOREIGN_ENV_REFER_TSFN.with(|stored| drop(stored.borrow_mut().take()));
}

#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_PAYLOAD_DROP_INDEX: usize = 0;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_QUEUE_FULL_INDEX: usize = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_UNEXPECTED_INDEX: usize = 2;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_JS_CALLBACK_INDEX: usize = 3;
#[cfg(not(target_family = "wasm"))]
const TSFN_CLOSING_FINALIZER_DROP_INDEX: usize = 4;
#[cfg(not(target_family = "wasm"))]
const TSFN_QUIESCENCE_FINALIZER_INDEX: usize = 5;
#[cfg(not(target_family = "wasm"))]
const TSFN_QUIESCENCE_JOIN_INDEX: usize = 6;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_WAITER_ERROR_MASK_INDEX: usize = 7;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_WAITER_SETTLED_MASK_INDEX: usize = 8;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_COUNTER_COUNT: usize = 9;
#[cfg(not(target_family = "wasm"))]
const TSFN_SCENARIO_WORKER_BIT: i32 = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_CALLEE_HANDLED_CALL_ASYNC_WAITER_BIT: i32 = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_CALL_ASYNC_CATCH_WAITER_BIT: i32 = 1 << 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_BOUNDED_CALL_ASYNC_CATCH_WAITER_BIT: i32 = 1 << 2;
#[cfg(not(target_family = "wasm"))]
const TSFN_UNHANDLED_CALL_ASYNC_WAITER_BIT: i32 = 1 << 3;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALLBACK_ENTERED_INDEX: usize = 0;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_QUEUE_FILLED_INDEX: usize = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALL_STARTED_INDEX: usize = 2;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALL_RETURNED_INDEX: usize = 3;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALLBACK_MASK_INDEX: usize = 4;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_COMPLETED_INDEX: usize = 5;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_UNEXPECTED_INDEX: usize = 6;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_COUNTER_COUNT: usize = 7;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALLBACK_MASK: i32 = 0b111;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEST_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(not(target_family = "wasm"))]
const TSFN_FINALIZER_LIVENESS_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[cfg(not(target_family = "wasm"))]
struct TsfnTeardownState {
  counters: Int32Array,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnTeardownState {
  fn new(counters: Int32Array) -> Result<Arc<Self>> {
    if counters.len() < TSFN_TEARDOWN_COUNTER_COUNT {
      return Err(Error::new(
        Status::InvalidArg,
        format!(
          "TSFN teardown counter array requires at least {TSFN_TEARDOWN_COUNTER_COUNT} entries"
        ),
      ));
    }
    Ok(Arc::new(Self { counters }))
  }

  fn counter(&self, index: usize) -> &AtomicI32 {
    // JavaScript owns the SharedArrayBuffer and accesses these slots only through Atomics.
    // Int32Array elements have the same size and alignment as AtomicI32.
    unsafe {
      &*self
        .counters
        .as_ref()
        .as_ptr()
        .add(index)
        .cast::<AtomicI32>()
    }
  }

  fn add(&self, index: usize) {
    self.counter(index).fetch_add(1, Ordering::SeqCst);
  }

  fn record_bit(&self, index: usize, bit: i32) {
    debug_assert_eq!(bit.count_ones(), 1);
    if self.counter(index).fetch_or(bit, Ordering::SeqCst) & bit != 0 {
      self.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
  }

  fn load(&self, index: usize) -> i32 {
    self.counter(index).load(Ordering::SeqCst)
  }
}

#[cfg(not(target_family = "wasm"))]
struct TsfnBlockingState {
  counters: Int32Array,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnBlockingState {
  fn new(counters: Int32Array) -> Result<Arc<Self>> {
    if counters.len() < TSFN_BLOCKING_COUNTER_COUNT {
      return Err(Error::new(
        Status::InvalidArg,
        format!(
          "TSFN blocking counter array requires at least {TSFN_BLOCKING_COUNTER_COUNT} entries"
        ),
      ));
    }
    let state = Arc::new(Self { counters });
    for index in 0..TSFN_BLOCKING_COUNTER_COUNT {
      if state.load(index) != 0 {
        return Err(Error::new(
          Status::InvalidArg,
          "TSFN blocking counters must be zero-initialized",
        ));
      }
    }
    Ok(state)
  }

  fn counter(&self, index: usize) -> &AtomicI32 {
    // JavaScript owns the SharedArrayBuffer and accesses these slots only through Atomics.
    // Int32Array elements have the same size and alignment as AtomicI32.
    unsafe {
      &*self
        .counters
        .as_ref()
        .as_ptr()
        .add(index)
        .cast::<AtomicI32>()
    }
  }

  fn store(&self, index: usize, value: i32) {
    self.counter(index).store(value, Ordering::SeqCst);
  }

  fn add(&self, index: usize) {
    self.counter(index).fetch_add(1, Ordering::SeqCst);
  }

  fn load(&self, index: usize) -> i32 {
    self.counter(index).load(Ordering::SeqCst)
  }

  fn wait_for(&self, index: usize, expected: i32) -> bool {
    let deadline = std::time::Instant::now() + TSFN_TEST_TIMEOUT;
    while self.load(index) != expected && std::time::Instant::now() < deadline {
      thread::sleep(Duration::from_millis(1));
    }
    self.load(index) == expected
  }

  fn finish_with_error(&self) {
    self.add(TSFN_BLOCKING_UNEXPECTED_INDEX);
    self.store(TSFN_BLOCKING_COMPLETED_INDEX, 1);
  }
}

#[cfg(not(target_family = "wasm"))]
struct PostFinalizeAddonProbe {
  entered_path: String,
  release_path: String,
  completed_path: String,
}

#[cfg(not(target_family = "wasm"))]
impl PostFinalizeAddonProbe {
  fn from_paths(
    entered_path: Option<String>,
    release_path: Option<String>,
    completed_path: Option<String>,
  ) -> Result<Option<Self>> {
    match (entered_path, release_path, completed_path) {
      (None, None, None) => Ok(None),
      (Some(entered_path), Some(release_path), Some(completed_path)) => Ok(Some(Self {
        entered_path,
        release_path,
        completed_path,
      })),
      _ => Err(Error::new(
        Status::InvalidArg,
        "post-finalization probe paths must be provided together",
      )),
    }
  }

  fn spawn(self, retained_tsfn: Option<ScenarioTsfn>) -> Result<()> {
    let (ready, started) = sync_channel(0);
    thread::spawn(move || {
      let entered_result = std::fs::write(&self.entered_path, b"entered")
        .map_err(|error| format!("failed to create post-finalization entered marker: {error}"));
      if ready.send(entered_result).is_err() {
        return;
      }

      let deadline = std::time::Instant::now() + Duration::from_secs(60);
      while !std::path::Path::new(&self.release_path).exists()
        && std::time::Instant::now() < deadline
      {
        thread::sleep(Duration::from_millis(1));
      }
      if !std::path::Path::new(&self.release_path).exists() {
        return;
      }
      if retained_tsfn.as_ref().is_some_and(|tsfn| !tsfn.aborted()) {
        return;
      }

      execute_post_finalize_addon_probe(&self.completed_path);
      drop(retained_tsfn);
    });
    started
      .recv()
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("post-finalization probe thread exited during setup: {error}"),
        )
      })?
      .map_err(|reason| Error::new(Status::GenericFailure, reason))
  }
}

#[cfg(not(target_family = "wasm"))]
#[inline(never)]
fn execute_post_finalize_addon_probe(completed_path: &str) {
  let _ = std::fs::write(completed_path, b"completed");
}

#[cfg(not(target_family = "wasm"))]
struct TsfnTeardownThread {
  stop: Sender<()>,
  worker: Mutex<Option<JoinHandle<()>>>,
  state: Arc<TsfnTeardownState>,
  identity_bit: i32,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnTeardownThread {
  fn new(state: Arc<TsfnTeardownState>, identity_bit: i32) -> (Arc<Self>, Receiver<()>) {
    let (stop, stopped) = channel();
    (
      Arc::new(Self {
        stop,
        worker: Mutex::new(None),
        state,
        identity_bit,
      }),
      stopped,
    )
  }

  fn install(&self, worker: JoinHandle<()>) {
    let previous = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .replace(worker);
    debug_assert!(previous.is_none());
  }

  fn quiesce(&self) {
    self
      .state
      .record_bit(TSFN_QUIESCENCE_FINALIZER_INDEX, self.identity_bit);
    #[cfg(not(feature = "noop"))]
    if try_start_async_runtime().is_ok() {
      self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
    let _ = self.stop.send(());
    let worker = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take();
    match worker {
      Some(worker) => {
        if worker.join().is_err() {
          self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
        }
        // Each worker owns its TSFN's last Rust handle. Reaching this point
        // proves that handle Drop completed while the native finalizer was
        // active; the identity bit lets JavaScript assert every worker did so.
        self
          .state
          .record_bit(TSFN_QUIESCENCE_JOIN_INDEX, self.identity_bit);
      }
      None => self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX),
    }
  }
}

#[cfg(not(target_family = "wasm"))]
struct TsfnFinalizerLivenessControl {
  stop: Sender<()>,
  worker: Mutex<Option<JoinHandle<()>>>,
  joined_path: String,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnFinalizerLivenessControl {
  fn install(&self, worker: JoinHandle<()>) {
    let previous = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .replace(worker);
    debug_assert!(previous.is_none());
  }

  fn quiesce(&self) {
    let _ = self.stop.send(());
    let worker = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("TSFN finalizer liveness worker must be installed");
    worker
      .join()
      .expect("TSFN finalizer liveness worker must not panic");
    std::fs::write(&self.joined_path, b"joined")
      .expect("TSFN finalizer liveness marker must be writable");
  }
}

#[cfg(not(target_family = "wasm"))]
fn start_tsfn_finalizer_liveness_worker<const WEAK: bool>(
  callback: Function<(), ()>,
  manual_stop_path: String,
  joined_path: String,
) -> Result<()> {
  let (stop, stopped) = channel();
  let control = Arc::new(TsfnFinalizerLivenessControl {
    stop,
    worker: Mutex::new(None),
    joined_path,
  });
  let finalizer_control = Arc::clone(&control);
  // SAFETY: The finalizer signals and joins the only native worker retaining
  // the TSFN, and never waits for a JavaScript callback or queued payload.
  let tsfn = unsafe {
    callback
      .build_threadsafe_function::<()>()
      .weak::<WEAK>()
      .build_callback_with_finalizer(|_| Ok(()), move || finalizer_control.quiesce())
  }?;
  let (ready, started) = sync_channel(0);
  let worker = thread::spawn(move || {
    if ready.send(()).is_err() {
      return;
    }
    loop {
      match stopped.recv_timeout(TSFN_FINALIZER_LIVENESS_POLL_INTERVAL) {
        Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
        Err(RecvTimeoutError::Timeout) => {
          if std::path::Path::new(&manual_stop_path).exists() {
            break;
          }
        }
      }
    }
    drop(tsfn);
  });
  control.install(worker);
  started.recv().map_err(|error| {
    Error::new(
      Status::GenericFailure,
      format!("TSFN finalizer liveness worker exited during setup: {error}"),
    )
  })
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn start_referenced_tsfn_finalizer_liveness_worker(
  callback: Function<(), ()>,
  manual_stop_path: String,
  joined_path: String,
) -> Result<()> {
  start_tsfn_finalizer_liveness_worker::<false>(callback, manual_stop_path, joined_path)
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn start_weak_tsfn_finalizer_liveness_worker(
  callback: Function<(), ()>,
  manual_stop_path: String,
  joined_path: String,
) -> Result<()> {
  start_tsfn_finalizer_liveness_worker::<true>(callback, manual_stop_path, joined_path)
}

#[cfg(not(target_family = "wasm"))]
struct TsfnTeardownPayload {
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
type ReentrantTsfn = ThreadsafeFunction<TsfnReentrantPayload, (), (), Status, false, false, 0>;

#[cfg(not(target_family = "wasm"))]
struct TsfnReentrantPayload {
  tsfn: Option<ReentrantTsfn>,
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnReentrantPayload {
  fn drop(&mut self) {
    self.state.add(TSFN_TEARDOWN_PAYLOAD_DROP_INDEX);
    if let Some(tsfn) = self.tsfn.take() {
      let status = tsfn.call(
        TsfnReentrantPayload {
          tsfn: None,
          state: Arc::clone(&self.state),
        },
        ThreadsafeFunctionCallMode::NonBlocking,
      );
      if status != Status::Closing {
        self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      }
    }
  }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnTeardownPayload {
  fn drop(&mut self) {
    self.state.add(TSFN_TEARDOWN_PAYLOAD_DROP_INDEX);
  }
}

#[cfg(not(target_family = "wasm"))]
impl TsfnTeardownPayload {
  fn plain(state: Arc<TsfnTeardownState>) -> Self {
    Self { state }
  }
}

#[cfg(not(target_family = "wasm"))]
#[derive(Clone, Copy)]
enum TsfnTeardownWaiterExpectation {
  CallbackResult,
  OneshotCanceled,
}

#[cfg(not(target_family = "wasm"))]
fn record_tsfn_teardown_waiter_result(
  state: &TsfnTeardownState,
  identity_bit: i32,
  expectation: TsfnTeardownWaiterExpectation,
  result: Result<()>,
) {
  let expected_error = match (expectation, result) {
    (TsfnTeardownWaiterExpectation::CallbackResult, Err(error)) => {
      error.status == Status::PendingException
        || (error.status == Status::GenericFailure
          && error.reason == "Receive value from threadsafe function sender failed")
    }
    (TsfnTeardownWaiterExpectation::OneshotCanceled, Err(error)) => {
      error.status == Status::GenericFailure && error.reason == "oneshot canceled"
    }
    _ => false,
  };
  if expected_error {
    state.record_bit(TSFN_TEARDOWN_WAITER_ERROR_MASK_INDEX, identity_bit);
  } else {
    state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
  }
  state.record_bit(TSFN_TEARDOWN_WAITER_SETTLED_MASK_INDEX, identity_bit);
}

#[cfg(not(target_family = "wasm"))]
fn drive_tsfn_teardown_waiter<F>(
  future: F,
  state: Arc<TsfnTeardownState>,
  identity_bit: i32,
  expectation: TsfnTeardownWaiterExpectation,
  ready: SyncSender<std::result::Result<(), String>>,
) where
  F: Future<Output = Result<()>>,
{
  let mut future = pin!(future);
  let waker = futures::task::noop_waker();
  let mut context = Context::from_waker(&waker);
  match future.as_mut().poll(&mut context) {
    Poll::Pending => {
      if ready.send(Ok(())).is_err() {
        return;
      }
    }
    Poll::Ready(result) => {
      state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      let _ = ready.send(Err(format!(
        "TSFN teardown waiter completed before environment teardown: {result:?}"
      )));
      return;
    }
  }

  record_tsfn_teardown_waiter_result(
    &state,
    identity_bit,
    expectation,
    futures::executor::block_on(future),
  );
}

#[cfg(not(target_family = "wasm"))]
fn prepare_tsfn_teardown_waiters(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  let callee_handled_call_async_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .callee_handled::<true>()
    .build_callback(|_| Ok(()))?;
  let call_async_catch_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .build_callback(|_| Ok(()))?;
  let unhandled_call_async_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .build_callback(|_| Ok(()))?;
  let bounded_call_async_catch_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .max_queue_size::<1>()
    .build_callback(|_| Ok(()))?;

  let (callee_handled_call_async_ready, callee_handled_call_async_started) = sync_channel(0);
  let callee_handled_call_async_state = Arc::clone(state);
  thread::spawn(move || {
    let future = callee_handled_call_async_tsfn.call_async(Ok(TsfnTeardownPayload::plain(
      Arc::clone(&callee_handled_call_async_state),
    )));
    drive_tsfn_teardown_waiter(
      future,
      callee_handled_call_async_state,
      TSFN_CALLEE_HANDLED_CALL_ASYNC_WAITER_BIT,
      TsfnTeardownWaiterExpectation::CallbackResult,
      callee_handled_call_async_ready,
    );
  });

  let (call_async_catch_ready, call_async_catch_started) = sync_channel(0);
  let call_async_catch_state = Arc::clone(state);
  thread::spawn(move || {
    let future = call_async_catch_tsfn.call_async_catch(TsfnTeardownPayload::plain(Arc::clone(
      &call_async_catch_state,
    )));
    drive_tsfn_teardown_waiter(
      future,
      call_async_catch_state,
      TSFN_CALL_ASYNC_CATCH_WAITER_BIT,
      TsfnTeardownWaiterExpectation::CallbackResult,
      call_async_catch_ready,
    );
  });

  let (unhandled_call_async_ready, unhandled_call_async_started) = sync_channel(0);
  let unhandled_call_async_state = Arc::clone(state);
  thread::spawn(move || {
    let future = unhandled_call_async_tsfn.call_async(TsfnTeardownPayload::plain(Arc::clone(
      &unhandled_call_async_state,
    )));
    drive_tsfn_teardown_waiter(
      future,
      unhandled_call_async_state,
      TSFN_UNHANDLED_CALL_ASYNC_WAITER_BIT,
      TsfnTeardownWaiterExpectation::OneshotCanceled,
      unhandled_call_async_ready,
    );
  });

  let (bounded_ready, bounded_started) = sync_channel(0);
  let bounded_state = Arc::clone(state);
  thread::spawn(move || {
    let first = bounded_call_async_catch_tsfn
      .call_async_catch(TsfnTeardownPayload::plain(Arc::clone(&bounded_state)));
    let mut first = pin!(first);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    if let Poll::Ready(result) = first.as_mut().poll(&mut context) {
      bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      let _ = bounded_ready.send(Err(format!(
        "bounded TSFN teardown waiter completed before environment teardown: {result:?}"
      )));
      return;
    }

    let second = bounded_call_async_catch_tsfn
      .call_async_catch(TsfnTeardownPayload::plain(Arc::clone(&bounded_state)));
    let mut second = pin!(second);
    match second.as_mut().poll(&mut context) {
      Poll::Ready(Err(error)) if error.status == Status::QueueFull => {
        if bounded_state.load(TSFN_TEARDOWN_PAYLOAD_DROP_INDEX) != 1 {
          bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
          let _ = bounded_ready.send(Err(
            "QueueFull TSFN payload was not reclaimed before the future completed".to_owned(),
          ));
          return;
        }
        bounded_state.add(TSFN_TEARDOWN_QUEUE_FULL_INDEX);
      }
      Poll::Ready(result) => {
        bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
        let _ = bounded_ready.send(Err(format!(
          "bounded TSFN second call did not fail with QueueFull: {result:?}"
        )));
        return;
      }
      Poll::Pending => {
        bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
        let _ = bounded_ready.send(Err(
          "bounded TSFN second call remained pending instead of failing with QueueFull".to_owned(),
        ));
        return;
      }
    }

    if bounded_ready.send(Ok(())).is_err() {
      return;
    }
    record_tsfn_teardown_waiter_result(
      &bounded_state,
      TSFN_BOUNDED_CALL_ASYNC_CATCH_WAITER_BIT,
      TsfnTeardownWaiterExpectation::CallbackResult,
      futures::executor::block_on(first),
    );
  });

  for started in [
    callee_handled_call_async_started,
    call_async_catch_started,
    unhandled_call_async_started,
    bounded_started,
  ] {
    started
      .recv()
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("TSFN teardown waiter thread exited during setup: {error}"),
        )
      })?
      .map_err(|reason| Error::new(Status::GenericFailure, reason))?;
  }
  Ok(())
}

#[cfg(not(target_family = "wasm"))]
type ClosingTsfn = ThreadsafeFunction<TsfnClosingPayload, (), (), Status, false, false, 0>;

#[cfg(not(target_family = "wasm"))]
struct TsfnClosingPayload {
  dropped: Arc<AtomicBool>,
  reentrant_tsfn: Option<ClosingTsfn>,
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
struct TsfnClosingFinalizerDrop {
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnClosingFinalizerDrop {
  fn drop(&mut self) {
    if self.state.load(TSFN_QUIESCENCE_FINALIZER_INDEX) != TSFN_SCENARIO_WORKER_BIT {
      self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
    #[cfg(not(feature = "noop"))]
    if try_start_async_runtime().is_ok() {
      self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
    self.state.add(TSFN_CLOSING_FINALIZER_DROP_INDEX);
    panic!("TSFN finalizer capture drop panic");
  }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnClosingPayload {
  fn drop(&mut self) {
    self.dropped.store(true, Ordering::SeqCst);
    if let Some(tsfn) = self.reentrant_tsfn.take() {
      let status = tsfn.call(
        TsfnClosingPayload {
          dropped: Arc::clone(&self.dropped),
          reentrant_tsfn: None,
          state: Arc::clone(&self.state),
        },
        ThreadsafeFunctionCallMode::NonBlocking,
      );
      if status != Status::Closing {
        self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      }
    }
  }
}

#[cfg(not(target_family = "wasm"))]
fn verify_tsfn_closing_ownership(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<TsfnClosingPayload>()
    .build_callback(|_| Ok(()))?;
  // SAFETY: This TSFN has no native workers, tasks, or queued payloads.
  unsafe { tsfn.register_finalizer(|| {}) }?;
  // SAFETY: No worker exists yet. If duplicate-registration rejection regresses,
  // expect_err unwinds before one is spawned, so this empty callback cannot
  // leave native work running and never waits for JavaScript callbacks.
  let duplicate_error = unsafe { tsfn.register_finalizer(|| {}) }
    .expect_err("duplicate TSFN finalizer registration must fail");
  if duplicate_error.status != Status::InvalidArg {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "duplicate TSFN finalizer registration returned {:?}",
        duplicate_error.status
      ),
    ));
  }

  tsfn.abort()?;
  let (finished, result) = sync_channel(0);
  let background_tsfn = tsfn.clone();
  // SAFETY: No worker has been spawned yet. If closing-state rejection regresses,
  // expect_err unwinds before the spawn below, so this empty callback cannot
  // leave native work running and never waits for JavaScript callbacks.
  let late_error = unsafe { background_tsfn.register_finalizer(|| {}) }
    .expect_err("closing TSFN finalizer registration must fail");
  if late_error.status != Status::Closing {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "closing TSFN finalizer registration returned {:?}",
        late_error.status
      ),
    ));
  }
  let background_state = Arc::clone(state);
  let background_thread = thread::spawn(move || {
    let first_dropped = Arc::new(AtomicBool::new(false));
    let first_status = background_tsfn.call(
      TsfnClosingPayload {
        dropped: Arc::clone(&first_dropped),
        reentrant_tsfn: Some(background_tsfn.clone()),
        state: Arc::clone(&background_state),
      },
      ThreadsafeFunctionCallMode::Blocking,
    );
    if first_status != Status::Closing
      || !first_dropped.load(Ordering::SeqCst)
      || !background_tsfn.aborted()
    {
      let _ = finished.send(Err(format!(
        "first closing call was not rejected locally: status={first_status:?}, dropped={}, aborted={}",
        first_dropped.load(Ordering::SeqCst),
        background_tsfn.aborted()
      )));
      return;
    }

    let second_dropped = Arc::new(AtomicBool::new(false));
    let second_status = background_tsfn.call(
      TsfnClosingPayload {
        dropped: Arc::clone(&second_dropped),
        reentrant_tsfn: None,
        state: Arc::clone(&background_state),
      },
      ThreadsafeFunctionCallMode::NonBlocking,
    );
    if second_status != Status::Closing || !second_dropped.load(Ordering::SeqCst) {
      let _ = finished.send(Err(format!(
        "post-closing call reached N-API or leaked its payload: status={second_status:?}, dropped={}",
        second_dropped.load(Ordering::SeqCst)
      )));
      return;
    }

    drop(background_tsfn);
    let _ = finished.send(Ok(()));
  });

  let background_result = result
    .recv()
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("TSFN closing regression thread exited early: {error}"),
      )
    })
    .and_then(|result| result.map_err(|reason| Error::new(Status::GenericFailure, reason)));
  let join_result = background_thread.join().map_err(|_| {
    Error::new(
      Status::GenericFailure,
      "TSFN closing regression thread panicked",
    )
  });
  background_result.and(join_result)
}

#[cfg(not(target_family = "wasm"))]
fn verify_shared_tsfn_abort(callback: &Function<(), ()>) -> Result<()> {
  let tsfn = Arc::new(
    callback
      .build_threadsafe_function::<()>()
      .max_queue_size::<1>()
      .build_callback(|_| Ok(()))?,
  );
  // SAFETY: The only worker is joined below before this function returns, and
  // the finalizer never waits for queued JavaScript callbacks.
  unsafe { tsfn.register_finalizer(|| {}) }?;

  let first_status = tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
  if first_status != Status::Ok {
    return Err(Error::new(
      Status::GenericFailure,
      format!("failed to fill the shared-abort TSFN queue: {first_status:?}"),
    ));
  }

  let blocking_tsfn = Arc::clone(&tsfn);
  let (entered, started) = sync_channel(0);
  let (finished, result) = sync_channel(0);
  let worker = thread::spawn(move || {
    if entered.send(()).is_err() {
      return;
    }
    let _ = finished.send(blocking_tsfn.call((), ThreadsafeFunctionCallMode::Blocking));
  });
  started.recv().map_err(|error| {
    Error::new(
      Status::GenericFailure,
      format!("shared-abort TSFN worker exited before blocking: {error}"),
    )
  })?;
  thread::sleep(Duration::from_millis(50));

  tsfn.abort()?;
  let blocking_status = result.recv_timeout(TSFN_TEST_TIMEOUT).map_err(|error| {
    Error::new(
      Status::WouldDeadlock,
      format!("shared TSFN abort did not wake its blocking caller: {error}"),
    )
  })?;
  let join_result = worker
    .join()
    .map_err(|_| Error::new(Status::GenericFailure, "shared-abort TSFN worker panicked"));
  if blocking_status != Status::Closing {
    return Err(Error::new(
      Status::GenericFailure,
      format!("shared-abort TSFN caller returned {blocking_status:?}"),
    ));
  }
  join_result
}

#[cfg(not(target_family = "wasm"))]
type ScenarioTsfn = ThreadsafeFunction<(), (), (), Status, false, false, 0>;

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn prepare_tsfn_blocking_call_regression(
  callback: Function<u32, ()>,
  counters: Int32Array,
  expect_cleanup_abort: bool,
) -> Result<()> {
  let state = TsfnBlockingState::new(counters)?;
  let tsfn = callback
    .build_threadsafe_function::<u32>()
    .max_queue_size::<1>()
    .build_callback(|ctx| Ok(ctx.value))?;
  let (ready, started) = sync_channel(0);
  thread::spawn(move || {
    let first_status = tsfn.call(0, ThreadsafeFunctionCallMode::NonBlocking);
    if first_status != Status::Ok {
      let _ = ready.send(Err(format!(
        "failed to enqueue the callback gate payload: {first_status:?}"
      )));
      state.finish_with_error();
      return;
    }
    if ready.send(Ok(())).is_err() {
      let _ = tsfn.abort();
      return;
    }

    if !state.wait_for(TSFN_BLOCKING_CALLBACK_ENTERED_INDEX, 1) {
      state.finish_with_error();
      let _ = tsfn.abort();
      return;
    }
    let queued_status = tsfn.call(1, ThreadsafeFunctionCallMode::NonBlocking);
    if queued_status != Status::Ok {
      state.finish_with_error();
      let _ = tsfn.abort();
      return;
    }
    state.store(TSFN_BLOCKING_QUEUE_FILLED_INDEX, 1);
    state.store(TSFN_BLOCKING_CALL_STARTED_INDEX, 1);

    let blocking_status = tsfn.call(2, ThreadsafeFunctionCallMode::Blocking);
    if expect_cleanup_abort {
      if blocking_status != Status::Ok && blocking_status != Status::Closing {
        state.finish_with_error();
        return;
      }
      state.store(TSFN_BLOCKING_CALL_RETURNED_INDEX, 1);
      state.store(TSFN_BLOCKING_COMPLETED_INDEX, 1);
      return;
    }
    if blocking_status != Status::Ok {
      state.finish_with_error();
      return;
    }
    state.store(TSFN_BLOCKING_CALL_RETURNED_INDEX, 1);
    if !state.wait_for(
      TSFN_BLOCKING_CALLBACK_MASK_INDEX,
      TSFN_BLOCKING_CALLBACK_MASK,
    ) {
      state.finish_with_error();
      return;
    }
    state.store(TSFN_BLOCKING_COMPLETED_INDEX, 1);
  });
  started
    .recv()
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("TSFN blocking regression thread exited during setup: {error}"),
      )
    })?
    .map_err(|reason| Error::new(Status::GenericFailure, reason))
}

#[cfg(not(target_family = "wasm"))]
fn install_tsfn_holder(
  control: &Arc<TsfnTeardownThread>,
  stop: Receiver<()>,
  tsfn: ScenarioTsfn,
  state: Arc<TsfnTeardownState>,
) -> Receiver<std::result::Result<(), String>> {
  let (ready, started) = sync_channel(0);
  control.install(thread::spawn(move || {
    if ready.send(Ok(())).is_err() {
      return;
    }
    if stop.recv().is_err() || !tsfn.aborted() {
      state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
  }));
  started
}

#[cfg(not(target_family = "wasm"))]
fn wait_for_tsfn_holder(started: Receiver<std::result::Result<(), String>>) -> Result<()> {
  started
    .recv()
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("TSFN holder thread exited before setup completed: {error}"),
      )
    })?
    .map_err(|reason| Error::new(Status::GenericFailure, reason))
}

#[cfg(not(target_family = "wasm"))]
fn prepare_clean_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  verify_tsfn_closing_ownership(callback, state)?;
  verify_shared_tsfn_abort(callback)?;

  let (control, stop) = TsfnTeardownThread::new(Arc::clone(state), TSFN_SCENARIO_WORKER_BIT);
  let finalizer_control = Arc::clone(&control);
  // SAFETY: quiesce signals and joins the only worker that owns this TSFN and
  // never waits for a queued JavaScript callback.
  let tsfn = unsafe {
    callback
      .build_threadsafe_function::<()>()
      .build_callback_with_finalizer(|_| Ok(()), move || finalizer_control.quiesce())
  }?;
  let started = install_tsfn_holder(&control, stop, tsfn, Arc::clone(state));
  wait_for_tsfn_holder(started)
}

#[cfg(not(target_family = "wasm"))]
fn prepare_finalizer_panic_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
  probe: PostFinalizeAddonProbe,
) -> Result<()> {
  let (control, stop) = TsfnTeardownThread::new(Arc::clone(state), TSFN_SCENARIO_WORKER_BIT);
  let finalizer_control = Arc::clone(&control);
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(|_| Ok(()))?;
  // SAFETY: quiesce joins the only native worker before the intentional panic.
  // The panic is used to verify that finalization retains the native module.
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_control.quiesce();
      panic!("TSFN quiescence finalizer panic");
    })
  }?;
  let started = install_tsfn_holder(&control, stop, tsfn, Arc::clone(state));
  wait_for_tsfn_holder(started)?;
  probe.spawn(None)
}

#[cfg(not(target_family = "wasm"))]
fn prepare_callback_drop_panic_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
  probe: PostFinalizeAddonProbe,
) -> Result<()> {
  let callback_drop = TsfnClosingFinalizerDrop {
    state: Arc::clone(state),
  };
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(move |_| {
      let _keep_alive = &callback_drop;
      Ok(())
    })?;
  let (control, stop) = TsfnTeardownThread::new(Arc::clone(state), TSFN_SCENARIO_WORKER_BIT);
  let finalizer_control = Arc::clone(&control);
  // SAFETY: quiesce joins the only native worker before the JavaScript callback
  // capture is destroyed. The capture's Drop verifies that ordering.
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_control.quiesce();
    })
  }?;
  let started = install_tsfn_holder(&control, stop, tsfn, Arc::clone(state));
  wait_for_tsfn_holder(started)?;
  probe.spawn(None)
}

#[cfg(not(target_family = "wasm"))]
fn prepare_unregistered_finalizer_tsfn_scenario(
  callback: &Function<(), ()>,
  probe: PostFinalizeAddonProbe,
) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(|_| Ok(()))?;
  probe.spawn(Some(tsfn))
}

#[cfg(not(target_family = "wasm"))]
fn prepare_pending_payload_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  let reentrant_tsfn: ReentrantTsfn = callback
    .build_threadsafe_function::<TsfnReentrantPayload>()
    .build_callback(|_| Ok(()))?;
  let reentrant_status = reentrant_tsfn.call(
    TsfnReentrantPayload {
      tsfn: Some(reentrant_tsfn.clone()),
      state: Arc::clone(state),
    },
    ThreadsafeFunctionCallMode::NonBlocking,
  );
  if reentrant_status != Status::Ok {
    return Err(Error::new(
      Status::GenericFailure,
      format!("failed to enqueue the reentrant TSFN payload: {reentrant_status:?}"),
    ));
  }
  reentrant_tsfn.abort()?;
  prepare_tsfn_teardown_waiters(callback, state)
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn prepare_tsfn_teardown_regression(
  callback: Function<(), ()>,
  counters: Int32Array,
  scenario: String,
  post_finalize_entered_path: Option<String>,
  post_finalize_release_path: Option<String>,
  post_finalize_completed_path: Option<String>,
) -> Result<()> {
  let state = TsfnTeardownState::new(counters)?;
  for index in 0..TSFN_TEARDOWN_COUNTER_COUNT {
    if state.load(index) != 0 {
      return Err(Error::new(
        Status::InvalidArg,
        "TSFN teardown counters must be zero-initialized",
      ));
    }
  }
  let probe = PostFinalizeAddonProbe::from_paths(
    post_finalize_entered_path,
    post_finalize_release_path,
    post_finalize_completed_path,
  )?;

  match scenario.as_str() {
    "clean" => prepare_clean_tsfn_scenario(&callback, &state),
    "finalizer-panic" => prepare_finalizer_panic_tsfn_scenario(
      &callback,
      &state,
      probe.ok_or_else(|| {
        Error::new(
          Status::InvalidArg,
          "finalizer-panic requires post-finalization probe paths",
        )
      })?,
    ),
    "callback-drop-panic" => prepare_callback_drop_panic_tsfn_scenario(
      &callback,
      &state,
      probe.ok_or_else(|| {
        Error::new(
          Status::InvalidArg,
          "callback-drop-panic requires post-finalization probe paths",
        )
      })?,
    ),
    "unregistered-finalizer" => prepare_unregistered_finalizer_tsfn_scenario(
      &callback,
      probe.ok_or_else(|| {
        Error::new(
          Status::InvalidArg,
          "unregistered-finalizer requires post-finalization probe paths",
        )
      })?,
    ),
    "pending-payload" => prepare_pending_payload_tsfn_scenario(&callback, &state),
    _ => Err(Error::new(
      Status::InvalidArg,
      format!("Unknown TSFN teardown scenario: {scenario}"),
    )),
  }
}

#[napi]
pub fn call_threadsafe_function(
  tsfn: Arc<ThreadsafeFunction<u32, UnknownReturnValue>>,
) -> Result<()> {
  for n in 0..100 {
    let tsfn = tsfn.clone();
    thread::spawn(move || {
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    });
  }
  Ok(())
}

#[napi]
pub fn call_long_threadsafe_function(
  tsfn: ThreadsafeFunction<u32, UnknownReturnValue>,
) -> Result<()> {
  thread::spawn(move || {
    for n in 0..10 {
      thread::sleep(Duration::from_millis(100));
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    }
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_throw_error(
  cb: ThreadsafeFunction<bool, UnknownReturnValue>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(
      Err(Error::new(
        Status::GenericFailure,
        "ThrowFromNative".to_owned(),
      )),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });
  Ok(())
}

pub struct ErrorStatus(String);
impl AsRef<str> for ErrorStatus {
  fn as_ref(&self) -> &str {
    &self.0
  }
}

impl From<Status> for ErrorStatus {
  fn from(value: Status) -> Self {
    ErrorStatus(value.to_string())
  }
}

#[cfg(target_family = "wasm")]
#[napi(skip_typescript)]
pub fn drop_unregistered_weak_tsfn_for_wasi(callback: Function<(), ()>) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .weak::<true>()
    .build_callback(|_| Ok(()))?;
  drop(tsfn);
  Ok(())
}

#[napi]
pub fn threadsafe_function_throw_error_with_status(
  cb: ThreadsafeFunction<bool, UnknownReturnValue, bool, ErrorStatus>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(
      Err(Error::new(
        ErrorStatus("CustomErrorStatus".to_string()),
        "ThrowFromNative".to_owned(),
      )),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_build_throw_error_with_status(
  cb: Function<'static, (), ()>,
) -> Result<()> {
  let tsfn = cb
    .build_threadsafe_function()
    .error_status::<ErrorStatus>()
    .callee_handled::<true>()
    .build()?;
  thread::spawn(move || {
    tsfn.call(
      Err(Error::new(
        ErrorStatus("CustomErrorStatus".to_string()),
        "ThrowFromNative".to_owned(),
      )),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode(
  cb: ThreadsafeFunction<bool, UnknownReturnValue, bool, Status, false>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(true, ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode_error(
  cb: ThreadsafeFunction<bool, String, bool, Status, false>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call_with_return_value(true, ThreadsafeFunctionCallMode::Blocking, |ret, _| {
      ret.map(|_| ())
    });
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_rust_panic(cb: Function<(), ()>) -> Result<()> {
  let tsfn = cb
    .build_threadsafe_function::<()>()
    .build_callback(|_| -> Result<()> {
      panic!("TSFN Rust callback panic");
    })?;
  thread::spawn(move || {
    tsfn.call((), ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_rust_panic_callee_handled(cb: Function<Error, ()>) -> Result<()> {
  let tsfn = cb
    .build_threadsafe_function::<()>()
    .callee_handled::<true>()
    .build_callback(|_| -> Result<()> {
      panic!("TSFN Rust callback handled panic");
    })?;
  thread::spawn(move || {
    tsfn.call(Ok(()), ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
fn threadsafe_function_closure_capture(
  env: Env,
  default_value: ClassInstance<Animal>,
  func: Function<Reference<Animal>, ()>,
) -> napi::Result<()> {
  let str = "test";
  let default_value_reference = default_value.clone_reference(env)?;
  let tsfn = func
    .build_threadsafe_function::<()>()
    .build_callback(move |ctx| {
      println!("Captured in ThreadsafeFunction {}", str); // str is NULL at this point
      default_value_reference.clone(ctx.env)
    })?;

  tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);

  Ok(())
}

#[napi]
pub fn tsfn_call_with_callback(tsfn: ThreadsafeFunction<(), String>) -> napi::Result<()> {
  tsfn.call_with_return_value(
    Ok(()),
    ThreadsafeFunctionCallMode::NonBlocking,
    |value: Result<String>, _| {
      let value = value.expect("Failed to retrieve value from JS");
      println!("{}", value);
      assert_eq!(value, "ReturnFromJavaScriptRawCallback".to_owned());
      Ok(())
    },
  );
  Ok(())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn tsfn_async_call<'env>(
  env: &'env Env,
  func: Function<FnArgs<(u32, u32, u32)>, String>,
) -> napi::Result<PromiseRaw<'env, ()>> {
  let tsfn = func.build_threadsafe_function().build()?;

  env.spawn_future(async move {
    let msg = tsfn.call_async((0, 1, 2).into()).await?;
    assert_eq!(msg, "ReturnFromJavaScriptRawCallback".to_owned());
    Ok(())
  })
}

#[napi]
pub fn accept_threadsafe_function(func: ThreadsafeFunction<u32>) {
  thread::spawn(move || {
    func.call(Ok(1), ThreadsafeFunctionCallMode::NonBlocking);
  });
}

#[napi]
pub fn accept_threadsafe_function_fatal(func: ThreadsafeFunction<u32, (), u32, Status, false>) {
  thread::spawn(move || {
    func.call(1, ThreadsafeFunctionCallMode::NonBlocking);
  });
}

#[napi]
pub fn accept_threadsafe_function_tuple_args(
  func: ThreadsafeFunction<FnArgs<(u32, bool, String)>>,
) {
  thread::spawn(move || {
    func.call(
      Ok((1, false, "NAPI-RS".into()).into()),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });
}

#[napi]
pub fn accept_threadsafe_function_tuple_no_fn_args(func: ThreadsafeFunction<(u32, bool, String)>) {
  thread::spawn(move || {
    func.call(
      Ok((1, false, "NAPI-RS".into())),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });
}

#[napi]
pub async fn tsfn_return_promise(func: ThreadsafeFunction<u32, Promise<u32>>) -> Result<u32> {
  let val = func.call_async(Ok(1)).await?.await?;
  Ok(val + 2)
}

#[napi]
pub async fn tsfn_return_promise_timeout(
  func: ThreadsafeFunction<u32, Promise<u32>>,
) -> Result<u32> {
  use tokio::time::{self, Duration};
  let promise = func.call_async(Ok(1)).await?;
  let sleep = time::sleep(Duration::from_nanos(1));
  tokio::select! {
    _ = sleep => {
      Err(Error::new(Status::GenericFailure, "Timeout".to_owned()))
    }
    value = promise => {
      Ok(value? + 2)
    }
  }
}

#[napi]
pub fn call_async_with_unknown_return_value<'env>(
  env: &'env Env,
  tsfn: ThreadsafeFunction<u32, UnknownRef>,
) -> Result<PromiseRaw<'env, u32>> {
  env.spawn_future_with_callback(
    async move {
      let return_value = tsfn.call_async(Ok(42)).await?;
      Ok(return_value)
    },
    |env, value| {
      let return_value = value.get_value(env)?;
      let return_value = match return_value.get_type()? {
        ValueType::Object => Ok(110),
        _ => Ok(100),
      };
      value.unref(env)?;
      return_value
    },
  )
}

#[napi]
pub async fn tsfn_throw_from_js(tsfn: ThreadsafeFunction<u32, Promise<u32>>) -> napi::Result<u32> {
  tsfn.call_async(Ok(42)).await?.await
}

#[napi]
pub async fn tsfn_throw_from_js_catch(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> napi::Result<()> {
  tsfn.call_async_catch(("foo".to_string(),).into()).await
}

#[napi]
pub async fn tsfn_throw_from_js_catch_handled(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, ()>,
) -> napi::Result<()> {
  tsfn.call_async_catch(Ok(("foo".to_string(),).into())).await
}

#[napi]
pub async fn tsfn_throw_from_js_catch_recover(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> napi::Result<()> {
  match tsfn.call_async_catch(("trigger".to_string(),).into()).await {
    Ok(_) => Err(Error::new(
      Status::GenericFailure,
      "expected JS callback to throw, but it returned successfully".to_owned(),
    )),
    Err(err) => {
      // err.status should be PendingException because the source was a JS throw.
      if err.status != Status::PendingException {
        return Err(Error::new(
          Status::GenericFailure,
          format!("expected PendingException, got {:?}", err.status),
        ));
      }
      // Propagate the Err. Because err.maybe_raw holds a napi_ref to the
      // original JS exception object, `ToNapiValue for Error` recovers that
      // exact object on the way back to JS — so the JS test will see the
      // original error instance with all custom properties (e.g. `code`).
      Err(err)
    }
  }
}

#[napi]
pub async fn tsfn_throw_from_js_catch_drop_in_thread(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> napi::Result<String> {
  match tsfn.call_async_catch(("foo".to_string(),).into()).await {
    Ok(()) => Err(Error::new(
      Status::GenericFailure,
      "expected JS callback to throw, but it returned successfully".to_owned(),
    )),
    Err(err) => {
      let reason = err.reason.clone();
      // Drop the error on a different thread, like error values that are sent
      // across threads in real applications. On wasm targets this used to crash
      // the wasi worker with `Cannot read properties of undefined (reading
      // 'checkGCAccess')` because the error held a `napi_ref` created on the JS
      // thread. See https://github.com/rolldown/rolldown/issues/10075
      thread::spawn(move || drop(err))
        .join()
        .map_err(|_| Error::new(Status::GenericFailure, "drop thread panicked".to_owned()))?;
      Ok(reason)
    }
  }
}

#[napi]
pub async fn tsfn_throw_from_js_callback_contains_tsfn(
  tsfn: ThreadsafeFunction<u32, Promise<u32>>,
) {
  std::thread::spawn(move || {
    if let Err(e) = napi::bindgen_prelude::block_on(async move {
      tsfn.call_async(Ok(42)).await?.await?;
      Ok::<(), Error>(())
    }) {
      println!("Error in tsfn spawned thread: {}", e);
    }
  });
}

#[napi]
pub fn spawn_thread_in_thread(tsfn: ThreadsafeFunction<u32, u32>) {
  std::thread::spawn(move || {
    std::thread::spawn(move || {
      tsfn.call(Ok(42), ThreadsafeFunctionCallMode::NonBlocking);
    });
  });
}

#[napi(object, object_to_js = false)]
pub struct Pet {
  pub name: String,
  pub kind: u32,
  pub either_tsfn: Either<String, ThreadsafeFunction<i32, i32>>,
}

#[napi]
pub fn tsfn_in_either(pet: Pet) {
  if let Either::B(tsfn) = pet.either_tsfn {
    thread::spawn(move || {
      tsfn.call(Ok(42), ThreadsafeFunctionCallMode::NonBlocking);
    });
  }
}

#[napi]
pub async fn tsfn_weak(
  tsfn: ThreadsafeFunction<(), (), (), Status, false, true>,
) -> napi::Result<()> {
  tsfn.call_async(()).await
}
