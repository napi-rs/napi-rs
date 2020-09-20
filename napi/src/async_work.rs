use std::mem;
use std::os::raw::{c_char, c_void};
use std::ptr;

use crate::error::check_status;
use crate::js_values::NapiValue;
use crate::{sys, Env, JsObject, Result, Task};

struct AsyncWork<T: Task> {
  inner_task: T,
  deferred: sys::napi_deferred,
  value: Result<*mut T::Output>,
  napi_async_work: sys::napi_async_work,
}

#[derive(Debug)]
pub struct AsyncWorkPromise {
  napi_async_work: sys::napi_async_work,
  raw_promise: sys::napi_value,
  env: sys::napi_env,
}

impl AsyncWorkPromise {
  #[inline(always)]
  pub fn promise_object(&self) -> JsObject {
    JsObject::from_raw_unchecked(self.env, self.raw_promise)
  }

  pub fn cancel(self) -> Result<()> {
    check_status(unsafe { sys::napi_cancel_async_work(self.env, self.napi_async_work) })
  }
}

#[inline(always)]
pub fn run<T: Task>(env: sys::napi_env, task: T) -> Result<AsyncWorkPromise> {
  let mut raw_resource = ptr::null_mut();
  check_status(unsafe { sys::napi_create_object(env, &mut raw_resource) })?;
  let mut raw_promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();

  check_status(unsafe { sys::napi_create_promise(env, &mut deferred, &mut raw_promise) })?;
  let mut raw_name = ptr::null_mut();
  let s = "napi_rs_async";
  check_status(unsafe {
    sys::napi_create_string_utf8(
      env,
      s.as_ptr() as *const c_char,
      s.len() as u64,
      &mut raw_name,
    )
  })?;
  let result = Box::leak(Box::new(AsyncWork {
    inner_task: task,
    deferred,
    value: Ok(ptr::null_mut()),
    napi_async_work: ptr::null_mut(),
  }));
  check_status(unsafe {
    sys::napi_create_async_work(
      env,
      raw_resource,
      raw_name,
      Some(execute::<T> as unsafe extern "C" fn(env: sys::napi_env, data: *mut c_void)),
      Some(
        complete::<T>
          as unsafe extern "C" fn(env: sys::napi_env, status: sys::napi_status, data: *mut c_void),
      ),
      result as *mut _ as *mut c_void,
      &mut result.napi_async_work,
    )
  })?;
  check_status(unsafe { sys::napi_queue_async_work(env, result.napi_async_work) })?;
  Ok(AsyncWorkPromise {
    napi_async_work: result.napi_async_work,
    raw_promise,
    env,
  })
}

unsafe impl<T: Task> Send for AsyncWork<T> {}

unsafe impl<T: Task> Sync for AsyncWork<T> {}

unsafe extern "C" fn execute<T: Task>(_env: sys::napi_env, data: *mut c_void) {
  let mut work = Box::from_raw(data as *mut AsyncWork<T>);
  work.value = work
    .inner_task
    .compute()
    .map(|v| Box::into_raw(Box::from(v)));
  Box::leak(work);
}

unsafe extern "C" fn complete<T: Task>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) {
  let mut work = Box::from_raw(data as *mut AsyncWork<T>);
  let value_ptr = mem::replace(&mut work.value, Ok(ptr::null_mut()));
  let deferred = mem::replace(&mut work.deferred, ptr::null_mut());
  let napi_async_work = mem::replace(&mut work.napi_async_work, ptr::null_mut());
  let value = value_ptr.and_then(move |v| {
    let mut env = Env::from_raw(env);
    let output = ptr::read(v as *const _);
    work.inner_task.resolve(&mut env, output)
  });
  match check_status(status).and_then(move |_| value) {
    Ok(v) => {
      let status = sys::napi_resolve_deferred(env, deferred, v.raw_value());
      debug_assert!(
        status == sys::napi_status::napi_ok,
        "Resolve promise failed"
      );
    }
    Err(e) => {
      let status = sys::napi_reject_deferred(env, deferred, e.into_raw(env));
      debug_assert!(status == sys::napi_status::napi_ok, "Reject promise failed");
    }
  };
  let delete_status = sys::napi_delete_async_work(env, napi_async_work);
  debug_assert!(
    delete_status == sys::napi_status::napi_ok,
    "Delete async work failed"
  );
}
