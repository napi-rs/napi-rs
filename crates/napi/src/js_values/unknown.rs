use std::ptr;

use crate::{
  bindgen_runtime::{FromNapiValue, TypeName, ValidateNapiValue},
  sys, type_of, JsValue, Result, Value, ValueType,
};

#[derive(Clone, Copy)]
/// Represents a raw JavaScript value
pub struct Unknown<'env>(
  pub(crate) Value,
  pub(crate) std::marker::PhantomData<&'env ()>,
);

impl<'env> JsValue<'env> for Unknown<'env> {
  fn value(&self) -> Value {
    self.0
  }
}

impl TypeName for Unknown<'_> {
  fn type_name() -> &'static str {
    "unknown"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl ValidateNapiValue for Unknown<'_> {
  unsafe fn validate(
    _env: napi_sys::napi_env,
    _napi_val: napi_sys::napi_value,
  ) -> Result<sys::napi_value> {
    Ok(ptr::null_mut())
  }
}

impl FromNapiValue for Unknown<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Unknown(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::Unknown,
      },
      std::marker::PhantomData,
    ))
  }
}

impl Unknown<'_> {
  pub fn get_type(&self) -> Result<ValueType> {
    type_of!(self.0.env, self.0.value)
  }

  /// # Safety
  ///
  /// This function should be called after `JsUnknown::get_type`
  ///
  /// And the `V` must be match with the return value of `get_type`
  pub unsafe fn cast<V>(&self) -> Result<V>
  where
    V: FromNapiValue,
  {
    unsafe { V::from_napi_value(self.0.env, self.0.value) }
  }

  /// # Safety
  ///
  /// JsUnknown doesn't have a type
  pub unsafe fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self {
    Unknown(
      Value {
        env,
        value,
        value_type: ValueType::Unknown,
      },
      std::marker::PhantomData,
    )
  }
}
