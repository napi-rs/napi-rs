use std::future::Future;

use once_cell::sync::Lazy;
use tokio::runtime::Runtime;

use crate::{sys, JsDeferred, JsUnknown, NapiValue, Result};

pub(crate) static mut RT: Lazy<Option<Runtime>> = Lazy::new(|| {
  let runtime = tokio::runtime::Runtime::new().expect("Create tokio runtime failed");
  Some(runtime)
});

#[cfg(windows)]
pub(crate) static RT_REFERENCE_COUNT: std::sync::atomic::AtomicUsize =
  std::sync::atomic::AtomicUsize::new(0);

#[cfg(windows)]
pub(crate) unsafe extern "C" fn drop_runtime(arg: *mut std::ffi::c_void) {
  use std::sync::atomic::Ordering;

  if RT_REFERENCE_COUNT.fetch_sub(1, Ordering::SeqCst) == 1 {
    if let Some(rt) = Lazy::get_mut(unsafe { &mut RT }) {
      rt.take();
    }
  }

  unsafe {
    let env: sys::napi_env = arg as *mut sys::napi_env__;
    sys::napi_remove_env_cleanup_hook(env, Some(drop_runtime), arg);
  }
}

/// Spawns a future onto the Tokio runtime.
///
/// Depending on where you use it, you should await or abort the future in your drop function.
/// To avoid undefined behavior and memory corruptions.
pub fn spawn<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
  F: 'static + Send + Future<Output = ()>,
{
  unsafe { RT.as_ref() }.unwrap().spawn(fut)
}

/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
pub fn block_on<F>(fut: F) -> F::Output
where
  F: 'static + Send + Future<Output = ()>,
{
  unsafe { RT.as_ref() }.unwrap().block_on(fut)
}

// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `tokio_rt` feature.

/// If the feature `tokio_rt` has been enabled this will enter the runtime context and
/// then call the provided closure. Otherwise it will just call the provided closure.
#[inline]
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  let _rt_guard = unsafe { RT.as_ref() }.unwrap().enter();
  f()
}

#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn execute_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = Result<Data>>,
  Resolver: 'static + Send + Sync + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  let (deferred, promise) = JsDeferred::new(env)?;

  spawn(async move {
    match fut.await {
      Ok(v) => deferred.resolve(|env| {
        resolver(env.raw(), v).map(|v| unsafe { JsUnknown::from_raw_unchecked(env.raw(), v) })
      }),
      Err(e) => deferred.reject(e),
    }
  });

  Ok(promise.0.value)
}
