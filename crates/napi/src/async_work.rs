use std::mem;
use std::os::raw::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::{ffi::CString, rc::Rc};

use crate::{
  bindgen_runtime::ToNapiValue, check_status, js_values::NapiValue, sys, Env, JsError, JsObject,
  Result, Task,
};

struct AsyncWork<T: Task> {
  inner_task: T,
  deferred: sys::napi_deferred,
  value: Result<mem::MaybeUninit<T::Output>>,
  napi_async_work: sys::napi_async_work,
  abort: Rc<AtomicBool>,
}

pub struct AsyncWorkPromise {
  pub(crate) napi_async_work: sys::napi_async_work,
  raw_promise: sys::napi_value,
  pub(crate) deferred: sys::napi_deferred,
  env: sys::napi_env,
  // share with AsyncWork
  pub(crate) abort: Rc<AtomicBool>,
}

impl AsyncWorkPromise {
  pub fn promise_object(&self) -> JsObject {
    unsafe { JsObject::from_raw_unchecked(self.env, self.raw_promise) }
  }

  pub fn cancel(&self) -> Result<()> {
    // must be happened in the main thread, relaxed is enough
    self.abort.store(true, Ordering::Relaxed);
    check_status!(unsafe { sys::napi_cancel_async_work(self.env, self.napi_async_work) })
  }
}

pub fn run<T: Task>(
  env: sys::napi_env,
  task: T,
  abort_status: Option<Rc<AtomicBool>>,
) -> Result<AsyncWorkPromise> {
  let mut raw_resource = ptr::null_mut();
  check_status!(unsafe { sys::napi_create_object(env, &mut raw_resource) })?;
  let mut raw_promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();
  check_status!(unsafe { sys::napi_create_promise(env, &mut deferred, &mut raw_promise) })?;
  let task_abort = abort_status.unwrap_or_else(|| Rc::new(AtomicBool::new(false)));
  let result = Box::leak(Box::new(AsyncWork {
    inner_task: task,
    deferred,
    value: Ok(mem::MaybeUninit::zeroed()),
    napi_async_work: ptr::null_mut(),
    abort: task_abort.clone(),
  }));
  check_status!(unsafe {
    sys::napi_create_async_work(
      env,
      raw_resource,
      CString::new("napi_rs_async_work")?.as_ptr() as *mut _,
      Some(execute::<T> as unsafe extern "C" fn(env: sys::napi_env, data: *mut c_void)),
      Some(
        complete::<T>
          as unsafe extern "C" fn(env: sys::napi_env, status: sys::napi_status, data: *mut c_void),
      ),
      result as *mut _ as *mut c_void,
      &mut result.napi_async_work,
    )
  })?;
  check_status!(unsafe { sys::napi_queue_async_work(env, result.napi_async_work) })?;
  Ok(AsyncWorkPromise {
    napi_async_work: result.napi_async_work,
    raw_promise,
    deferred,
    env,
    abort: task_abort,
  })
}

unsafe impl<T: Task> Send for AsyncWork<T> {}

unsafe impl<T: Task> Sync for AsyncWork<T> {}

/// env here is the same with the one in `CallContext`.
/// So it actually could do nothing here, because `execute` function is called in the other thread mostly.
unsafe extern "C" fn execute<T: Task>(_env: sys::napi_env, data: *mut c_void) {
  let mut work = Box::from_raw(data as *mut AsyncWork<T>);
  if work.abort.load(Ordering::Relaxed) {
    return;
  }
  let _ = mem::replace(
    &mut work.value,
    work.inner_task.compute().map(mem::MaybeUninit::new),
  );
  if !work.abort.load(Ordering::Relaxed) {
    Box::leak(work);
  }
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
  match check_status!(status)
    .and_then(move |_| value)
    .and_then(|v| ToNapiValue::to_napi_value(env, v))
  {
    Ok(v) => {
      let status = sys::napi_resolve_deferred(env, deferred, v);
      debug_assert!(status == sys::Status::napi_ok, "Resolve promise failed");
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
