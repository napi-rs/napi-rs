use crate::{bindgen_prelude::*, check_status, sys, Result};
use std::{ffi::c_void, ptr};

pub struct CallbackInfo<const N: usize> {
  env: sys::napi_env,
  this: sys::napi_value,
  args: [sys::napi_value; N],
}

impl<const N: usize> CallbackInfo<N> {
  pub fn new(env: sys::napi_env, callback_info: sys::napi_callback_info) -> Result<Self> {
    let mut this = ptr::null_mut();
    let mut args = [ptr::null_mut(); N];
    let mut argc = N;

    unsafe {
      check_status!(
        sys::napi_get_cb_info(
          env,
          callback_info,
          &mut argc,
          args.as_mut_ptr(),
          &mut this,
          ptr::null_mut(),
        ),
        "Failed to initialize napi function call."
      )?;
    };

    Ok(Self { env, this, args })
  }

  pub fn get_arg(&self, index: usize) -> sys::napi_value {
    assert!(index < N);

    *self.args.get(index).unwrap()
  }

  pub fn this(&self) -> sys::napi_value {
    assert!(!self.this.is_null());

    self.this
  }

  pub fn construct<T>(&self, js_name: &str, obj: T) -> Result<sys::napi_value> {
    let obj = Box::new(obj);
    let mut result = std::ptr::null_mut();
    let this = self.this();

    unsafe {
      check_status!(
        sys::napi_wrap(
          self.env,
          this,
          Box::into_raw(obj) as *mut std::ffi::c_void,
          Some(raw_finalize_unchecked::<T>),
          ptr::null_mut(),
          &mut result
        ),
        "Failed to initialize class `{}`",
        js_name,
      )?;
    };

    Ok(this)
  }

  pub fn unwrap_borrow_mut<T>(&mut self) -> Result<&'static mut T>
  where
    T: FromNapiMutRef + TypeName,
  {
    let mut wrapped_val: *mut c_void = std::ptr::null_mut();

    unsafe {
      check_status!(
        sys::napi_unwrap(self.env, self.this, &mut wrapped_val),
        "Failed to unwrap exclusive reference of `{}` type from napi value",
        T::type_name(),
      )?;

      Ok(&mut *(wrapped_val as *mut T))
    }
  }

  pub fn unwrap_borrow<T>(&mut self) -> Result<&'static T>
  where
    T: FromNapiRef + TypeName,
  {
    let mut wrapped_val: *mut c_void = std::ptr::null_mut();

    unsafe {
      check_status!(
        sys::napi_unwrap(self.env, self.this, &mut wrapped_val),
        "Failed to unwrap shared reference of `{}` type from napi value",
        T::type_name(),
      )?;

      Ok(&*(wrapped_val as *const T))
    }
  }
}
