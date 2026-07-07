use std::{marker::PhantomData, ptr};

use crate::{
  bindgen_prelude::{
    sys, External, ExternalRef, FromNapiValue, Result, TypeName, ValidateNapiValue,
  },
  check_status, JsValue, Value, ValueType,
};

/// Represent the Node-API `External` value
///
/// The difference between the `JsExternal` and `External` is that the `JsExternal` holds the raw value of `External`.
/// So that you can call `Object::set_property` with the `JsExternal` value, but can't do the same with `External`.
pub struct JsExternal<'env>(pub(crate) Value, PhantomData<&'env ()>);

impl<'env> TypeName for JsExternal<'env> {
  fn type_name() -> &'static str {
    "External"
  }

  fn value_type() -> ValueType {
    ValueType::External
  }
}

impl<'env> ValidateNapiValue for JsExternal<'env> {}

impl<'env> FromNapiValue for JsExternal<'env> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Self(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::External,
      },
      PhantomData,
    ))
  }
}

impl<'env> JsValue<'env> for JsExternal<'env> {
  fn value(&self) -> Value {
    self.0
  }
}

impl<'env> JsExternal<'env> {
  /// Get the value from the `JsExternal`
  ///
  /// If the underlying value is not `T`, it will return `InvalidArg` error.
  pub fn get_value<T: 'static>(&self) -> Result<&T> {
    self.get_static_value::<T>().map(|ext| ext.as_ref())
  }

  /// Mutably get the value from the `JsExternal`.
  ///
  /// # Safety
  ///
  /// The caller must guarantee that no other reference to the same external value exists for the
  /// returned reference's lifetime.
  pub unsafe fn get_value_mut<T: 'static>(&mut self) -> Result<&mut T> {
    let mut unknown_tagged_object = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_value_external(self.0.env, self.0.value, &mut unknown_tagged_object) },
      "Failed to get external value"
    )?;
    unsafe { External::inner_from_napi_value_mut(self.0.env, self.0.value, unknown_tagged_object) }
  }

  /// Create a reference to the `JsExternal`
  ///
  /// If the underlying value is not `T`, it will return `InvalidArg` error.
  pub fn create_ref<T: 'static>(&self) -> Result<ExternalRef<T>> {
    unsafe { ExternalRef::from_napi_value(self.0.env, self.0.value) }
  }

  #[inline]
  fn get_static_value<T: 'static>(&self) -> Result<&'static External<T>> {
    let mut unknown_tagged_object = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_value_external(self.0.env, self.0.value, &mut unknown_tagged_object) },
      "Failed to get external value"
    )?;

    unsafe { External::from_napi_value_impl(self.0.env, self.0.value, unknown_tagged_object) }
  }
}
