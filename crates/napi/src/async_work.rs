use std::cell::Cell;
use std::marker::PhantomData;
use std::mem;
use std::os::raw::c_void;
use std::panic::UnwindSafe;
use std::ptr;
use std::rc::Rc;

use crate::bindgen_runtime::JsObjectValue;
use crate::{
  bindgen_runtime::{PromiseRaw, ToNapiValue},
  check_status, sys, Env, Error, JsError, Result, ScopedTask, Status,
};

struct AsyncWork<'task, T: ScopedTask<'task>> {
  inner_task: T,
  deferred: sys::napi_deferred,
  value: mem::MaybeUninit<Result<T::Output>>,
  napi_async_work: sys::napi_async_work,
  status: Rc<Cell<u8>>,
}

pub struct AsyncWorkPromise<T> {
  pub(crate) napi_async_work: sys::napi_async_work,
  raw_promise: sys::napi_value,
  env: sys::napi_env,
  /// share with AsyncWork
  /// 0: not started
  /// 1: completed
  /// 2: canceled
  pub(crate) status: Rc<Cell<u8>>,
  _phantom: PhantomData<T>,
}

impl<T> UnwindSafe for AsyncWorkPromise<T> {}
impl<T> std::panic::RefUnwindSafe for AsyncWorkPromise<T> {}

impl<T> AsyncWorkPromise<T> {
  pub fn promise_object<'env>(&self) -> PromiseRaw<'env, T> {
    PromiseRaw::new(self.env, self.raw_promise)
  }

  pub fn cancel(&mut self) -> Result<()> {
    // must be happened in the main thread, relaxed is enough
    self.status.set(2);
    check_status!(
      unsafe { sys::napi_cancel_async_work(self.env, self.napi_async_work) },
      "Cancel async work failed"
    )
  }
}

pub fn run<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  task: T,
  abort_status: Option<Rc<Cell<u8>>>,
) -> Result<AsyncWorkPromise<T::JsValue>> {
  let mut undefined = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_undefined(env, &mut undefined) },
    "Get undefined failed in async_work::run"
  )?;
  let mut raw_promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_promise(env, &mut deferred, &mut raw_promise) },
    "Create promise failed in async_work::run"
  )?;
  let task_status = abort_status.unwrap_or_else(|| Rc::new(Cell::new(0)));
  let result = Box::leak(Box::new(AsyncWork {
    inner_task: task,
    deferred,
    value: mem::MaybeUninit::uninit(),
    napi_async_work: ptr::null_mut(),
    status: task_status.clone(),
  }));
  check_status!(
    unsafe {
      sys::napi_create_async_work(
        env,
        raw_promise,
        undefined,
        Some(execute::<T>),
        Some(complete::<T>),
        (result as *mut AsyncWork<T>).cast(),
        &mut result.napi_async_work,
      )
    },
    "Create async work failed in async_work::run"
  )?;
  check_status!(
    unsafe { sys::napi_queue_async_work(env, result.napi_async_work) },
    "Queue async work failed in async_work::run"
  )?;
  Ok(AsyncWorkPromise {
    napi_async_work: result.napi_async_work,
    raw_promise,
    env,
    status: task_status,
    _phantom: PhantomData,
  })
}

unsafe impl<'task, T: ScopedTask<'task> + Send> Send for AsyncWork<'task, T> {}
unsafe impl<'task, T: ScopedTask<'task> + Sync> Sync for AsyncWork<'task, T> {}

/// env here is the same with the one in `CallContext`.
/// So it actually could do nothing here, because `execute` function is called in the other thread mostly.
unsafe extern "C" fn execute<'task, T: ScopedTask<'task>>(_env: sys::napi_env, data: *mut c_void) {
  let work = Box::leak(unsafe { Box::from_raw(data as *mut AsyncWork<T>) });
  let value = work.inner_task.compute();
  work.value.write(value);
}

unsafe extern "C" fn complete<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) {
  if let Err(e) = complete_impl::<T>(env, status, data) {
    let js_err = JsError::from(e);
    unsafe { js_err.throw_into(env) };
  }
}

fn complete_impl<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) -> Result<()> {
  let mut work = unsafe { Box::from_raw(data as *mut AsyncWork<T>) };
  let napi_async_work = mem::replace(&mut work.napi_async_work, ptr::null_mut());
  let deferred = mem::replace(&mut work.deferred, ptr::null_mut());
  if status == sys::Status::napi_cancelled {
    const ABORT_ERROR_NAME: &str = "AbortError";
    let wrapped_env = Env::from_raw(env);
    let mut error =
      wrapped_env.create_error(Error::new(Status::Cancelled, ABORT_ERROR_NAME.to_owned()))?;
    error.set_named_property("name", ABORT_ERROR_NAME)?;
    check_status!(
      unsafe { sys::napi_reject_deferred(env, deferred, error.0.value) },
      "Reject AbortError failed"
    )?;
  } else {
    let value_ptr = unsafe { work.value.assume_init() };
    let value = match value_ptr {
      Ok(output) => work.inner_task.resolve(
        // SAFETY: `Env` is long lived
        unsafe { std::mem::transmute::<&Env, &'task Env>(&Env::from_raw(env)) },
        output,
      ),
      Err(e) => work.inner_task.reject(
        // SAFETY: `Env` is long lived
        unsafe { std::mem::transmute::<&Env, &'task Env>(&Env::from_raw(env)) },
        e,
      ),
    };
    if work.status.get() != 2 {
      match check_status!(status)
        .and_then(move |_| value)
        .and_then(|v| unsafe { ToNapiValue::to_napi_value(env, v) })
      {
        Ok(v) => {
          check_status!(
            unsafe { sys::napi_resolve_deferred(env, deferred, v) },
            "Resolve promise failed"
          )?;
        }
        Err(e) => {
          check_status!(
            unsafe { sys::napi_reject_deferred(env, deferred, JsError::from(e).into_value(env)) },
            "Reject promise failed"
          )?;
        }
      };
    }
    work.status.set(1);
  }
  work.inner_task.finally(Env::from_raw(env))?;
  check_status!(
    unsafe { sys::napi_delete_async_work(env, napi_async_work) },
    "Delete async work failed"
  )?;
  Ok(())
}
