use std::cell::Cell;
use std::ffi::c_void;
use std::ptr;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};

use once_cell::sync::Lazy;
use thread_local::ThreadLocal;

use crate::{bindgen_prelude::*, check_status, sys, Result};

#[doc(hidden)]
/// Determined is `constructor` called from Class `factory`
pub static ___CALL_FROM_FACTORY: Lazy<ThreadLocal<AtomicBool>> = Lazy::new(ThreadLocal::new);

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

  fn _construct<T: 'static>(&self, js_name: &str, obj: T) -> Result<(sys::napi_value, *mut T)> {
    let obj = Box::new(obj);
    let this = self.this();
    let value_ref = Box::into_raw(obj);
    let mut object_ref = ptr::null_mut();
    let initial_finalize: Box<dyn FnOnce()> = Box::new(|| {});
    let finalize_callbacks_ptr = Rc::into_raw(Rc::new(Cell::new(Box::into_raw(initial_finalize))));
    unsafe {
      check_status!(
        sys::napi_wrap(
          self.env,
          this,
          value_ref as *mut c_void,
          Some(raw_finalize_unchecked::<T>),
          ptr::null_mut(),
          &mut object_ref
        ),
        "Failed to initialize class `{}`",
        js_name,
      )?;
    };

    Reference::<T>::add_ref(
      value_ref as *mut c_void,
      (value_ref as *mut c_void, object_ref, finalize_callbacks_ptr),
    );
    Ok((this, value_ref))
  }

  pub fn construct<T: 'static>(&self, js_name: &str, obj: T) -> Result<sys::napi_value> {
    self._construct(js_name, obj).map(|(v, _)| v)
  }

  pub fn construct_generator<T: Generator + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._construct(js_name, obj)?;
    crate::__private::create_iterator(self.env, instance, generator_ptr);
    Ok(instance)
  }

  pub fn factory<T: 'static>(&self, js_name: &str, obj: T) -> Result<sys::napi_value> {
    self._factory(js_name, obj).map(|(value, _)| value)
  }

  pub fn generator_factory<T: Generator + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._factory(js_name, obj)?;
    crate::__private::create_iterator(self.env, instance, generator_ptr);
    Ok(instance)
  }

  fn _factory<T: 'static>(&self, js_name: &str, obj: T) -> Result<(sys::napi_value, *mut T)> {
    let this = self.this();
    let mut instance = ptr::null_mut();
    let inner = ___CALL_FROM_FACTORY.get_or_default();
    inner.store(true, Ordering::Relaxed);
    let status =
      unsafe { sys::napi_new_instance(self.env, this, 0, ptr::null_mut(), &mut instance) };
    inner.store(false, Ordering::Relaxed);
    // Error thrown in `constructor`
    if status == sys::Status::napi_pending_exception {
      let mut exception = ptr::null_mut();
      unsafe { sys::napi_get_and_clear_last_exception(self.env, &mut exception) };
      unsafe { sys::napi_throw(self.env, exception) };
      return Ok((ptr::null_mut(), ptr::null_mut()));
    }
    let obj = Box::new(obj);
    let initial_finalize: Box<dyn FnOnce()> = Box::new(|| {});
    let finalize_callbacks_ptr = Rc::into_raw(Rc::new(Cell::new(Box::into_raw(initial_finalize))));
    let mut object_ref = ptr::null_mut();
    let value_ref = Box::into_raw(obj);
    check_status!(
      unsafe {
        sys::napi_wrap(
          self.env,
          instance,
          value_ref as *mut c_void,
          Some(raw_finalize_unchecked::<T>),
          ptr::null_mut(),
          &mut object_ref,
        )
      },
      "Failed to initialize class `{}`",
      js_name,
    )?;

    Reference::<T>::add_ref(
      value_ref as *mut c_void,
      (value_ref as *mut c_void, object_ref, finalize_callbacks_ptr),
    );
    Ok((instance, value_ref))
  }

  pub fn unwrap_borrow_mut<T>(&mut self) -> Result<&'static mut T>
  where
    T: FromNapiMutRef + TypeName,
  {
    unsafe { self.unwrap_raw::<T>() }.map(|raw| Box::leak(unsafe { Box::from_raw(raw) }))
  }

  pub fn unwrap_borrow<T>(&mut self) -> Result<&'static T>
  where
    T: FromNapiRef + TypeName,
  {
    unsafe { self.unwrap_raw::<T>() }
      .map(|raw| Box::leak(unsafe { Box::from_raw(raw) }) as &'static T)
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

      Ok(wrapped_val as *mut T)
    }
  }
}
