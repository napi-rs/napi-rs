use std::{sync::Arc, thread, time::Duration};

#[cfg(not(target_family = "wasm"))]
use std::{
  future::Future,
  pin::pin,
  sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    mpsc::{sync_channel, RecvTimeoutError, SyncSender},
  },
  task::{Context, Poll},
};

#[cfg(not(target_family = "wasm"))]
use napi::threadsafe_function::ThreadsafeFunctionHandle;
use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
  UnknownRef,
};

use crate::class::Animal;

#[cfg(not(target_family = "wasm"))]
static TSFN_TEARDOWN_PAYLOAD_DROP_COUNT: AtomicU32 = AtomicU32::new(0);
#[cfg(not(target_family = "wasm"))]
static TSFN_TEARDOWN_WAITER_ERROR_COUNT: AtomicU32 = AtomicU32::new(0);
#[cfg(not(target_family = "wasm"))]
static TSFN_TEARDOWN_QUEUE_FULL_ERROR_COUNT: AtomicU32 = AtomicU32::new(0);
#[cfg(not(target_family = "wasm"))]
static TSFN_TEARDOWN_UNEXPECTED_WAITER_COUNT: AtomicU32 = AtomicU32::new(0);
#[cfg(not(target_family = "wasm"))]
static TSFN_TEARDOWN_JS_CALLBACK_COUNT: AtomicU32 = AtomicU32::new(0);

#[cfg(not(target_family = "wasm"))]
struct TsfnTeardownPayload {
  reentrant_handle: Option<Arc<ThreadsafeFunctionHandle>>,
}

#[cfg(not(target_family = "wasm"))]
type ReentrantTsfn = ThreadsafeFunction<TsfnReentrantPayload, (), (), Status, false, false, 0>;

#[cfg(not(target_family = "wasm"))]
struct TsfnReentrantPayload {
  tsfn: Option<ReentrantTsfn>,
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnReentrantPayload {
  fn drop(&mut self) {
    TSFN_TEARDOWN_PAYLOAD_DROP_COUNT.fetch_add(1, Ordering::SeqCst);
    if let Some(tsfn) = self.tsfn.take() {
      let status = tsfn.call(
        TsfnReentrantPayload { tsfn: None },
        ThreadsafeFunctionCallMode::NonBlocking,
      );
      if status != Status::Ok && status != Status::Closing {
        TSFN_TEARDOWN_UNEXPECTED_WAITER_COUNT.fetch_add(1, Ordering::SeqCst);
      }
    }
  }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnTeardownPayload {
  fn drop(&mut self) {
    TSFN_TEARDOWN_PAYLOAD_DROP_COUNT.fetch_add(1, Ordering::SeqCst);
    if let Some(handle) = self.reentrant_handle.take() {
      handle.with_write_aborted(|guard| drop(guard));
    }
  }
}

#[cfg(not(target_family = "wasm"))]
impl TsfnTeardownPayload {
  fn plain() -> Self {
    Self {
      reentrant_handle: None,
    }
  }
}

#[cfg(not(target_family = "wasm"))]
struct TsfnClosingPayload {
  dropped: Arc<AtomicBool>,
  reentrant_handle: Arc<ThreadsafeFunctionHandle>,
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnClosingPayload {
  fn drop(&mut self) {
    self.dropped.store(true, Ordering::SeqCst);
    self
      .reentrant_handle
      .with_write_aborted(|guard| drop(guard));
  }
}

#[cfg(not(target_family = "wasm"))]
fn verify_tsfn_closing_ownership(callback: &Function<(), ()>) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<TsfnClosingPayload>()
    .build_callback(|_| Ok(()))?;
  let raw = tsfn.raw();
  for slot_name in ["sentinel", "abort"] {
    let acquire_status = unsafe { napi::sys::napi_acquire_threadsafe_function(raw) };
    if acquire_status != napi::sys::Status::napi_ok {
      return Err(Error::new(
        Status::from(acquire_status),
        format!("Failed to acquire the TSFN closing regression {slot_name} slot"),
      ));
    }
  }
  let abort_status = unsafe {
    napi::sys::napi_release_threadsafe_function(
      raw,
      napi::sys::ThreadsafeFunctionReleaseMode::abort,
    )
  };
  if abort_status != napi::sys::Status::napi_ok {
    return Err(Error::new(
      Status::from(abort_status),
      "Failed to begin the TSFN closing regression",
    ));
  }

  let (finished, result) = sync_channel(0);
  thread::spawn(move || {
    let handle = Arc::clone(&tsfn.handle);
    let first_dropped = Arc::new(AtomicBool::new(false));
    let first_status = tsfn.call(
      TsfnClosingPayload {
        dropped: Arc::clone(&first_dropped),
        reentrant_handle: Arc::clone(&handle),
      },
      ThreadsafeFunctionCallMode::Blocking,
    );
    if first_status != Status::Closing || !first_dropped.load(Ordering::SeqCst) || !tsfn.aborted() {
      let _ = finished.send(Err(format!(
        "first closing call was not rejected locally: status={first_status:?}, dropped={}, aborted={}",
        first_dropped.load(Ordering::SeqCst),
        tsfn.aborted()
      )));
      return;
    }

    let second_dropped = Arc::new(AtomicBool::new(false));
    let second_status = tsfn.call(
      TsfnClosingPayload {
        dropped: Arc::clone(&second_dropped),
        reentrant_handle: handle,
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

    drop(tsfn);
    let _ = finished.send(Ok(()));
  });

  result
    .recv()
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("TSFN closing regression thread exited early: {error}"),
      )
    })?
    .map_err(|reason| Error::new(Status::GenericFailure, reason))?;

  let sentinel_status = unsafe {
    napi::sys::napi_call_threadsafe_function(
      raw,
      std::ptr::null_mut(),
      napi::sys::ThreadsafeFunctionCallMode::nonblocking,
    )
  };
  if sentinel_status != napi::sys::Status::napi_closing {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "locally rejected calls consumed the sentinel slot: status={:?}",
        Status::from(sentinel_status)
      ),
    ));
  }
  let exhausted_status = unsafe {
    napi::sys::napi_call_threadsafe_function(
      raw,
      std::ptr::null_mut(),
      napi::sys::ThreadsafeFunctionCallMode::nonblocking,
    )
  };
  if exhausted_status != napi::sys::Status::napi_invalid_arg {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "TSFN owner slot remained after handle drop: status={:?}",
        Status::from(exhausted_status)
      ),
    ));
  }
  Ok(())
}

