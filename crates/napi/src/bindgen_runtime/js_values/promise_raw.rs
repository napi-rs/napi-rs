use std::ffi::{c_void, CStr};
use std::marker::PhantomData;
use std::ptr;

use crate::bindgen_runtime::Promise;
use crate::{
  bindgen_prelude::{
    FromNapiValue, JsObjectValue, Result, ToNapiValue, TypeName, ValidateNapiValue,
  },
  check_status, sys, Env, Error, JsValue, Value, ValueType,
};

#[derive(Clone, Copy)]
pub struct PromiseRaw<'env, T> {
  pub(crate) inner: sys::napi_value,
  env: sys::napi_env,
  _phantom: &'env PhantomData<T>,
}

struct RetainedPromiseCallback<Callback> {
  callback: Option<Callback>,
}

impl<Callback> RetainedPromiseCallback<Callback> {
  fn new(callback: Callback) -> Self {
    Self {
      callback: Some(callback),
    }
  }

  fn take(&mut self) -> Result<Callback> {
    self
      .callback
      .take()
      .ok_or_else(|| Error::from_reason("PromiseRaw callback has already been invoked"))
  }
}

fn create_retained_promise_callback<Callback: 'static>(
  env: sys::napi_env,
  name: &CStr,
  callback: sys::napi_callback,
  rust_callback: Callback,
  create_error: &'static str,
) -> Result<sys::napi_value> {
  let mut callback_data = Box::new(RetainedPromiseCallback::new(rust_callback));
  let callback_data_ptr = callback_data.as_mut() as *mut RetainedPromiseCallback<Callback>;
  let mut js_callback = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_function(
        env,
        name.as_ptr(),
        name.to_bytes().len() as isize,
        callback,
        callback_data_ptr.cast(),
        &mut js_callback,
      )
    },
    "{}",
    create_error
  )?;
  // A Promise method may retain this function and then throw, so the function
  // itself must own the callback allocation before user JavaScript can run.
  check_status!(
    unsafe {
      sys::napi_wrap(
        env,
        js_callback,
        callback_data_ptr.cast(),
        Some(retained_promise_callback_finalizer::<Callback>),
        ptr::null_mut(),
        ptr::null_mut(),
      )
    },
    "Wrap callback function for PromiseRaw failed"
  )?;

  let _ = Box::into_raw(callback_data);
  Ok(js_callback)
}

unsafe fn take_retained_promise_callback<Callback>(data: *mut c_void) -> Result<Callback> {
  let callback_data = unsafe { data.cast::<RetainedPromiseCallback<Callback>>().as_mut() }
    .ok_or_else(|| Error::from_reason("PromiseRaw callback data was null"))?;
  callback_data.take()
}

unsafe fn drop_retained_promise_callback<Callback>(data: *mut c_void) {
  drop(unsafe { Box::from_raw(data.cast::<RetainedPromiseCallback<Callback>>()) });
}

unsafe extern "C" fn retained_promise_callback_finalizer<Callback>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    crate::bindgen_runtime::catch_unwind_safely(|| unsafe {
      drop_retained_promise_callback::<Callback>(finalize_data);
    });
  });
}

impl<'env, T> JsValue<'env> for PromiseRaw<'env, T> {
  fn value(&self) -> Value {
    Value {
      env: self.env,
      value: self.inner,
      value_type: ValueType::Object,
    }
  }
}

impl<'env, T> JsObjectValue<'env> for PromiseRaw<'env, T> {}

impl<T> TypeName for PromiseRaw<'_, T> {
  fn type_name() -> &'static str {
    "Promise"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Object
  }
}

impl<T> ValidateNapiValue for PromiseRaw<'_, T> {
  unsafe fn validate(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> Result<napi_sys::napi_value> {
    validate_promise(env, napi_val)
  }
}

impl<T> FromNapiValue for PromiseRaw<'_, T> {
  unsafe fn from_napi_value(env: napi_sys::napi_env, value: napi_sys::napi_value) -> Result<Self> {
    Ok(unsafe { PromiseRaw::new(env, value) })
  }
}

