use std::cell::Cell;
use std::ffi::c_void;
use std::ptr;

use crate::{bindgen_prelude::*, check_status, iterator::ScopedGenerator};

thread_local! {
  #[doc(hidden)]
  /// Determined is `constructor` called from Class `factory`
  pub static ___CALL_FROM_FACTORY: Cell<bool> = const { Cell::new(false) };
}

#[doc(hidden)]
pub struct CallbackInfo<const N: usize> {
  env: sys::napi_env,
  pub this: sys::napi_value,
  pub args: [sys::napi_value; N],
  this_reference: Cell<sys::napi_ref>,
  callback_env: Option<super::module_register::CallbackEnvGuard>,
}

impl<const N: usize> CallbackInfo<N> {
  #[allow(clippy::not_unsafe_ptr_arg_deref)]
  pub fn new(
    env: sys::napi_env,
    callback_info: sys::napi_callback_info,
    required_argc: Option<usize>,
    // for async class factory, the `this` will be used after the async call
    // so we must create reference for it and use it after async resolved
    use_after_async: bool,
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
          format!("{} arguments required by received {}.", required_argc, argc),
        ));
      }
    }

    let mut this_reference = ptr::null_mut();

    if use_after_async {
      check_status!(
        unsafe { sys::napi_create_reference(env, this, 1, &mut this_reference) },
        "Failed to create reference for `this` in async class factory"
      )?;
    }

    Ok(Self {
      env,
      this,
      args,
      this_reference: Cell::new(this_reference),
      callback_env: Some(super::module_register::enter_callback_env(env)),
    })
  }

  /// Ends the callback context after async argument conversion has finished.
  ///
  /// Async result conversion enters the exact settlement environment through `SendableResolver`,
  /// so retaining this setup guard in the resolver would make independently settling callbacks
  /// depend on stack order.
  #[doc(hidden)]
  pub fn release_callback_env(&mut self) {
    self.callback_env.take();
  }

  pub fn get_arg(&self, index: usize) -> sys::napi_value {
    self.args[index]
  }

  pub fn this(&self) -> sys::napi_value {
    self.this
  }

  fn _construct<const IsEmptyStructHint: bool, T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<(sys::napi_value, *mut T)> {
    let this = self.this();
    let _ = IsEmptyStructHint;
    let value_ref = unsafe { crate::bindgen_runtime::wrap_owned_class_value(self.env, this, obj) }
      .map_err(|err| {
        Error::new(
          err.status,
          format!("Failed to initialize class `{js_name}`: {}", err.reason),
        )
      })?;
    Ok((this, value_ref))
  }

  pub fn construct<const IsEmptyStructHint: bool, T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    self
      ._construct::<IsEmptyStructHint, T>(js_name, obj)
      .map(|(v, _)| v)
  }

  pub fn construct_generator<
    'a,
    const IsEmptyStructHint: bool,
    T: ScopedGenerator<'a> + ObjectFinalize + 'static,
  >(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._construct::<IsEmptyStructHint, T>(js_name, obj)?;
    unsafe {
      crate::bindgen_runtime::iterator::try_create_iterator(self.env, instance, generator_ptr)
    }?;
    Ok(instance)
  }

  pub fn factory<T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    self._factory(js_name, obj).map(|(value, _)| value)
  }

  pub fn generator_factory<'a, T: ObjectFinalize + ScopedGenerator<'a> + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._factory(js_name, obj)?;
    unsafe {
      crate::bindgen_runtime::iterator::try_create_iterator(self.env, instance, generator_ptr)
    }?;
    Ok(instance)
  }

  #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
  pub fn construct_async_generator<
    const IsEmptyStructHint: bool,
    T: crate::bindgen_runtime::AsyncGenerator + ObjectFinalize + 'static,
  >(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._construct::<IsEmptyStructHint, T>(js_name, obj)?;
    crate::bindgen_runtime::async_iterator::try_create_async_iterator(
      self.env,
      instance,
      generator_ptr,
    )?;
    Ok(instance)
  }

  #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
  pub fn async_generator_factory<
    T: ObjectFinalize + crate::bindgen_runtime::AsyncGenerator + 'static,
  >(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._factory(js_name, obj)?;
    crate::bindgen_runtime::async_iterator::try_create_async_iterator(
      self.env,
      instance,
      generator_ptr,
    )?;
    Ok(instance)
  }

  fn _factory<T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<(sys::napi_value, *mut T)> {
    let mut this = self.this();
    let mut instance = ptr::null_mut();
    let this_reference = self.this_reference.get();
    if !this_reference.is_null() {
      check_status!(
        unsafe { sys::napi_get_reference_value(self.env, this_reference, &mut this) },
        "Failed to get reference value for `this` in async class factory"
      )?;
      check_status!(
        unsafe { sys::napi_delete_reference(self.env, this_reference) },
        "Failed to delete reference for `this` in async class factory"
      )?;
      self.this_reference.set(ptr::null_mut());
    }
    ___CALL_FROM_FACTORY.with(|s| s.set(true));
    let status =
      unsafe { sys::napi_new_instance(self.env, this, 0, ptr::null_mut(), &mut instance) };
    ___CALL_FROM_FACTORY.with(|s| s.set(false));
    // Error thrown in `constructor`
    if status == sys::Status::napi_pending_exception {
      let mut exception = ptr::null_mut();
      unsafe { sys::napi_get_and_clear_last_exception(self.env, &mut exception) };
      unsafe { sys::napi_throw(self.env, exception) };
      return Ok((ptr::null_mut(), ptr::null_mut()));
    }
    check_status!(status, "Failed to create instance of class `{}`", js_name)?;
    let value_ref =
      unsafe { crate::bindgen_runtime::wrap_owned_class_value(self.env, instance, obj) }.map_err(
        |err| {
          Error::new(
            err.status,
            format!("Failed to initialize class `{js_name}`: {}", err.reason),
          )
        },
      )?;
    Ok((instance, value_ref))
  }

  #[doc(hidden)]
  #[inline]
  pub unsafe fn unwrap_raw<T>(&mut self) -> Result<*mut T>
  where
    T: TypeName,
  {
    let mut wrapped_val: *mut c_void = std::ptr::null_mut();

    unsafe {
      check_status!(
        sys::napi_unwrap(self.env, self.this, &mut wrapped_val),
        "Failed to unwrap exclusive reference of `{}` type from napi value",
        T::type_name(),
      )?;

      Ok(wrapped_val.cast())
    }
  }
}

impl<const N: usize> Drop for CallbackInfo<N> {
  fn drop(&mut self) {
    let this_reference = self.this_reference.replace(ptr::null_mut());
    if this_reference.is_null() {
      return;
    }
    let status = unsafe { sys::napi_delete_reference(self.env, this_reference) };
    if status != sys::Status::napi_ok && cfg!(debug_assertions) {
      eprintln!(
        "Failed to delete `this` reference for async class factory: {}",
        Status::from(status)
      );
    }
  }
}
