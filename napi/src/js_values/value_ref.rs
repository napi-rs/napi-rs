use std::ops::Deref;
use std::ptr;

use super::{check_status, Value};
use crate::{sys, Env, Result};

pub struct Ref<T> {
  pub(crate) raw_ref: sys::napi_ref,
  count: u32,
  inner: T,
}

unsafe impl<T> Send for Ref<T> {}
unsafe impl<T> Sync for Ref<T> {}

impl<T> Ref<T> {
  pub(crate) fn new(js_value: Value, ref_count: u32, inner: T) -> Result<Ref<T>> {
    let mut raw_ref = ptr::null_mut();
    let initial_ref_count = 1;
    check_status(unsafe {
      sys::napi_create_reference(
        js_value.env,
        js_value.value,
        initial_ref_count,
        &mut raw_ref,
      )
    })?;
    Ok(Ref {
      raw_ref,
      count: ref_count,
      inner,
    })
  }

  #[must_use]
  pub fn unref(mut self, env: Env) -> Result<u32> {
    check_status(unsafe { sys::napi_reference_unref(env.0, self.raw_ref, &mut self.count) })?;

    if self.count == 0 {
      check_status(unsafe { sys::napi_delete_reference(env.0, self.raw_ref) })?;
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