impl<T> PromiseRaw<'_, T> {
  /// Creates a `PromiseRaw` from raw Node-API handles.
  ///
  /// # Safety
  ///
  /// `env` must be valid on the current thread, `inner` must be a Promise value owned by that
  /// environment, and both handles must remain valid for the returned lifetime.
  pub unsafe fn new(env: sys::napi_env, inner: sys::napi_value) -> Self {
    Self {
      inner,
      env,
      _phantom: &PhantomData,
    }
  }

  #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
  pub(crate) fn reject_raw(env: &Env, error: sys::napi_value) -> Result<Self> {
    let mut deferred = ptr::null_mut();
    let mut promise = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_promise(env.0, &mut deferred, &mut promise) },
      "Failed to create promise"
    )?;
    check_status!(
      unsafe { sys::napi_reject_deferred(env.0, deferred, error) },
      "Failed to reject promise"
    )?;
    Ok(unsafe { PromiseRaw::new(env.0, promise) })
  }
}

impl<'env, T: ToNapiValue> PromiseRaw<'env, T> {
  /// Create a new promise and resolve it with the given value
  pub fn resolve(env: &Env, value: T) -> Result<Self> {
    let mut deferred = ptr::null_mut();
    let mut promise = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_promise(env.0, &mut deferred, &mut promise) },
      "Failed to create promise"
    )?;
    check_status!(
      unsafe {
        sys::napi_resolve_deferred(env.0, deferred, ToNapiValue::to_napi_value(env.0, value)?)
      },
      "Failed to resolve promise"
    )?;
    Ok(unsafe { PromiseRaw::new(env.0, promise) })
  }

  /// Create a new promise and reject it with the given error
  pub fn reject<E: ToNapiValue>(env: &Env, error: E) -> Result<Self> {
    let mut deferred = ptr::null_mut();
    let mut promise = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_promise(env.0, &mut deferred, &mut promise) },
      "Failed to create promise"
    )?;
    check_status!(
      unsafe {
        sys::napi_reject_deferred(env.0, deferred, ToNapiValue::to_napi_value(env.0, error)?)
      },
      "Failed to reject promise"
    )?;
    Ok(unsafe { PromiseRaw::new(env.0, promise) })
  }
}

