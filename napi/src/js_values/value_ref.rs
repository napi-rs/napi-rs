use std::marker::PhantomData;

use super::NapiValue;
use crate::{sys, Status};

pub struct Ref<T: NapiValue> {
  pub(crate) raw_env: sys::napi_env,
  pub(crate) ref_value: sys::napi_ref,
  _phantom: PhantomData<T>,
}

impl<T: NapiValue> Ref<T> {
  pub fn new(raw_env: sys::napi_env, ref_value: sys::napi_ref) -> Ref<T> {
    Ref {
      raw_env,
      ref_value,
      _phantom: PhantomData,
    }
  }
}

impl<T: NapiValue> Drop for Ref<T> {
  fn drop(&mut self) {
    unsafe {
      let mut ref_count = 0;
      let status = sys::napi_reference_unref(self.raw_env, self.ref_value, &mut ref_count);
      debug_assert!(Status::from(status) == Status::Ok);

      if ref_count == 0 {
        let status = sys::napi_delete_reference(self.raw_env, self.ref_value);
        debug_assert!(Status::from(status) == Status::Ok);
      }
    }
  }
}
