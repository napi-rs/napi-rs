use std::ffi::{CStr, CString};
use std::marker::PhantomData;
use std::ptr;

#[cfg(all(feature = "napi4", feature = "tokio_rt"))]
use crate::bindgen_runtime::Promise;
use crate::NapiRaw;
use crate::{
  bindgen_prelude::{FromNapiValue, Result, ToNapiValue, TypeName, ValidateNapiValue},
  check_status, sys,
};

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

  #[cfg(all(feature = "napi4", feature = "tokio_rt"))]
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
    validate_promise(env, napi_val)
  }
}

impl<T> NapiRaw for PromiseRaw<T> {
  unsafe fn raw(&self) -> sys::napi_value {
    self.inner
  }
}

pub(crate) fn validate_promise(
  env: napi_sys::napi_env,
  napi_val: napi_sys::napi_value,
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

impl<T> FromNapiValue for PromiseRaw<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    Ok(PromiseRaw {
      inner: napi_val,
      env,
      _phantom: PhantomData,
    })
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