impl<'env, T: FromNapiValue> PromiseRaw<'env, T> {
  /// Promise.then method
  ///
  /// The callback may be retained by JavaScript until the Promise reaction is collected, so all
  /// captured values must be `'static`. The reaction is not entered through a generated `#[napi]`
  /// callback and therefore has no native class borrow scope. Do not use `&T` or `&mut T` native
  /// class references for `T`; use an owned [`Reference`](crate::bindgen_runtime::Reference) or
  /// [`ClassInstance`](crate::bindgen_runtime::ClassInstance) instead.
  pub fn then<Callback, U>(&self, cb: Callback) -> Result<PromiseRaw<'env, U>>
  where
    U: ToNapiValue,
    Callback: 'static + FnOnce(CallbackContext<T>) -> Result<U>,
  {
    let mut then_fn = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_get_named_property(self.env, self.inner, c"then".as_ptr(), &mut then_fn)
    })?;
    let then_callback = create_retained_promise_callback(
      self.env,
      c"then",
      Some(raw_promise_then_callback::<T, U, Callback>),
      cb,
      "Create then function for PromiseRaw failed",
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
      "Call the PromiseRaw::then failed"
    )?;

    Ok(PromiseRaw::<U> {
      env: self.env,
      inner: new_promise,
      _phantom: &PhantomData,
    })
  }

  /// Promise.catch method
  ///
  /// The callback may be retained by JavaScript until the Promise reaction is collected, so all
  /// captured values must be `'static`. The reaction is not entered through a generated `#[napi]`
  /// callback and therefore has no native class borrow scope. Do not use `&T` or `&mut T` native
  /// class references for `E`; use an owned [`Reference`](crate::bindgen_runtime::Reference) or
  /// [`ClassInstance`](crate::bindgen_runtime::ClassInstance) instead.
  pub fn catch<E, U, Callback>(&self, cb: Callback) -> Result<PromiseRaw<'env, U>>
  where
    E: FromNapiValue,
    U: ToNapiValue,
    Callback: 'static + FnOnce(CallbackContext<E>) -> Result<U>,
  {
    let mut catch_fn = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_get_named_property(self.env, self.inner, c"catch".as_ptr(), &mut catch_fn)
    })?;
    let catch_callback = create_retained_promise_callback(
      self.env,
      c"catch",
      Some(raw_promise_catch_callback::<E, U, Callback>),
      cb,
      "Create catch function for PromiseRaw failed",
    )?;
    let mut new_promise = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_call_function(
          self.env,
          self.inner,
          catch_fn,
          1,
          [catch_callback].as_mut_ptr().cast(),
          &mut new_promise,
        )
      },
      "Call the PromiseRaw::catch failed"
    )?;

    Ok(PromiseRaw::<U> {
      env: self.env,
      inner: new_promise,
      _phantom: &PhantomData,
    })
  }

  /// Promise.finally method
  ///
  /// The callback may be retained by JavaScript until the Promise reaction is collected, so all
  /// captured values must be `'static`.
  pub fn finally<U, Callback>(&self, cb: Callback) -> Result<PromiseRaw<'env, T>>
  where
    U: ToNapiValue,
    Callback: 'static + FnOnce(Env) -> Result<U>,
  {
    let mut then_fn = ptr::null_mut();

    check_status!(unsafe {
      sys::napi_get_named_property(self.env, self.inner, c"finally".as_ptr(), &mut then_fn)
    })?;
    let then_callback = create_retained_promise_callback(
      self.env,
      c"finally",
      Some(raw_promise_finally_callback::<U, Callback>),
      cb,
      "Create finally function for PromiseRaw failed",
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
      "Call the PromiseRaw::finally failed"
    )?;

    Ok(Self {
      env: self.env,
      inner: new_promise,
      _phantom: &PhantomData,
    })
  }

  /// Convert `PromiseRaw<T>` to `Promise<T>`
  ///
  /// So you can await the Promise in Rust
  pub fn into_sendable_promise(self) -> Result<Promise<T>> {
    unsafe { Promise::from_napi_value(self.env, self.inner) }
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
    const INVALID_ARG: &[u8; 11] = b"InvalidArg\0";
    let mut err = ptr::null_mut();
    let mut code = ptr::null_mut();
    let mut message = ptr::null_mut();
    check_status!(
      unsafe {
        crate::sys::napi_create_string_utf8(env, INVALID_ARG.as_ptr().cast(), 10, &mut code)
      },
      "Failed to create error message"
    )?;
    check_status!(
      unsafe {
        crate::sys::napi_create_string_utf8(
          env,
          c"Expected Promise object".as_ptr().cast(),
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

unsafe extern "C" fn raw_promise_then_callback<T, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> sys::napi_value
where
  T: FromNapiValue,
  U: ToNapiValue,
  Cb: 'static + FnOnce(CallbackContext<T>) -> Result<U>,
{
  run_promise_callback(env, "Error in Promise.then", || {
    handle_then_callback::<T, U, Cb>(env, cbinfo)
  })
}

#[inline]
fn handle_then_callback<T, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> Result<sys::napi_value>
where
  T: FromNapiValue,
  U: ToNapiValue,
  Cb: 'static + FnOnce(CallbackContext<T>) -> Result<U>,
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
  let cb = unsafe { take_retained_promise_callback::<Cb>(rust_cb) }?;

  unsafe {
    U::to_napi_value(
      env,
      cb(CallbackContext {
        env: Env(env),
        value: then_value,
      })?,
    )
  }
}

unsafe extern "C" fn raw_promise_catch_callback<E, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> sys::napi_value
where
  E: FromNapiValue,
  U: ToNapiValue,
  Cb: 'static + FnOnce(CallbackContext<E>) -> Result<U>,
{
  run_promise_callback(env, "Error in Promise.catch", || {
    handle_catch_callback::<E, U, Cb>(env, cbinfo)
  })
}

#[inline(always)]
fn handle_catch_callback<E, U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> Result<sys::napi_value>
where
  E: FromNapiValue,
  U: ToNapiValue,
  Cb: 'static + FnOnce(CallbackContext<E>) -> Result<U>,
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
  let cb = unsafe { take_retained_promise_callback::<Cb>(rust_cb) }?;

  unsafe {
    U::to_napi_value(
      env,
      cb(CallbackContext {
        env: Env(env),
        value: catch_value,
      })?,
    )
  }
}

unsafe extern "C" fn raw_promise_finally_callback<U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> sys::napi_value
where
  U: ToNapiValue,
  Cb: 'static + FnOnce(Env) -> Result<U>,
{
  run_promise_callback(env, "Error in Promise.finally", || {
    handle_finally_callback::<U, Cb>(env, cbinfo)
  })
}

#[inline(always)]
fn handle_finally_callback<U, Cb>(
  env: sys::napi_env,
  cbinfo: sys::napi_callback_info,
) -> Result<sys::napi_value>
where
  U: ToNapiValue,
  Cb: 'static + FnOnce(Env) -> Result<U>,
{
  let mut rust_cb = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        cbinfo,
        &mut 0,
        ptr::null_mut(),
        ptr::null_mut(),
        &mut rust_cb,
      )
    },
    "Get callback info from finally callback failed"
  )?;
  let cb = unsafe { take_retained_promise_callback::<Cb>(rust_cb) }?;

  unsafe { U::to_napi_value(env, cb(Env(env))?) }
}

