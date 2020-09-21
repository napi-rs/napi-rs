use std::marker::PhantomData;

use super::NapiValue;
use crate::{sys, Env, Status};

pub struct Ref<'env, T: NapiValue<'env>> {
  pub(crate) env: &'env Env,
  pub(crate) ref_value: sys::napi_ref,
  _phantom: PhantomData<T>,
}

impl<'env, T: NapiValue<'env>> Ref<'env, T> {
  pub fn new(env: &'env Env, ref_value: sys::napi_ref) -> Ref<'env, T> {
    Ref {
      env,
      ref_value,
      _phantom: PhantomData,
    }
  }
}

impl<'env, T: NapiValue<'env>> Drop for Ref<'env, T> {
  fn drop(&mut self) {
    unsafe {
      let mut ref_count = 0;
      let status = sys::napi_reference_unref(self.env.0, self.ref_value, &mut ref_count);
      debug_assert!(Status::from(status) == Status::Ok);

      if ref_count == 0 {
        let status = sys::napi_delete_reference(self.env.0, self.ref_value);
        debug_assert!(Status::from(status) == Status::Ok);
      }
    }
  }
}