#[cfg(not(target_family = "wasm"))]
fn abort_tsfn_raw_with_caller_slot(raw: napi::sys::napi_threadsafe_function) {
  let acquire_status = unsafe { napi::sys::napi_acquire_threadsafe_function(raw) };
  if acquire_status == napi::sys::Status::napi_ok {
    unsafe {
      napi::sys::napi_release_threadsafe_function(
        raw,
        napi::sys::ThreadsafeFunctionReleaseMode::abort,
      );
    }
  }
}

#[cfg(not(target_family = "wasm"))]
fn verify_tsfn_call_mode_concurrency_once(callback: &Function<(), ()>) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .max_queue_size::<1>()
    .build_callback(|_| Ok(()))?;
  let first_status = tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
  if first_status != Status::Ok {
    return Err(Error::new(
      Status::GenericFailure,
      format!("failed to fill the bounded TSFN queue: {first_status:?}"),
    ));
  }

  let (blocking_entered, blocking_started) = sync_channel(0);
  let (blocking_finished, blocking_result) = sync_channel(0);
  for _ in 0..2 {
    let blocking_tsfn = tsfn.clone();
    let blocking_entered = blocking_entered.clone();
    let blocking_finished = blocking_finished.clone();
    thread::spawn(move || {
      if blocking_entered.send(()).is_err() {
        return;
      }
      let _ = blocking_finished.send(blocking_tsfn.call((), ThreadsafeFunctionCallMode::Blocking));
    });
  }
  for _ in 0..2 {
    blocking_started.recv().map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("blocking TSFN caller exited before entering N-API: {error}"),
      )
    })?;
  }
  for _ in 0..16 {
    thread::yield_now();
  }
  thread::sleep(Duration::from_millis(50));

  let owner_blocking_status = tsfn.call((), ThreadsafeFunctionCallMode::Blocking);
  if owner_blocking_status != Status::WouldDeadlock {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "owner-thread Blocking TSFN call returned {owner_blocking_status:?} instead of WouldDeadlock"
      ),
    ));
  }

  let nonblocking_tsfn = tsfn.clone();
  let (nonblocking_finished, nonblocking_result) = sync_channel(0);
  thread::spawn(move || {
    let _ =
      nonblocking_finished.send(nonblocking_tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking));
  });

  let nonblocking_status = match nonblocking_result.recv_timeout(Duration::from_secs(2)) {
    Ok(status) => status,
    Err(RecvTimeoutError::Timeout) => {
      abort_tsfn_raw_with_caller_slot(tsfn.raw());
      return Err(Error::new(
        Status::WouldDeadlock,
        "NonBlocking TSFN call waited behind a blocked Blocking call",
      ));
    }
    Err(RecvTimeoutError::Disconnected) => {
      return Err(Error::new(
        Status::GenericFailure,
        "nonblocking TSFN caller exited without reporting a result",
      ));
    }
  };
  if nonblocking_status != Status::QueueFull {
    return Err(Error::new(
      Status::GenericFailure,
      format!("bounded NonBlocking TSFN call returned {nonblocking_status:?}"),
    ));
  }

  let aborting_tsfn = tsfn.clone();
  let (abort_finished, abort_result) = sync_channel(0);
  thread::spawn(move || {
    #[allow(deprecated)]
    let result = aborting_tsfn.abort();
    let _ = abort_finished.send(result);
  });
  match abort_result.recv_timeout(Duration::from_secs(2)) {
    Ok(result) => result?,
    Err(RecvTimeoutError::Timeout) => {
      abort_tsfn_raw_with_caller_slot(tsfn.raw());
      return Err(Error::new(
        Status::WouldDeadlock,
        "ThreadsafeFunction::abort could not wake a blocked caller",
      ));
    }
    Err(RecvTimeoutError::Disconnected) => {
      return Err(Error::new(
        Status::GenericFailure,
        "TSFN abort caller exited without reporting a result",
      ));
    }
  }

  for _ in 0..2 {
    let blocking_status = blocking_result
      .recv_timeout(Duration::from_secs(2))
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("blocked TSFN caller did not finish after abort: {error}"),
        )
      })?;
    if blocking_status != Status::Closing {
      return Err(Error::new(
        Status::GenericFailure,
        format!("blocked TSFN caller returned {blocking_status:?} after abort"),
      ));
    }
  }
  Ok(())
}