pub struct CallbackContext<T> {
  pub env: Env,
  pub value: T,
}

impl<T: ToNapiValue> ToNapiValue for CallbackContext<T> {
  unsafe fn to_napi_value(env: napi_sys::napi_env, val: Self) -> Result<napi_sys::napi_value> {
    T::to_napi_value(env, val.value)
  }
}

fn run_promise_callback(
  env: sys::napi_env,
  default_msg: &str,
  callback: impl FnOnce() -> Result<sys::napi_value>,
) -> sys::napi_value {
  match std::panic::catch_unwind(std::panic::AssertUnwindSafe(callback)) {
    Ok(Ok(value)) => value,
    Ok(Err(error)) => throw_error(env, error, default_msg),
    Err(payload) => throw_error(
      env,
      crate::bindgen_runtime::panic_to_error(payload),
      default_msg,
    ),
  }
}

#[inline(never)]
fn throw_error(env: sys::napi_env, err: Error, default_msg: &str) -> sys::napi_value {
  const GENERIC_FAILURE: &str = "GenericFailure\0";
  let code = if err.status.as_ref().is_empty() {
    GENERIC_FAILURE
  } else {
    err.status.as_ref()
  };
  let mut code_string = ptr::null_mut();
  let msg = if err.reason.is_empty() {
    default_msg
  } else {
    err.reason.as_ref()
  };
  let mut msg_string = ptr::null_mut();
  let mut err = ptr::null_mut();
  unsafe {
    sys::napi_create_string_latin1(
      env,
      code.as_ptr().cast(),
      code.len() as isize,
      &mut code_string,
    );
    sys::napi_create_string_utf8(
      env,
      msg.as_ptr().cast(),
      msg.len() as isize,
      &mut msg_string,
    );
    sys::napi_create_error(env, code_string, msg_string, &mut err);
    sys::napi_throw(env, err);
  };
  ptr::null_mut()
}

#[cfg(test)]
mod tests {
  use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
  };

  use super::*;

  struct DropProbe(Arc<AtomicUsize>);

  impl Drop for DropProbe {
    fn drop(&mut self) {
      self.0.fetch_add(1, Ordering::SeqCst);
    }
  }

  #[test]
  fn retained_callback_drops_before_ownership_transfer() {
    let drops = Arc::new(AtomicUsize::new(0));
    let callback_data = Box::new(RetainedPromiseCallback::new(DropProbe(Arc::clone(&drops))));

    drop(callback_data);

    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn retained_callback_finalizer_drops_uninvoked_callback() {
    let drops = Arc::new(AtomicUsize::new(0));
    let callback_data = Box::into_raw(Box::new(RetainedPromiseCallback::new(DropProbe(
      Arc::clone(&drops),
    ))));

    unsafe {
      drop_retained_promise_callback::<DropProbe>(callback_data.cast());
    }

    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn retained_callback_is_taken_and_dropped_exactly_once() {
    let drops = Arc::new(AtomicUsize::new(0));
    let callback_data = Box::into_raw(Box::new(RetainedPromiseCallback::new(DropProbe(
      Arc::clone(&drops),
    ))));

    let callback =
      unsafe { take_retained_promise_callback::<DropProbe>(callback_data.cast()) }.unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    assert!(unsafe { take_retained_promise_callback::<DropProbe>(callback_data.cast()) }.is_err());

    drop(callback);
    assert_eq!(drops.load(Ordering::SeqCst), 1);

    unsafe {
      drop_retained_promise_callback::<DropProbe>(callback_data.cast());
    }
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }
}
