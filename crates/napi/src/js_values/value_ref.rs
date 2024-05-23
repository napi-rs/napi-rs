use std::ops::Deref;
use std::ptr;

use super::{check_status, Value};
use crate::{bindgen_runtime::ToNapiValue, sys, Env, Result};

pub struct Ref<T> {
  pub(crate) raw_ref: sys::napi_ref,
  pub(crate) count: u32,
  pub(crate) inner: T,
}

#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl<T> Send for Ref<T> {}
unsafe impl<T> Sync for Ref<T> {}

impl<T> Ref<T> {
  pub(crate) fn new(js_value: Value, ref_count: u32, inner: T) -> Result<Ref<T>> {
    let mut raw_ref = ptr::null_mut();
    assert_ne!(ref_count, 0, "Initial `ref_count` must be > 0");
    check_status!(unsafe {
      sys::napi_create_reference(js_value.env, js_value.value, ref_count, &mut raw_ref)
    })?;
    Ok(Ref {
      raw_ref,
      count: ref_count,
      inner,
    })
  }

  pub fn reference(&mut self, env: &Env) -> Result<u32> {
    check_status!(unsafe { sys::napi_reference_ref(env.0, self.raw_ref, &mut self.count) })?;
    Ok(self.count)
  }

  pub fn unref(&mut self, env: Env) -> Result<u32> {
    check_status!(unsafe { sys::napi_reference_unref(env.0, self.raw_ref, &mut self.count) })?;

    if self.count == 0 {
      check_status!(unsafe { sys::napi_delete_reference(env.0, self.raw_ref) })?;
    }
    Ok(self.count)
  }
}

impl<T> Deref for Ref<T> {
  type Target = T;

  fn deref(&self) -> &T {
    &self.inner
  }
}

#[cfg(debug_assertions)]
impl<T> Drop for Ref<T> {
  fn drop(&mut self) {
    debug_assert_eq!(
      self.count, 0,
      "Ref count is not equal to 0 while dropping Ref, potential memory leak"
    );
  }
}

impl<T: 'static> ToNapiValue for Ref<T> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut result = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(env, val.raw_ref, &mut result) },
      "Failed to get reference value"
    )?;
    Ok(result)
  }
}