#[cfg(not(target_family = "wasm"))]
fn verify_tsfn_call_mode_concurrency(callback: &Function<(), ()>) -> Result<()> {
  for _ in 0..4 {
    verify_tsfn_call_mode_concurrency_once(callback)?;
  }
  Ok(())
}

#[cfg(not(target_family = "wasm"))]
fn record_tsfn_teardown_waiter_result(result: Result<()>) {
  // Hosts may either null-drain the queue or fail a dispatch already entering teardown.
  match result {
    Err(error)
      if error.status == Status::PendingException
        || (error.status == Status::GenericFailure
          && error.reason == "Receive value from threadsafe function sender failed") =>
    {
      TSFN_TEARDOWN_WAITER_ERROR_COUNT.fetch_add(1, Ordering::SeqCst);
    }
    _ => {
      TSFN_TEARDOWN_UNEXPECTED_WAITER_COUNT.fetch_add(1, Ordering::SeqCst);
    }
  }
}

#[cfg(not(target_family = "wasm"))]
fn drive_tsfn_teardown_waiter<F>(future: F, ready: SyncSender<std::result::Result<(), String>>)
where
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
      let _ = ready.send(Err(format!(
        "TSFN teardown waiter completed before environment teardown: {result:?}"
      )));
      return;
    }
  }

  record_tsfn_teardown_waiter_result(futures::executor::block_on(future));
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn prepare_tsfn_teardown_regression(
  unhandled_callback: Function<(), ()>,
  handled_callback: Function<(), ()>,
) -> Result<()> {
  verify_tsfn_closing_ownership(&unhandled_callback)?;
  verify_tsfn_call_mode_concurrency(&unhandled_callback)?;

  TSFN_TEARDOWN_PAYLOAD_DROP_COUNT.store(0, Ordering::SeqCst);
  TSFN_TEARDOWN_WAITER_ERROR_COUNT.store(0, Ordering::SeqCst);
  TSFN_TEARDOWN_QUEUE_FULL_ERROR_COUNT.store(0, Ordering::SeqCst);
  TSFN_TEARDOWN_UNEXPECTED_WAITER_COUNT.store(0, Ordering::SeqCst);
  TSFN_TEARDOWN_JS_CALLBACK_COUNT.store(0, Ordering::SeqCst);

  let unhandled_tsfn = unhandled_callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .build_callback(|_| Ok(()))?;
  let handled_tsfn = handled_callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .callee_handled::<true>()
    .build_callback(|_| Ok(()))?;
  let bounded_tsfn = unhandled_callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .max_queue_size::<1>()
    .build_callback(|_| Ok(()))?;
  let reentrant_tsfn: ReentrantTsfn = unhandled_callback
    .build_threadsafe_function::<TsfnReentrantPayload>()
    .build_callback(|_| Ok(()))?;
  let reentrant_status = reentrant_tsfn.call(
    TsfnReentrantPayload {
      tsfn: Some(reentrant_tsfn.clone()),
    },
    ThreadsafeFunctionCallMode::NonBlocking,
  );
  if reentrant_status != Status::Ok {
    return Err(Error::new(
      Status::GenericFailure,
      format!("failed to enqueue the reentrant TSFN payload: {reentrant_status:?}"),
    ));
  }
  drop(reentrant_tsfn);

  let (unhandled_ready, unhandled_polled) = sync_channel(0);
  thread::spawn(move || {
    drive_tsfn_teardown_waiter(
      unhandled_tsfn.call_async_catch(TsfnTeardownPayload::plain()),
      unhandled_ready,
    );
  });

  let (handled_ready, handled_polled) = sync_channel(0);
  thread::spawn(move || {
    drive_tsfn_teardown_waiter(
      handled_tsfn.call_async(Ok(TsfnTeardownPayload::plain())),
      handled_ready,
    );
  });

  let bounded_handle = Arc::clone(&bounded_tsfn.handle);
  let (bounded_ready, bounded_polled) = sync_channel(0);
  thread::spawn(move || {
    let first = bounded_tsfn.call_async_catch(TsfnTeardownPayload::plain());
    let mut first = pin!(first);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    if let Poll::Ready(result) = first.as_mut().poll(&mut context) {
      let _ = bounded_ready.send(Err(format!(
        "bounded TSFN first call completed before environment teardown: {result:?}"
      )));
      return;
    }

    let second = bounded_tsfn.call_async_catch(TsfnTeardownPayload {
      reentrant_handle: Some(bounded_handle),
    });
    let mut second = pin!(second);
    match second.as_mut().poll(&mut context) {
      Poll::Ready(Err(error)) if error.status == Status::QueueFull => {
        let immediate_drops = TSFN_TEARDOWN_PAYLOAD_DROP_COUNT.load(Ordering::SeqCst);
        if immediate_drops != 1 {
          let _ = bounded_ready.send(Err(format!(
            "QueueFull payload was not reclaimed immediately: expected 1 drop, observed {immediate_drops}"
          )));
          return;
        }
        TSFN_TEARDOWN_QUEUE_FULL_ERROR_COUNT.fetch_add(1, Ordering::SeqCst);
      }
      Poll::Ready(result) => {
        let _ = bounded_ready.send(Err(format!(
          "bounded TSFN second call did not fail with QueueFull: {result:?}"
        )));
        return;
      }
      Poll::Pending => {
        let _ = bounded_ready.send(Err(
          "bounded TSFN second call remained pending instead of failing with QueueFull".to_owned(),
        ));
        return;
      }
    }

    if bounded_ready.send(Ok(())).is_err() {
      return;
    }
    record_tsfn_teardown_waiter_result(futures::executor::block_on(first));
  });

  for polled in [unhandled_polled, handled_polled, bounded_polled] {
    polled
      .recv()
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("TSFN teardown polling thread exited early: {error}"),
        )
      })?
      .map_err(|reason| Error::new(Status::GenericFailure, reason))?;
  }

  Ok(())
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn record_tsfn_teardown_js_callback() {
  TSFN_TEARDOWN_JS_CALLBACK_COUNT.fetch_add(1, Ordering::SeqCst);
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn tsfn_teardown_payload_drop_count() -> u32 {
  TSFN_TEARDOWN_PAYLOAD_DROP_COUNT.load(Ordering::SeqCst)
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn tsfn_teardown_waiter_error_count() -> u32 {
  TSFN_TEARDOWN_WAITER_ERROR_COUNT.load(Ordering::SeqCst)
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn tsfn_teardown_queue_full_error_count() -> u32 {
  TSFN_TEARDOWN_QUEUE_FULL_ERROR_COUNT.load(Ordering::SeqCst)
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn tsfn_teardown_unexpected_waiter_count() -> u32 {
  TSFN_TEARDOWN_UNEXPECTED_WAITER_COUNT.load(Ordering::SeqCst)
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn tsfn_teardown_js_callback_count() -> u32 {
  TSFN_TEARDOWN_JS_CALLBACK_COUNT.load(Ordering::SeqCst)
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
pub fn threadsafe_function_build_throw_error_with_status(cb: Function<'static>) -> Result<()> {
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
fn threadsafe_function_closure_capture(
  env: Env,
  default_value: ClassInstance<Animal>,
  func: Function<Reference<Animal>, ()>,
) -> napi::Result<()> {
  let str = "test";
  let default_value_reference: Reference<Animal> =
    unsafe { Reference::from_napi_value(env.raw(), default_value.value)? };
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
