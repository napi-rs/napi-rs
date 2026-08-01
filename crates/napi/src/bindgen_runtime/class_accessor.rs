use std::ptr;

use super::{MaybeTypeTag, TypeName};
use crate::{check_status, sys, Error, JsError, Result, Status};

#[doc(hidden)]
pub type ClassAccessorGetter = unsafe fn(sys::napi_env, sys::napi_value) -> Result<sys::napi_value>;

#[doc(hidden)]
pub type ClassAccessorSetter =
  unsafe fn(sys::napi_env, sys::napi_value, sys::napi_value) -> Result<sys::napi_value>;

#[doc(hidden)]
pub struct ClassAccessorDescriptor {
  pub getter: Option<ClassAccessorGetter>,
  pub setter: Option<ClassAccessorSetter>,
}

#[doc(hidden)]
pub struct ClassAccessorCallbackInfo<const N: usize> {
  env: sys::napi_env,
  this: sys::napi_value,
  args: [sys::napi_value; N],
}

impl<const N: usize> ClassAccessorCallbackInfo<N> {
  #[doc(hidden)]
  #[inline]
  pub fn new(env: sys::napi_env, this: sys::napi_value, args: [sys::napi_value; N]) -> Self {
    Self { env, this, args }
  }

  #[doc(hidden)]
  #[inline]
  pub fn get_arg(&self, index: usize) -> sys::napi_value {
    self.args[index]
  }

  #[doc(hidden)]
  #[inline]
  pub fn this(&self) -> sys::napi_value {
    self.this
  }

  #[doc(hidden)]
  #[inline]
  pub unsafe fn unwrap_raw<T>(&mut self) -> Result<*mut T>
  where
    T: TypeName + MaybeTypeTag,
  {
    unsafe { class_accessor_unwrap_this::<T>(self.env, self.this) }
  }

  /// Borrowed-upcast receiver unwrap (issue #1164), for a `#[napi(getter)]` /
  /// `#[napi(setter)]` **method** with a plain `&self` / `&mut self` receiver
  /// (the codegen in `fn.rs` emits `cb.unwrap_borrowed_raw` for it). Accepts a
  /// descendant receiver reached via the prototype chain. `class_accessor_unwrap_this`
  /// already routes through `unwrap_borrowed_receiver`, so this is exact-first and
  /// identical in cost/behavior to [`unwrap_raw`](Self::unwrap_raw) for a
  /// non-extended class.
  #[doc(hidden)]
  #[inline]
  pub unsafe fn unwrap_borrowed_raw<T>(&mut self) -> Result<*mut T>
  where
    T: TypeName + MaybeTypeTag,
  {
    unsafe { class_accessor_unwrap_this::<T>(self.env, self.this) }
  }
}

#[doc(hidden)]
#[inline]
pub unsafe fn class_accessor_unwrap_this<T>(
  env: sys::napi_env,
  this: sys::napi_value,
) -> Result<*mut T>
where
  T: TypeName + MaybeTypeTag,
{
  // issue #1164: field accessors are always BorrowedUpcast — a parent-defined
  // getter/setter must work on a descendant receiver reached via the instance
  // prototype chain. Delegate to the shared borrowed-receiver unwrap, which is
  // exact-first (identical cost and behavior for a non-extended class, still
  // rejecting a spoofed receiver via its own tag check) and only consults the
  // class hierarchy on an exact miss. The returned pointer is only ever borrowed
  // by the caller, never reconstructed into a `Box`.
  unsafe { super::unwrap_borrowed_receiver::<T>(env, this) }
}

#[doc(hidden)]
pub unsafe extern "C" fn class_getter_trampoline(
  env: sys::napi_env,
  cb_info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut this = ptr::null_mut();
  let mut data = ptr::null_mut();

  check_status!(
    unsafe { sys::napi_get_cb_info(env, cb_info, &mut 0, ptr::null_mut(), &mut this, &mut data,) },
    "napi_get_cb_info failed"
  )
  .and_then(|_| {
    let descriptor = unsafe { (data as *const ClassAccessorDescriptor).as_ref() }
      .ok_or_else(|| Error::new(Status::InvalidArg, "Missing class accessor descriptor"))?;
    let getter = descriptor.getter.ok_or_else(|| {
      Error::new(
        Status::InvalidArg,
        "Missing class accessor getter descriptor",
      )
    })?;
    unsafe { getter(env, this) }
  })
  .unwrap_or_else(|e| {
    unsafe { JsError::from(e).throw_into(env) };
    ptr::null_mut()
  })
}

#[doc(hidden)]
pub unsafe extern "C" fn class_setter_trampoline(
  env: sys::napi_env,
  cb_info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut argc = 1;
  let mut args = [ptr::null_mut()];
  let mut this = ptr::null_mut();
  let mut data = ptr::null_mut();

  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        cb_info,
        &mut argc,
        args.as_mut_ptr(),
        &mut this,
        &mut data,
      )
    },
    "napi_get_cb_info failed"
  )
  .and_then(|_| {
    if argc == 0 {
      return Err(Error::new(
        Status::InvalidArg,
        "Missing argument in property setter",
      ));
    }
    let descriptor = unsafe { (data as *const ClassAccessorDescriptor).as_ref() }
      .ok_or_else(|| Error::new(Status::InvalidArg, "Missing class accessor descriptor"))?;
    let setter = descriptor.setter.ok_or_else(|| {
      Error::new(
        Status::InvalidArg,
        "Missing class accessor setter descriptor",
      )
    })?;
    unsafe { setter(env, this, args[0]) }
  })
  .unwrap_or_else(|e| {
    unsafe { JsError::from(e).throw_into(env) };
    ptr::null_mut()
  })
}
