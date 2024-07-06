use std::ffi::{CStr, CString};
use std::future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::ptr;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};
use std::task::{Context, Poll};

use tokio::sync::oneshot::{channel, Receiver, Sender};

use crate::{check_status, sys, Error, JsUnknown, NapiValue, Result, Status};

use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};

/// The JavaScript Promise object representation
///
/// This `Promise<T>` can be awaited in the Rust
/// THis `Promise<T>` can also be passed from `#[napi]` fn
///
/// example:
///
/// ```no_run
/// #[napi]
/// pub fn await_promise_in_rust(promise: Promise<u32>) {
///   let value = promise.await.unwrap();
///
///   println!("{value}");
/// }
/// ```
///
/// But this `Promise<T>` can not be pass back to `JavaScript`.
/// If you want to use raw JavaScript `Promise` API, you can use the [`PromiseRaw`](./PromiseRaw) instead.
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

pub struct PromiseRaw<T> {
  pub(crate) inner: sys::napi_value,
  env: sys::napi_env,
  _phantom: PhantomData<T>,
}

impl<T> PromiseRaw<T> {
  pub(crate) fn new(env: sys::napi_env, inner: sys::napi_value) -> Self {
    Self {
      inner,
      env,
      _phantom: PhantomData,
    }
  }
}

impl<T: FromNapiValue> PromiseRaw<T> {
  /// Promise.then method
  pub fn then<Callback, U>(&mut self, cb: Callback) -> Result<PromiseRaw<U>>
  where
    U: ToNapiValue,
    Callback: FnOnce(T) -> Result<U>,
  {
    let mut then_fn = ptr::null_mut();
    let then_c_string = unsafe { CStr::from_bytes_with_nul_unchecked(b"then\0") };
    check_status!(unsafe {
      sys::napi_get_named_property(self.env, self.inner, then_c_string.as_ptr(), &mut then_fn)
    })?;
    let mut then_callback = ptr::null_mut();
    let rust_cb = Box::into_raw(Box::new(cb));
    check_status!(
      unsafe {
        sys::napi_create_function(
          self.env,
          then_c_string.as_ptr(),
          4,
          Some(raw_promise_then_callback::<T, U, Callback>),
          rust_cb.cast(),
          &mut then_callback,
        )
      },
      "Create then function for PromiseRaw failed"
    )?;
    let mut new_promise = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_call_function(
          self.env,
          self.inner,
          then_fn,
          1,
          [then_callback].as_ptr(),
          &mut new_promise,
        )
      },
      "Call then callback on PromiseRaw failed"
    )?;

    Ok(PromiseRaw::<U> {
      env: self.env,
      inner: new_promise,
      _phantom: PhantomData,
    })
  }

  /// Promise.catch method
  pub fn catch<E, U, Callback>(&mut self, cb: Callback) -> Result<PromiseRaw<U>>
  where
    E: FromNapiValue,
    U: ToNapiValue,
    Callback: FnOnce(E) -> Result<U>,
  {
    let mut catch_fn = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_get_named_property(
        self.env,
        self.inner,
        "catch\0".as_ptr().cast(),
        &mut catch_fn,
      )
    })?;
    let mut catch_callback = ptr::null_mut();
    let rust_cb = Box::into_raw(Box::new(cb));
    check_status!(unsafe {
      sys::napi_create_function(
        self.env,
        "catch\0".as_ptr().cast(),
        5,
        Some(raw_promise_catch_callback::<E, U, Callback>),
        rust_cb.cast(),
        &mut catch_callback,
      )
    })?;
    let mut new_promise = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_call_function(
        self.env,
        self.inner,
        catch_fn,
        1,
        [catch_callback].as_mut_ptr().cast(),
        &mut new_promise,
      )
    })?;

    Ok(PromiseRaw::<U> {
      env: self.env,
      inner: new_promise,
      _phantom: PhantomData,
    })
  }

  /// Convert `PromiseRaw<T>` to `Promise<T>`
  ///
  /// So you can await the Promise in Rust
  pub fn into_sendable_promise(self) -> Result<Promise<T>> {
    unsafe { Promise::from_napi_value(self.env, self.inner) }
  }
}

impl<T: FromNapiValue> TypeName for PromiseRaw<T> {
  fn type_name() -> &'static str {
    "Promise"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Object
  }
}

impl<T: FromNapiValue> ValidateNapiValue for PromiseRaw<T> {
  unsafe fn validate(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> Result<napi_sys::napi_value> {
    Promise::<T>::validate(env, napi_val)
  }
}

impl<T> FromNapiValue for PromiseRaw<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    Ok(PromiseRaw {
      inner: napi_val,
      env,
      _phantom: PhantomData,
    })
  }
}

impl<T> ToNapiValue for PromiseRaw<T> {
  unsafe fn to_napi_value(_env: napi_sys::napi_env, val: Self) -> Result<napi_sys::napi_value> {
    Ok(val.inner)
  }
}

unsafe extern "C" fn raw_promise_then_callback<T, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> sys::napi_value
where
  T: FromNapiValue,
  U: ToNapiValue,
  Cb: FnOnce(T) -> Result<U>,
{
  match handle_then_callback::<T, U, Cb>(env, cbinfo) {
    Ok(v) => v,
    Err(err) => {
      let code = CString::new(err.status.as_ref()).unwrap();
      let msg = CString::new(err.reason).unwrap();
      unsafe { sys::napi_throw_error(env, code.as_ptr(), msg.as_ptr()) };
      ptr::null_mut()
    }
  }
}

fn handle_then_callback<T, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> Result<sys::napi_value>
where
  T: FromNapiValue,
  U: ToNapiValue,
  Cb: FnOnce(T) -> Result<U>,
{
  let mut callback_values = [ptr::null_mut()];
  let mut rust_cb = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        cbinfo,
        &mut 1,
        callback_values.as_mut_ptr(),
        ptr::null_mut(),
        &mut rust_cb,
      )
    },
    "Get callback info from then callback failed"
  )?;
  let then_value: T = unsafe { FromNapiValue::from_napi_value(env, callback_values[0]) }?;
  let cb: Box<Cb> = unsafe { Box::from_raw(rust_cb.cast()) };

  unsafe { U::to_napi_value(env, cb(then_value)?) }
}

unsafe extern "C" fn raw_promise_catch_callback<E, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> sys::napi_value
where
  E: FromNapiValue,
  U: ToNapiValue,
  Cb: FnOnce(E) -> Result<U>,
{
  match handle_catch_callback::<E, U, Cb>(env, cbinfo) {
    Ok(v) => v,
    Err(err) => {
      let code = CString::new(err.status.as_ref()).unwrap();
      let msg = CString::new(err.reason).unwrap();
      unsafe { sys::napi_throw_error(env, code.as_ptr(), msg.as_ptr()) };
      ptr::null_mut()
    }
  }
}

fn handle_catch_callback<E, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> Result<sys::napi_value>
where
  E: FromNapiValue,
  U: ToNapiValue,
  Cb: FnOnce(E) -> Result<U>,
{
  let mut callback_values = [ptr::null_mut(); 1];
  let mut rust_cb = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        cbinfo,
        &mut 1,
        callback_values.as_mut_ptr(),
        ptr::null_mut(),
        &mut rust_cb,
      )
    },
    "Get callback info from catch callback failed"
  )?;
  let catch_value: E = unsafe { FromNapiValue::from_napi_value(env, callback_values[0]) }?;
  let cb: Box<Cb> = unsafe { Box::from_raw(rust_cb.cast()) };

  unsafe { U::to_napi_value(env, cb(catch_value)?) }
}
