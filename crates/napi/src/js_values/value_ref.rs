use std::{marker::PhantomData, ptr};

use super::{check_status, NapiRaw};
use crate::{
  bindgen_runtime::{FromNapiMutRef, FromNapiValue, ToNapiValue},
  sys, Env, Result,
};

pub struct Ref<T> {
  pub(crate) raw_ref: sys::napi_ref,
  pub(crate) _phantom: PhantomData<T>,
}

#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl<T> Send for Ref<T> {}
unsafe impl<T> Sync for Ref<T> {}

impl<T: NapiRaw> Ref<T> {
  pub fn new(env: &Env, value: &T) -> Result<Ref<T>> {
    let mut raw_ref = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_reference(env.0, value.raw(), 1, &mut raw_ref) })?;
    Ok(Ref {
      raw_ref,
      _phantom: PhantomData,
    })
  }

  pub fn unref(self, env: Env) -> Result<()> {
    check_status!(unsafe { sys::napi_reference_unref(env.0, self.raw_ref, &mut 0) })?;

    check_status!(unsafe { sys::napi_delete_reference(env.0, self.raw_ref) })?;
    Ok(())
  }
}

impl<T: FromNapiValue> Ref<T> {
  /// Get the value from the reference
  pub fn get_value(&self, env: Env) -> Result<T> {
    let mut result = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_reference_value(env.0, self.raw_ref, &mut result) })?;
    unsafe { T::from_napi_value(env.0, result) }
  }
}

impl<T: 'static + FromNapiMutRef> Ref<T> {
  /// Get the value reference from the reference
  pub fn get_value_mut(&self, env: Env) -> Result<&mut T> {
    let mut result = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_reference_value(env.0, self.raw_ref, &mut result) })?;
    unsafe { T::from_napi_mut_ref(env.0, result) }
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
