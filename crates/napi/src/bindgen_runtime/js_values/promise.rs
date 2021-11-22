use std::ffi::{c_void, CStr};
use std::future;
use std::pin::Pin;
use std::ptr;
use std::task::{Context, Poll};

use tokio::sync::oneshot::{channel, Receiver, Sender};

use crate::{check_status, Error, Result, Status};

use super::FromNapiValue;

pub struct Promise<T: FromNapiValue> {
  value: Pin<Box<Receiver<*mut Result<T>>>>,
}

unsafe impl<T: FromNapiValue> Send for Promise<T> {}

impl<T: FromNapiValue> FromNapiValue for Promise<T> {
  unsafe fn from_napi_value(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> crate::Result<Self> {
    let mut then = ptr::null_mut();
    let then_c_string = CStr::from_bytes_with_nul_unchecked(b"then\0");
    check_status!(
      napi_sys::napi_get_named_property(env, napi_val, then_c_string.as_ptr(), &mut then,),
      "Failed to get then function"
    )?;
    let mut promise_after_then = ptr::null_mut();
    let mut then_js_cb = ptr::null_mut();
    let (tx, rx) = channel();
    let tx_ptr = Box::into_raw(Box::new(tx));
    check_status!(
      napi_sys::napi_create_function(
        env,
        then_c_string.as_ptr(),
        4,
        Some(then_callback::<T>),
        tx_ptr as *mut _,
        &mut then_js_cb,
      ),
      "Failed to create then callback"
    )?;
    check_status!(
      napi_sys::napi_call_function(
        env,
        napi_val,
        then,
        1,
        [then_js_cb].as_ptr(),
        &mut promise_after_then,
      ),
      "Failed to call then method"
    )?;
    let mut catch = ptr::null_mut();
    let catch_c_string = CStr::from_bytes_with_nul_unchecked(b"catch\0");
    check_status!(
      napi_sys::napi_get_named_property(
        env,
        promise_after_then,
        catch_c_string.as_ptr(),
        &mut catch
      ),
      "Failed to get then function"
    )?;
    let mut catch_js_cb = ptr::null_mut();
    check_status!(
      napi_sys::napi_create_function(
        env,
        catch_c_string.as_ptr(),
        5,
        Some(catch_callback::<T>),
        tx_ptr as *mut c_void,
        &mut catch_js_cb
      ),
      "Failed to create catch callback"
    )?;
    check_status!(
      napi_sys::napi_call_function(
        env,
        promise_after_then,
        catch,
        1,
        [catch_js_cb].as_ptr(),
        ptr::null_mut()
      ),
      "Failed to call catch method"
    )?;
    Ok(Promise {
      value: Box::pin(rx),
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
  env: napi_sys::napi_env,
  info: napi_sys::napi_callback_info,
) -> napi_sys::napi_value {
  let mut data = ptr::null_mut();
  let mut resolved_value: [napi_sys::napi_value; 1] = [ptr::null_mut()];
  let mut this = ptr::null_mut();
  let get_cb_status = napi_sys::napi_get_cb_info(
    env,
    info,
    &mut 1,
    resolved_value.as_mut_ptr(),
    &mut this,
    &mut data,
  );
  debug_assert!(
    get_cb_status == napi_sys::Status::napi_ok,
    "Get callback info from Promise::then failed"
  );
  let resolve_value_t = Box::new(T::from_napi_value(env, resolved_value[0]));
  let sender = Box::from_raw(data as *mut Sender<*mut Result<T>>);
  sender
    .send(Box::into_raw(resolve_value_t))
    .expect("Send Promise resolved value error");
  this
}

unsafe extern "C" fn catch_callback<T: FromNapiValue>(
  env: napi_sys::napi_env,
  info: napi_sys::napi_callback_info,
) -> napi_sys::napi_value {
  let mut data = ptr::null_mut();
  let mut rejected_value: [napi_sys::napi_value; 1] = [ptr::null_mut()];
  let mut this = ptr::null_mut();
  let mut argc = 1;
  let get_cb_status = napi_sys::napi_get_cb_info(
    env,
    info,
    &mut argc,
    rejected_value.as_mut_ptr(),
    &mut this,
    &mut data,
  );
  debug_assert!(
    get_cb_status == napi_sys::Status::napi_ok,
    "Get callback info from Promise::catch failed"
  );
  let rejected_value = rejected_value[0];
  let mut error_ref = ptr::null_mut();
  let create_ref_status = napi_sys::napi_create_reference(env, rejected_value, 1, &mut error_ref);
  debug_assert!(
    create_ref_status == napi_sys::Status::napi_ok,
    "Create Error reference failed"
  );
  let sender = Box::from_raw(data as *mut Sender<*mut Result<T>>);
  sender
    .send(Box::into_raw(Box::new(Err(Error::from(error_ref)))))
    .expect("Send Promise resolved value error");
  this
}
