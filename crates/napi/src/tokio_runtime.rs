use std::{ffi::c_void, future::Future, ptr};

use crate::{check_status, promise, sys, Result};
use once_cell::sync::Lazy;
use tokio::{runtime::Handle, sync::mpsc};

static RT: Lazy<(Handle, mpsc::Sender<()>)> = Lazy::new(|| {
  let runtime = tokio::runtime::Runtime::new();
  let (sender, mut receiver) = mpsc::channel::<()>(1);
  runtime
    .map(|rt| {
      let h = rt.handle();
      let handle = h.clone();
      handle.spawn(async move {
        if receiver.recv().await.is_some() {
          rt.shutdown_background();
        }
      });

      (handle, sender)
    })
    .expect("Create tokio runtime failed")
});

#[doc(hidden)]
#[inline(never)]
pub extern "C" fn shutdown_tokio_rt(_arg: *mut c_void) {
  let sender = &RT.1;
  sender
    .clone()
    .try_send(())
    .expect("Shutdown tokio runtime failed");
}

pub fn spawn<F>(fut: F)
where
  F: 'static + Send + Future<Output = ()>,
{
  RT.0.spawn(fut);
}

pub fn execute_tokio_future<
  Data: 'static + Send,
  Fut: 'static + Send + Future<Output = Result<Data>>,
  Resolver: 'static + Send + Sync + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
>(
  env: sys::napi_env,
  fut: Fut,
  resolver: Resolver,
) -> Result<sys::napi_value> {
  let mut promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();

  check_status!(unsafe { sys::napi_create_promise(env, &mut deferred, &mut promise) })?;

  let future_promise = promise::FuturePromise::new(env, deferred, resolver)?;
  let future_to_resolve = promise::resolve_from_future(future_promise.start()?, fut);
  spawn(future_to_resolve);

  Ok(promise)
}
