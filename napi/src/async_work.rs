use std::mem;
use std::os::raw::{c_char, c_void};
use std::ptr;

use crate::{
  check_status,
  js_values::{IntoNapiValue, NapiValue},
  sys, Env, JsError, JsObject, Result, Task,
};

struct AsyncWork<T: Task> {
  inner_task: T,
  deferred: sys::napi_deferred,
  value: Result<mem::MaybeUninit<T::Output>>,
  napi_async_work: sys::napi_async_work,
}

pub struct AsyncWorkPromise<'env> {
  napi_async_work: sys::napi_async_work,
  raw_promise: sys::napi_value,
  env: &'env Env,
}

impl<'env> AsyncWorkPromise<'env> {
  #[inline]
  pub fn promise_object(&self) -> JsObject {
    unsafe { JsObject::from_raw_unchecked(self.env.0, self.raw_promise) }
  }

  #[inline]
  pub fn cancel(self) -> Result<()> {
    check_status!(unsafe { sys::napi_cancel_async_work(self.env.0, self.napi_async_work) })
  }
}

#[inline]
pub fn run<T: Task>(env: &Env, task: T) -> Result<AsyncWorkPromise<'_>> {
  let mut raw_resource = ptr::null_mut();
  check_status!(unsafe { sys::napi_create_object(env.0, &mut raw_resource) })?;
  let mut raw_promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();
  check_status!(unsafe { sys::napi_create_promise(env.0, &mut deferred, &mut raw_promise) })?;
  let mut raw_name = ptr::null_mut();
  let s = "napi_rs_async_work";
  check_status!(unsafe {
    sys::napi_create_string_utf8(env.0, s.as_ptr() as *const c_char, s.len(), &mut raw_name)
  })?;
  let result = Box::leak(Box::new(AsyncWork {
    inner_task: task,
    deferred,
    value: Ok(mem::MaybeUninit::zeroed()),
    napi_async_work: ptr::null_mut(),
  }));
  check_status!(unsafe {
    sys::napi_create_async_work(
      env.0,
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
  check_status!(unsafe { sys::napi_queue_async_work(env.0, result.napi_async_work) })?;
  Ok(AsyncWorkPromise {
    napi_async_work: result.napi_async_work,
    raw_promise,
    env,
  })
}

unsafe impl<T: Task> Send for AsyncWork<T> {}

unsafe impl<T: Task> Sync for AsyncWork<T> {}

/// env here is the same with the one in `CallContext`.
/// So it actually could do nothing here, because `execute` function is called in the other thread mostly.
unsafe extern "C" fn execute<T: Task>(_env: sys::napi_env, data: *mut c_void) {
  let mut work = Box::from_raw(data as *mut AsyncWork<T>);
  let _ = mem::replace(
    &mut work.value,
    work.inner_task.compute().map(mem::MaybeUninit::new),
  );
  Box::leak(work);
}

unsafe extern "C" fn complete<T: Task>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) {
  let mut work = Box::from_raw(data as *mut AsyncWork<T>);
  let value_ptr = mem::replace(&mut work.value, Ok(mem::MaybeUninit::zeroed()));
  let deferred = mem::replace(&mut work.deferred, ptr::null_mut());
  let napi_async_work = mem::replace(&mut work.napi_async_work, ptr::null_mut());
  let value = match value_ptr {
    Ok(v) => {
      let output = v.assume_init();
      work.inner_task.resolve(Env::from_raw(env), output)
    }
    Err(e) => work.inner_task.reject(Env::from_raw(env), e),
  };
  match check_status!(status).and_then(move |_| value) {
    Ok(v) => {
      let status = sys::napi_resolve_deferred(env, deferred, v.raw());
      debug_assert!(status == sys::Status::napi_ok, "Reject promise failed");
    }
    Err(e) => {
      let status = sys::napi_reject_deferred(env, deferred, JsError::from(e).into_value(env));
      debug_assert!(status == sys::Status::napi_ok, "Reject promise failed");
    }
  };
  let delete_status = sys::napi_delete_async_work(env, napi_async_work);
  debug_assert!(
    delete_status == sys::Status::napi_ok,
    "Delete async work failed"
  );
}
