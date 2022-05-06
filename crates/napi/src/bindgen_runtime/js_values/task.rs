use std::ffi::c_void;
use std::ptr;
use std::rc::Rc;
use std::sync::atomic::{AtomicPtr, AtomicU8, Ordering};

use super::{FromNapiValue, ToNapiValue, TypeName};
use crate::{
  async_work, check_status, sys, Env, Error, JsError, JsObject, NapiValue, Status, Task,
};

pub struct AsyncTask<T: Task> {
  inner: T,
  abort_signal: Option<AbortSignal>,
}

impl<T: Task> TypeName for T {
  fn type_name() -> &'static str {
    "AsyncTask"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Object
  }
}

impl<T: Task> AsyncTask<T> {
  pub fn new(task: T) -> Self {
    Self {
      inner: task,
      abort_signal: None,
    }
  }

  pub fn with_signal(task: T, signal: AbortSignal) -> Self {
    Self {
      inner: task,
      abort_signal: Some(signal),
    }
  }

  pub fn with_optional_signal(task: T, signal: Option<AbortSignal>) -> Self {
    Self {
      inner: task,
      abort_signal: signal,
    }
  }
}

/// <https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController>
pub struct AbortSignal {
  raw_work: Rc<AtomicPtr<sys::napi_async_work__>>,
  raw_deferred: Rc<AtomicPtr<sys::napi_deferred__>>,
  status: Rc<AtomicU8>,
}

impl FromNapiValue for AbortSignal {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut signal = unsafe { JsObject::from_raw_unchecked(env, napi_val) };
    let async_work_inner: Rc<AtomicPtr<sys::napi_async_work__>> =
      Rc::new(AtomicPtr::new(ptr::null_mut()));
    let raw_promise: Rc<AtomicPtr<sys::napi_deferred__>> = Rc::new(AtomicPtr::new(ptr::null_mut()));
    let task_status = Rc::new(AtomicU8::new(0));
    let abort_controller = AbortSignal {
      raw_work: async_work_inner.clone(),
      raw_deferred: raw_promise.clone(),
      status: task_status.clone(),
    };
    let js_env = unsafe { Env::from_raw(env) };
    check_status!(unsafe {
      sys::napi_wrap(
        env,
        signal.0.value,
        Box::into_raw(Box::new(abort_controller)) as *mut _,
        Some(async_task_abort_controller_finalize),
        ptr::null_mut(),
        ptr::null_mut(),
      )
    })?;
    signal.set_named_property("onabort", js_env.create_function("onabort", on_abort)?)?;
    Ok(AbortSignal {
      raw_work: async_work_inner,
      raw_deferred: raw_promise,
      status: task_status,
    })
  }
}

extern "C" fn on_abort(
  env: sys::napi_env,
  callback_info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut this = ptr::null_mut();
  unsafe {
    let get_cb_info_status = sys::napi_get_cb_info(
      env,
      callback_info,
      &mut 0,
      ptr::null_mut(),
      &mut this,
      ptr::null_mut(),
    );
    debug_assert_eq!(
      get_cb_info_status,
      sys::Status::napi_ok,
      "{}",
      "Get callback info in AbortController abort callback failed"
    );
    let mut async_task = ptr::null_mut();
    let status = sys::napi_unwrap(env, this, &mut async_task);
    debug_assert_eq!(
      status,
      sys::Status::napi_ok,
      "{}",
      "Unwrap async_task from AbortSignal failed"
    );
    let abort_controller = Box::leak(Box::from_raw(async_task as *mut AbortSignal));
    // Task Completed, return now
    if abort_controller.status.load(Ordering::Relaxed) == 1 {
      return ptr::null_mut();
    }
    let raw_async_work = abort_controller.raw_work.load(Ordering::Relaxed);
    let deferred = abort_controller.raw_deferred.load(Ordering::Relaxed);
    sys::napi_cancel_async_work(env, raw_async_work);
    // abort function must be called from JavaScript main thread, so Relaxed Ordering is ok.
    abort_controller.status.store(2, Ordering::Relaxed);
    let abort_error = Error::new(Status::Cancelled, "AbortError".to_owned());
    let reject_status =
      sys::napi_reject_deferred(env, deferred, JsError::from(abort_error).into_value(env));
    debug_assert_eq!(
      reject_status,
      sys::Status::napi_ok,
      "{}",
      "Reject AbortError failed"
    );
  }
  ptr::null_mut()
}

impl<T: Task> ToNapiValue for AsyncTask<T> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    if let Some(abort_controller) = val.abort_signal {
      let async_promise = async_work::run(env, val.inner, Some(abort_controller.status.clone()))?;
      abort_controller
        .raw_work
        .store(async_promise.napi_async_work, Ordering::Relaxed);
      abort_controller
        .raw_deferred
        .store(async_promise.deferred, Ordering::Relaxed);
      Ok(async_promise.promise_object().0.value)
    } else {
      let async_promise = async_work::run(env, val.inner, None)?;
      Ok(async_promise.promise_object().0.value)
    }
  }
}

unsafe extern "C" fn async_task_abort_controller_finalize(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  unsafe { Box::from_raw(finalize_data as *mut AbortSignal) };
}
