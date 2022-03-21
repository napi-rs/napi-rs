use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::{bindgen_prelude::*, check_status, sys, Result};

thread_local! {
  #[doc(hidden)]
  /// Determined is `constructor` called from Class `factory`
  pub static ___CALL_FROM_FACTORY: AtomicBool = AtomicBool::new(false);
}

pub struct CallbackInfo<const N: usize> {
  env: sys::napi_env,
  pub this: sys::napi_value,
  pub args: [sys::napi_value; N],
}

impl<const N: usize> CallbackInfo<N> {
  #[allow(clippy::not_unsafe_ptr_arg_deref)]
  pub fn new(
    env: sys::napi_env,
    callback_info: sys::napi_callback_info,
    required_argc: Option<usize>,
  ) -> Result<Self> {
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

    if let Some(required_argc) = required_argc {
      if required_argc > argc {
        return Err(Error::new(
          Status::InvalidArg,
          format!(
            "{} arguments required by received {}.",
            required_argc, &argc
          ),
        ));
      }
    }

    Ok(Self { env, this, args })
  }

  pub fn get_arg(&self, index: usize) -> sys::napi_value {
    self.args[index]
  }

  pub fn this(&self) -> sys::napi_value {
    self.this
  }

  pub fn construct<T: 'static>(&self, js_name: &str, obj: T) -> Result<sys::napi_value> {
    let obj = Box::new(obj);
    let this = self.this();
    let value_ref = Box::into_raw(obj) as *mut c_void;
    let mut object_ref = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_wrap(
          self.env,
          this,
          value_ref,
          Some(raw_finalize_unchecked::<T>),
          ptr::null_mut(),
          &mut object_ref
        ),
        "Failed to initialize class `{}`",
        js_name,
      )?;
    };

    Reference::<T>::add_ref(
      std::any::TypeId::of::<T>(),
      (value_ref, self.env, object_ref),
    );
    Ok(this)
  }

  pub fn factory<T: 'static>(&self, js_name: &str, obj: T) -> Result<sys::napi_value> {
    let obj = Box::new(obj);
    let this = self.this();
    let mut instance = ptr::null_mut();
    unsafe {
      ___CALL_FROM_FACTORY.with(|inner| inner.store(true, Ordering::Relaxed));
      let status = sys::napi_new_instance(self.env, this, 0, ptr::null_mut(), &mut instance);
      ___CALL_FROM_FACTORY.with(|inner| inner.store(false, Ordering::Relaxed));
      // Error thrown in `constructor`
      if status == sys::Status::napi_pending_exception {
        let mut exception = ptr::null_mut();
        sys::napi_get_and_clear_last_exception(self.env, &mut exception);
        sys::napi_throw(self.env, exception);
        return Ok(ptr::null_mut());
      }

      let mut object_ref = ptr::null_mut();
      let value_ref = Box::into_raw(obj) as *mut c_void;
      check_status!(
        sys::napi_wrap(
          self.env,
          instance,
          value_ref,
          Some(raw_finalize_unchecked::<T>),
          ptr::null_mut(),
          &mut object_ref
        ),
        "Failed to initialize class `{}`",
        js_name,
      )?;

      Reference::<T>::add_ref(
        std::any::TypeId::of::<T>(),
        (value_ref, self.env, object_ref),
      );
    };

    Ok(instance)
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
