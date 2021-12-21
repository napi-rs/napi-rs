use std::ffi::c_void;
use std::future::Future;
use std::ptr;
use std::sync::atomic::{AtomicUsize, Ordering};

use lazy_static::lazy_static;
use tokio::{
  runtime::Handle,
  sync::mpsc::{self, error::TrySendError},
};

use crate::{check_status, promise, sys, Result};

lazy_static! {
  pub(crate) static ref RT: (Handle, mpsc::Sender<()>) = {
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
  };
}

pub(crate) static TOKIO_RT_REF_COUNT: AtomicUsize = AtomicUsize::new(0);

#[doc(hidden)]
#[inline(never)]
pub extern "C" fn shutdown_tokio_rt(_arg: *mut c_void) {
  if TOKIO_RT_REF_COUNT.fetch_sub(1, Ordering::Relaxed) == 0 {
    let sender = &RT.1;
    if let Err(e) = sender.clone().try_send(()) {
      match e {
        TrySendError::Closed(_) => {}
        TrySendError::Full(_) => {
          panic!("Send shutdown signal to tokio runtime failed, queue is full");
        }
      }
    }
  }
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
