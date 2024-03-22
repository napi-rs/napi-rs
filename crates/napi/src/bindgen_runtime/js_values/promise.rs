use std::ffi::CStr;
use std::future;
use std::pin::Pin;
use std::ptr;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};
use std::task::{Context, Poll};

use tokio::sync::oneshot::{channel, Receiver, Sender};

use crate::{check_status, sys, Error, JsUnknown, NapiValue, Result, Status};

use super::{FromNapiValue, TypeName, ValidateNapiValue};

pub struct Promise<T: FromNapiValue> {
  value: Pin<Box<Receiver<*mut Result<T>>>>,
  aborted: Arc<AtomicBool>,
}

impl<T: FromNapiValue> Drop for Promise<T> {
  fn drop(&mut self) {
    self.aborted.store(true, Ordering::SeqCst);
  }
}

impl<T: FromNapiValue> TypeName for Promise<T> {
  fn type_name() -> &'static str {
    "Promise"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Object
  }
}

impl<T: FromNapiValue> ValidateNapiValue for Promise<T> {
  unsafe fn validate(
    env: crate::sys::napi_env,
    napi_val: crate::sys::napi_value,
  ) -> Result<sys::napi_value> {
    let mut is_promise = false;
    check_status!(
      unsafe { crate::sys::napi_is_promise(env, napi_val, &mut is_promise) },
      "Failed to check if value is promise"
    )?;
    if !is_promise {
      let mut deferred = ptr::null_mut();
      let mut promise = ptr::null_mut();
      check_status!(
        unsafe { crate::sys::napi_create_promise(env, &mut deferred, &mut promise) },
        "Failed to create promise"
      )?;
      let mut err = ptr::null_mut();
      let mut code = ptr::null_mut();
      let mut message = ptr::null_mut();
      check_status!(
        unsafe {
          crate::sys::napi_create_string_utf8(
            env,
            CStr::from_bytes_with_nul_unchecked(b"InvalidArg\0").as_ptr(),
            10,
            &mut code,
          )
        },
        "Failed to create error message"
      )?;
      check_status!(
        unsafe {
          crate::sys::napi_create_string_utf8(
            env,
            CStr::from_bytes_with_nul_unchecked(b"Expected Promise object\0").as_ptr(),
            23,
            &mut message,
          )
        },
        "Failed to create error message"
      )?;
      check_status!(
        unsafe { crate::sys::napi_create_error(env, code, message, &mut err) },
        "Failed to create rejected error"
      )?;
      check_status!(
        unsafe { crate::sys::napi_reject_deferred(env, deferred, err) },
        "Failed to reject promise in validate"
      )?;
      return Ok(promise);
    }
    Ok(ptr::null_mut())
  }
}

unsafe impl<T: FromNapiValue + Send> Send for Promise<T> {}

impl<T: FromNapiValue> FromNapiValue for Promise<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut then = ptr::null_mut();
    let then_c_string = unsafe { CStr::from_bytes_with_nul_unchecked(b"then\0") };
    check_status!(
      unsafe { sys::napi_get_named_property(env, napi_val, then_c_string.as_ptr(), &mut then) },
      "Failed to get then function"
    )?;
    let mut promise_after_then = ptr::null_mut();
    let mut then_js_cb = ptr::null_mut();
    let (tx, rx) = channel();
    let aborted = Arc::new(AtomicBool::new(false));
    let tx_ptr = Box::into_raw(Box::new((tx, aborted.clone())));
    check_status!(
      unsafe {
        sys::napi_create_function(
          env,
          then_c_string.as_ptr(),
          4,
          Some(then_callback::<T>),
          tx_ptr.cast(),
          &mut then_js_cb,
        )
      },
      "Failed to create then callback"
    )?;
    check_status!(
      unsafe {
        sys::napi_call_function(
          env,
          napi_val,
          then,
          1,
          [then_js_cb].as_ptr(),
          &mut promise_after_then,
        )
      },
      "Failed to call then method"
    )?;
    let mut catch = ptr::null_mut();
    let catch_c_string = unsafe { CStr::from_bytes_with_nul_unchecked(b"catch\0") };
    check_status!(
      unsafe {
        sys::napi_get_named_property(env, promise_after_then, catch_c_string.as_ptr(), &mut catch)
      },
      "Failed to get then function"
    )?;
    let mut catch_js_cb = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env,
          catch_c_string.as_ptr(),
          5,
          Some(catch_callback::<T>),
          tx_ptr.cast(),
          &mut catch_js_cb,
        )
      },
      "Failed to create catch callback"
    )?;
    check_status!(
      unsafe {
        sys::napi_call_function(
          env,
          promise_after_then,
          catch,
          1,
          [catch_js_cb].as_ptr(),
          ptr::null_mut(),
        )
      },
      "Failed to call catch method"
    )?;
    Ok(Promise {
      value: Box::pin(rx),
      aborted,
    })
  }
}

impl<T: FromNapiValue> future::Future for Promise<T> {
  type Output = Result<T>;

  fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
    match self.value.as_mut().poll(cx) {
      Poll::Pending => Poll::Pending,
      Poll::Ready(v) => Poll::Ready(
        v.map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))
          .and_then(|v| unsafe { *Box::from_raw(v) }.map_err(Error::from)),
      ),
    }
  }
}

unsafe extern "C" fn then_callback<T: FromNapiValue>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut data = ptr::null_mut();
  let mut resolved_value: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut this = ptr::null_mut();
  let get_cb_status = unsafe {
    sys::napi_get_cb_info(
      env,
      info,
      &mut 1,
      resolved_value.as_mut_ptr(),
      &mut this,
      &mut data,
    )
  };
  debug_assert!(
    get_cb_status == sys::Status::napi_ok,
    "Get callback info from Promise::then failed"
  );
  let (sender, aborted) =
    *unsafe { Box::from_raw(data as *mut (Sender<*mut Result<T>>, Arc<AtomicBool>)) };
  if aborted.load(Ordering::SeqCst) {
    return this;
  }
  let resolve_value_t = Box::new(unsafe { T::from_napi_value(env, resolved_value[0]) });
  // The only reason for send to return Err is if the receiver isn't listening
  // Not hiding the error would result in a panic, it's safe to ignore it instead.
  let _ = sender.send(Box::into_raw(resolve_value_t));
  this
}

unsafe extern "C" fn catch_callback<T: FromNapiValue>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut data = ptr::null_mut();
  let mut rejected_value: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut this = ptr::null_mut();
  let mut argc = 1;
  let get_cb_status = unsafe {
    sys::napi_get_cb_info(
      env,
      info,
      &mut argc,
      rejected_value.as_mut_ptr(),
      &mut this,
      &mut data,
    )
  };
  debug_assert!(
    get_cb_status == sys::Status::napi_ok,
    "Get callback info from Promise::catch failed"
  );
  let rejected_value = rejected_value[0];
  let (sender, aborted) =
    *unsafe { Box::from_raw(data as *mut (Sender<*mut Result<T>>, Arc<AtomicBool>)) };
  if aborted.load(Ordering::SeqCst) {
    return this;
  }
  // The only reason for send to return Err is if the receiver isn't listening
  // Not hiding the error would result in a panic, it's safe to ignore it instead.
  let _ = sender.send(Box::into_raw(Box::new(Err(Error::from(unsafe {
    JsUnknown::from_raw_unchecked(env, rejected_value)
  })))));
  this
}
