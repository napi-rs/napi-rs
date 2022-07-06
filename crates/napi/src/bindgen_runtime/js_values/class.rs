use std::any::type_name;
use std::ops::{Deref, DerefMut};
use std::ptr;

use crate::{bindgen_runtime::FromNapiValue, check_status, sys, JsObject, NapiRaw};

pub type This = JsObject;

pub struct ClassInstance<T: 'static> {
  pub value: sys::napi_value,
  inner: &'static mut T,
}

impl<T: 'static> ClassInstance<T> {
  #[doc(hidden)]
  pub fn new(value: sys::napi_value, inner: &'static mut T) -> Self {
    Self { value, inner }
  }
}

impl<T: 'static> NapiRaw for ClassInstance<T> {
  unsafe fn raw(&self) -> sys::napi_value {
    self.value
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
