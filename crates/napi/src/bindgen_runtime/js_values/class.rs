use std::any::type_name;
use std::ops::{Deref, DerefMut};
use std::ptr;

use super::Object;
use crate::{
  bindgen_runtime::{
    raw_finalize_unchecked, FromNapiValue, ObjectFinalize, Reference, Result, TypeName,
    ValidateNapiValue,
  },
  check_status, sys, Env, NapiRaw, NapiValue, ValueType,
};

pub type This<T = Object> = T;

pub struct ClassInstance<T: 'static> {
  pub value: sys::napi_value,
  inner: &'static mut T,
}

impl<T: 'static> ClassInstance<T> {
  #[doc(hidden)]
  pub fn new(value: sys::napi_value, inner: &'static mut T) -> Self {
    Self { value, inner }
  }

  pub fn as_object(&self, env: Env) -> Object {
    unsafe { Object::from_raw_unchecked(env.raw(), self.value) }
  }
}

impl<T: 'static> NapiRaw for ClassInstance<T> {
  unsafe fn raw(&self) -> sys::napi_value {
    self.value
  }
}

impl<T: 'static> TypeName for ClassInstance<T>
where
  &'static T: TypeName,
{
  fn type_name() -> &'static str {
    type_name::<&T>()
  }

  fn value_type() -> ValueType {
    <&T>::value_type()
  }
}

impl<T: 'static> ValidateNapiValue for ClassInstance<T>
where
  &'static T: ValidateNapiValue,
{
  unsafe fn validate(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> crate::Result<sys::napi_value> {
    unsafe { <&T>::validate(env, napi_val) }
  }
}

impl<T: 'static> FromNapiValue for ClassInstance<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut value = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_unwrap(env, napi_val, &mut value) },
      "Unwrap value [{}] from class failed",
      type_name::<T>(),
    )?;
    let value = unsafe { Box::from_raw(value as *mut T) };
    Ok(Self {
      value: napi_val,
      inner: Box::leak(value),
    })
  }
}

impl<T: 'static> Deref for ClassInstance<T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    self.inner
  }
}

impl<T: 'static> DerefMut for ClassInstance<T> {
  fn deref_mut(&mut self) -> &mut T {
    self.inner
  }
}

impl<T: 'static> AsRef<T> for ClassInstance<T> {
  fn as_ref(&self) -> &T {
    self.inner
  }
}

impl<T: 'static> AsMut<T> for ClassInstance<T> {
  fn as_mut(&mut self) -> &mut T {
    self.inner
  }
}

pub trait JavaScriptClassExt: Sized {
  fn into_instance(self, env: Env) -> Result<ClassInstance<Self>>;
  fn into_reference(self, env: Env) -> Result<Reference<Self>>;
  fn instance_of<V: NapiRaw>(env: Env, value: V) -> Result<bool>;
}

/// # Safety
///
/// create instance of class
#[doc(hidden)]
pub unsafe fn new_instance<T: 'static + ObjectFinalize>(
  env: sys::napi_env,
  wrapped_value: *mut std::ffi::c_void,
  ctor_ref: sys::napi_ref,
) -> Result<sys::napi_value> {
  let mut ctor = std::ptr::null_mut();
  check_status!(
    sys::napi_get_reference_value(env, ctor_ref, &mut ctor),
    "Failed to get constructor reference of class `{}`",
    type_name::<T>(),
  )?;

  let mut result = std::ptr::null_mut();
  crate::__private::___CALL_FROM_FACTORY
    .with(|inner| inner.store(true, std::sync::atomic::Ordering::Relaxed));
  check_status!(
    sys::napi_new_instance(env, ctor, 0, std::ptr::null_mut(), &mut result),
    "Failed to construct class `{}`",
    type_name::<T>(),
  )?;
  crate::__private::___CALL_FROM_FACTORY
    .with(|inner| inner.store(false, std::sync::atomic::Ordering::Relaxed));
  let mut object_ref = std::ptr::null_mut();
  let initial_finalize: Box<dyn FnOnce()> = Box::new(|| {});
  let finalize_callbacks_ptr = std::rc::Rc::into_raw(std::rc::Rc::new(std::cell::Cell::new(
    Box::into_raw(initial_finalize),
  )));
  check_status!(
    sys::napi_wrap(
      env,
      result,
      wrapped_value,
      Some(raw_finalize_unchecked::<T>),
      std::ptr::null_mut(),
      &mut object_ref,
    ),
    "Failed to wrap native object of class `{}`",
    type_name::<T>(),
  )?;
  Reference::<T>::add_ref(
    env,
    wrapped_value,
    (wrapped_value, object_ref, finalize_callbacks_ptr),
  );
  Ok(result)
}
