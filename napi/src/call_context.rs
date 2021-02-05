use std::any::TypeId;
use std::ffi::c_void;
use std::ptr;

use crate::check_status;
use crate::{sys, Either, Env, Error, JsUndefined, NapiValue, Result, Status};

/// Function call context
pub struct CallContext<'env> {
  pub env: &'env mut Env,
  raw_this: sys::napi_value,
  callback_info: sys::napi_callback_info,
  args: &'env [sys::napi_value],
  arg_len: usize,
  /// arguments.length
  pub length: usize,
  context: *mut c_void,
}

impl<'env> CallContext<'env> {
  #[inline]
  pub fn new(
    env: &'env mut Env,
    callback_info: sys::napi_callback_info,
    raw_this: sys::napi_value,
    args: &'env [sys::napi_value],
    arg_len: usize,
    length: usize,
    context: *mut c_void,
  ) -> Self {
    Self {
      env,
      callback_info,
      raw_this,
      args,
      arg_len,
      length,
      context,
    }
  }

  #[inline]
  pub fn get<ArgType: NapiValue>(&self, index: usize) -> Result<ArgType> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else {
      Ok(unsafe { ArgType::from_raw_unchecked(self.env.0, self.args[index]) })
    }
  }

  #[inline]
  pub fn try_get<ArgType: NapiValue>(&self, index: usize) -> Result<Either<ArgType, JsUndefined>> {
    if index + 1 > self.arg_len {
      Err(Error {
        status: Status::GenericFailure,
        reason: "Arguments index out of range".to_owned(),
      })
    } else if index < self.length {
      unsafe { ArgType::from_raw(self.env.0, self.args[index]) }.map(Either::A)
    } else {
      self.env.get_undefined().map(Either::B)
    }
  }

  #[inline]
  pub fn get_new_target<V>(&self) -> Result<V>
  where
    V: NapiValue,
  {
    let mut value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_new_target(self.env.0, self.callback_info, &mut value) })?;
    unsafe { V::from_raw(self.env.0, value) }
  }

  #[inline]
  pub fn this<T: NapiValue>(&self) -> Result<T> {
    unsafe { T::from_raw(self.env.0, self.raw_this) }
  }

  #[inline]
  pub fn this_unchecked<T: NapiValue>(&self) -> T {
    unsafe { T::from_raw_unchecked(self.env.0, self.raw_this) }
  }

  pub fn context_ref<T>(&self) -> Result<&T>
  where
    T: 'static,
  {
    let type_id = self.context as *mut TypeId;
    if unsafe { *type_id } == TypeId::of::<T>() {
      Ok(Box::leak(unsafe { Box::from_raw(self.context as *mut T) }))
    } else {
      Err(Error::new(
        Status::InvalidArg,
        "Provided context type `T` is not matched with the real type of context".to_owned(),
      ))
    }
  }

  pub fn context_mut<T>(&self) -> Result<&mut T>
  where
    T: 'static,
  {
    let type_id = self.context as *mut TypeId;
    if unsafe { *type_id } == TypeId::of::<T>() {
      Ok(Box::leak(unsafe { Box::from_raw(self.context as *mut T) }))
    } else {
      Err(Error::new(
        Status::InvalidArg,
        "Provided context type `T` is not matched with the real type of context".to_owned(),
      ))
    }
  }

  #[inline]
  /// If `T` is not matched with `Context` passed in `Env::create_function_with_context`/`Env::define_class_with_context`
  /// your program may `panic` here.
  pub fn context_ref_unchecked<T>(&self) -> &T {
    Box::leak(unsafe { Box::from_raw(self.context as *mut T) })
  }

  #[inline]
  /// If `T` is not matched with `Context` passed in `Env::create_function_with_context`/`Env::define_class_with_context`
  /// your program may `panic` here.
  pub fn context_mut_unchecked<T>(&mut self) -> &mut T {
    Box::leak(unsafe { Box::from_raw(self.context as *mut T) })
  }
}
