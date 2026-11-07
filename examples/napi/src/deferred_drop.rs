//! `JsDeferred` values dropped without being settled. Each one must free its threadsafe function,
//! so the thread that made it can still exit by itself.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use napi::bindgen_prelude::*;

static OFF_THREAD_DROPPED: AtomicU32 = AtomicU32::new(0);
static PENDING_FUTURES_STARTED: AtomicU32 = AtomicU32::new(0);
static PENDING_FUTURES_DROPPED: AtomicU32 = AtomicU32::new(0);
static CALLBACK_CAPTURES_DROPPED: AtomicU32 = AtomicU32::new(0);
static CALLBACKS_INVOKED: AtomicU32 = AtomicU32::new(0);

/// Makes `n` deferreds and drops each one at once, unsettled. Returns their promises.
#[napi(ts_return_type = "Promise<number>[]")]
pub fn drop_deferred_unsettled(env: &Env, n: u32) -> Result<Vec<Object<'_>>> {
  let mut promises = Vec::with_capacity(n as usize);
  for _ in 0..n {
    let (deferred, promise) = env.create_deferred::<u32, fn(Env) -> Result<u32>>()?;
    drop(deferred);
    promises.push(promise);
  }
  Ok(promises)
}

/// Makes `n` deferreds and moves them to a new thread, which drops them unsettled after
/// `delay_ms`. Returns their promises.
#[napi(ts_return_type = "Promise<number>[]")]
pub fn drop_deferred_off_thread(env: &Env, n: u32, delay_ms: u32) -> Result<Vec<Object<'_>>> {
  let mut promises = Vec::with_capacity(n as usize);
  let mut deferreds = Vec::with_capacity(n as usize);
  for _ in 0..n {
    let (deferred, promise) = env.create_deferred::<u32, fn(Env) -> Result<u32>>()?;
    deferreds.push(deferred);
    promises.push(promise);
  }
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_millis(delay_ms as u64));
    let count = deferreds.len() as u32;
    drop(deferreds);
    OFF_THREAD_DROPPED.fetch_add(count, Ordering::SeqCst);
  });
  Ok(promises)
}

/// What a settle-time callback captures. Counts its drop.
struct CallbackCapture;

impl Drop for CallbackCapture {
  fn drop(&mut self) {
    CALLBACK_CAPTURES_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

/// Like [`drop_deferred_off_thread`], but each deferred has a settle-time callback that captures a
/// [`CallbackCapture`]. A dropped deferred must drop its callback (and so the capture) without
/// running it, even when its env can no longer run anything (a busy worker that was terminated).
#[napi(ts_return_type = "Promise<number>[]")]
pub fn drop_deferred_off_thread_with_callback(
  env: &Env,
  n: u32,
  delay_ms: u32,
) -> Result<Vec<Object<'_>>> {
  let mut promises = Vec::with_capacity(n as usize);
  let mut deferreds = Vec::with_capacity(n as usize);
  for _ in 0..n {
    let (mut deferred, promise) = env.create_deferred::<u32, fn(Env) -> Result<u32>>()?;
    let capture = CallbackCapture;
    deferred.set_finalize_callback(Some(Box::new(move |_| {
      let _capture = capture;
      CALLBACKS_INVOKED.fetch_add(1, Ordering::SeqCst);
    })));
    deferreds.push(deferred);
    promises.push(promise);
  }
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_millis(delay_ms as u64));
    let count = deferreds.len() as u32;
    drop(deferreds);
    OFF_THREAD_DROPPED.fetch_add(count, Ordering::SeqCst);
  });
  Ok(promises)
}

/// Makes a deferred, then fails before the promise is handed out: the early `?` drops the
/// deferred unsettled. Throws, and must not leave a rejection behind.
#[napi]
pub fn create_deferred_then_fail(env: &Env) -> Result<()> {
  let (_deferred, _promise) = env.create_deferred::<u32, fn(Env) -> Result<u32>>()?;
  step_that_fails()?;
  Ok(())
}

fn step_that_fails() -> Result<()> {
  Err(Error::from_reason("failed after create_deferred"))
}

/// Makes `n` deferreds and keeps them in an env cleanup hook, which drops them unsettled when the
/// env is torn down. The hook is newer than the deferreds' own teardown hooks, so it runs first.
#[napi(ts_return_type = "Promise<number>[]")]
pub fn drop_deferred_at_env_teardown(env: &Env, n: u32) -> Result<Vec<Object<'_>>> {
  let mut promises = Vec::with_capacity(n as usize);
  let mut deferreds = Vec::with_capacity(n as usize);
  for _ in 0..n {
    let (deferred, promise) = env.create_deferred::<u32, fn(Env) -> Result<u32>>()?;
    deferreds.push(deferred);
    promises.push(promise);
  }
  env.add_env_cleanup_hook(deferreds, drop)?;
  Ok(promises)
}

/// Makes `n` deferreds and resolves each one at once with 7.
#[napi(ts_return_type = "Promise<number>[]")]
pub fn settled_deferreds(env: &Env, n: u32) -> Result<Vec<Object<'_>>> {
  let mut promises = Vec::with_capacity(n as usize);
  for _ in 0..n {
    let (deferred, promise) = env.create_deferred::<u32, fn(Env) -> Result<u32>>()?;
    deferred.resolve(|_| Ok(7));
    promises.push(promise);
  }
  Ok(promises)
}

/// An `async fn` that resolves at once.
#[napi]
pub async fn async_fn_resolve_now() -> u32 {
  0
}

struct CountDrop;

impl Drop for CountDrop {
  fn drop(&mut self) {
    PENDING_FUTURES_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

/// An `async fn` that never completes. Its future and its deferred are dropped unsettled only
/// when the async runtime drops the task ([`shutdown_async_runtime_now`]).
#[napi]
pub async fn async_fn_pending_forever() -> u32 {
  PENDING_FUTURES_STARTED.fetch_add(1, Ordering::SeqCst);
  let _guard = CountDrop;
  std::future::pending::<()>().await;
  0
}

/// Shuts the async runtime down now, dropping every pending task. Only for a process or worker
/// that runs no other `async fn` afterwards.
#[napi]
pub fn shutdown_async_runtime_now() {
  #[cfg(not(feature = "noop"))]
  napi::bindgen_prelude::shutdown_async_runtime();
}

#[napi(object)]
pub struct DeferredDropCounters {
  pub off_thread_dropped: u32,
  pub pending_futures_started: u32,
  pub pending_futures_dropped: u32,
  pub callback_captures_dropped: u32,
  pub callbacks_invoked: u32,
}

#[napi]
pub fn deferred_drop_counters() -> DeferredDropCounters {
  DeferredDropCounters {
    off_thread_dropped: OFF_THREAD_DROPPED.load(Ordering::SeqCst),
    pending_futures_started: PENDING_FUTURES_STARTED.load(Ordering::SeqCst),
    pending_futures_dropped: PENDING_FUTURES_DROPPED.load(Ordering::SeqCst),
    callback_captures_dropped: CALLBACK_CAPTURES_DROPPED.load(Ordering::SeqCst),
    callbacks_invoked: CALLBACKS_INVOKED.load(Ordering::SeqCst),
  }
}
