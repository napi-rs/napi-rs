use std::{future::Future, sync::RwLock};

use once_cell::sync::Lazy;
use tokio::runtime::Runtime;

use crate::{sys, JsDeferred, JsUnknown, NapiValue, Result};

fn create_runtime() -> Option<Runtime> {
  #[cfg(not(target_arch = "wasm32"))]
  {
    let runtime = tokio::runtime::Runtime::new().expect("Create tokio runtime failed");
    Some(runtime)
  }

  #[cfg(target_arch = "wasm32")]
  {
    tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .ok()
  }
}

pub(crate) static RT: Lazy<RwLock<Option<Runtime>>> = Lazy::new(|| RwLock::new(create_runtime()));

#[cfg(windows)]
static RT_REFERENCE_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Ensure that the Tokio runtime is initialized.
/// In windows the Tokio runtime will be dropped when Node env exits.
/// But in Electron renderer process, the Node env will exits and recreate when the window reloads.
/// So we need to ensure that the Tokio runtime is initialized when the Node env is created.
#[cfg(windows)]
pub(crate) fn ensure_runtime() {
  use std::sync::atomic::Ordering;

  let mut rt = RT.write().unwrap();
  if rt.is_none() {
    *rt = create_runtime();
  }

  RT_REFERENCE_COUNT.fetch_add(1, Ordering::Relaxed);
}

#[cfg(windows)]
pub(crate) unsafe extern "C" fn drop_runtime(_arg: *mut std::ffi::c_void) {
  use std::sync::atomic::Ordering;

  if RT_REFERENCE_COUNT.fetch_sub(1, Ordering::AcqRel) == 1 {
    RT.write().unwrap().take();
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
  RT.read().unwrap().as_ref().unwrap().spawn(fut)
}

/// Runs a future to completion
/// This is blocking, meaning that it pauses other execution until the future is complete,
/// only use it when it is absolutely necessary, in other places use async functions instead.
pub fn block_on<F>(fut: F) -> F::Output
where
  F: 'static + Send + Future<Output = ()>,
{
  RT.read().unwrap().as_ref().unwrap().block_on(fut)
}

// This function's signature must be kept in sync with the one in lib.rs, otherwise napi
// will fail to compile with the `tokio_rt` feature.

/// If the feature `tokio_rt` has been enabled this will enter the runtime context and
/// then call the provided closure. Otherwise it will just call the provided closure.
#[inline]
pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
  let _rt_guard = RT.read().unwrap().as_ref().unwrap().enter();
  f()
}

#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn execute_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = std::result::Result<Data, impl Into<crate::error::Error>>>,
  Resolver: 'static + Send + Sync + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  let (deferred, promise) = JsDeferred::new(env)?;

  let inner = async move {
    match fut.await {
      Ok(v) => deferred.resolve(|env| {
        resolver(env.raw(), v).map(|v| unsafe { JsUnknown::from_raw_unchecked(env.raw(), v) })
      }),
      Err(e) => deferred.reject(e.into()),
    }
  };

  #[cfg(not(target_arch = "wasm32"))]
  spawn(inner);

  #[cfg(target_arch = "wasm32")]
  block_on(inner);

  Ok(promise.0.value)
}
