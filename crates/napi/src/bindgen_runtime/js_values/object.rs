#[cfg(feature = "napi6")]
use std::convert::TryFrom;
use std::marker::PhantomData;
use std::ptr;

#[cfg(feature = "napi5")]
use crate::Env;
use crate::{
  bindgen_prelude::*, check_status, sys, type_of, JsObjectValue, JsValue, Value, ValueType,
};

#[derive(Clone, Copy)]
pub struct Object<'env>(pub(crate) Value, pub(crate) PhantomData<&'env ()>);

impl<'env> JsValue<'env> for Object<'env> {
  fn value(&self) -> Value {
    self.0
  }
}

impl<'env> JsObjectValue<'env> for Object<'env> {}

impl TypeName for Object<'_> {
  fn type_name() -> &'static str {
    "Object"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl ValidateNapiValue for Object<'_> {}

impl FromNapiValue for Object<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Self(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::Object,
      },
      PhantomData,
    ))
  }
}

impl ToNapiValue for &Object<'_> {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(val.0.value)
  }
}

impl Object<'_> {
  pub(crate) fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Self {
    Self(
      Value {
        env,
        value,
        value_type: ValueType::Object,
      },
      PhantomData,
    )
  }

  pub fn new(env: &Env) -> Result<Self> {
    let mut ptr = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_create_object(env.0, &mut ptr),
        "Failed to create napi Object"
      )?;
    }

    Ok(Self(
      crate::Value {
        env: env.0,
        value: ptr,
        value_type: ValueType::Object,
      },
      PhantomData,
    ))
  }

  pub fn get<V: FromNapiValue>(&self, field: &str) -> Result<Option<V>> {
    unsafe {
      self
        .get_inner(field)?
        .map(|v| V::from_napi_value(self.0.env, v))
        .transpose()
    }
  }

  fn get_inner(&self, field: &str) -> Result<Option<sys::napi_value>> {
    unsafe {
      let mut property_key = std::ptr::null_mut();
      check_status!(
        sys::napi_create_string_utf8(
          self.0.env,
          field.as_ptr().cast(),
          field.len() as isize,
          &mut property_key,
        ),
        "Failed to create property key with `{field}`"
      )?;

      let mut ret = ptr::null_mut();

      check_status!(
        sys::napi_get_property(self.0.env, self.0.value, property_key, &mut ret),
        "Failed to get property with field `{field}`",
      )?;

      let ty = type_of!(self.0.env, ret)?;

      Ok(if ty == ValueType::Undefined {
        None
      } else {
        Some(ret)
      })
    }
  }

  pub fn set<K: AsRef<str>, V: ToNapiValue>(&mut self, field: K, val: V) -> Result<()> {
    unsafe { self.set_inner(field.as_ref(), V::to_napi_value(self.0.env, val)?) }
  }

  unsafe fn set_inner(&mut self, field: &str, napi_val: sys::napi_value) -> Result<()> {
    let mut property_key = std::ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_string_utf8(
          self.0.env,
          field.as_ptr().cast(),
          field.len() as isize,
          &mut property_key,
        )
      },
      "Failed to create property key with `{field}`"
    )?;

    check_status!(
      unsafe { sys::napi_set_property(self.0.env, self.0.value, property_key, napi_val) },
      "Failed to set property with field `{field}`"
    )?;
    Ok(())
  }

  pub fn keys(obj: &Object) -> Result<Vec<String>> {
    let mut names = ptr::null_mut();
    unsafe {
      check_status!(
        sys::napi_get_property_names(obj.0.env, obj.0.value, &mut names),
        "Failed to get property names of given object"
      )?;
    }

    let names = unsafe { Array::from_napi_value(obj.0.env, names)? };
    let mut ret = vec![];

    for i in 0..names.len() {
      ret.push(names.get::<String>(i)?.unwrap());
    }

    Ok(ret)
  }
}

#[cfg(feature = "napi5")]
pub struct FinalizeContext<T: 'static, Hint: 'static> {
  pub env: Env,
  pub value: T,
  pub hint: Hint,
}

#[cfg(feature = "napi6")]
pub enum KeyCollectionMode {
  IncludePrototypes,
  OwnOnly,
}

#[cfg(feature = "napi6")]
impl TryFrom<sys::napi_key_collection_mode> for KeyCollectionMode {
  type Error = Error;

  fn try_from(value: sys::napi_key_collection_mode) -> Result<Self> {
    match value {
      sys::KeyCollectionMode::include_prototypes => Ok(Self::IncludePrototypes),
      sys::KeyCollectionMode::own_only => Ok(Self::OwnOnly),
      _ => Err(Error::new(
        crate::Status::InvalidArg,
        format!("Invalid key collection mode: {}", value),
      )),
    }
  }
}

#[cfg(feature = "napi6")]
impl From<KeyCollectionMode> for sys::napi_key_collection_mode {
  fn from(value: KeyCollectionMode) -> Self {
    match value {
      KeyCollectionMode::IncludePrototypes => sys::KeyCollectionMode::include_prototypes,
      KeyCollectionMode::OwnOnly => sys::KeyCollectionMode::own_only,
    }
  }
}

#[cfg(feature = "napi6")]
pub enum KeyFilter {
  AllProperties,
  Writable,
  Enumerable,
  Configurable,
  SkipStrings,
  SkipSymbols,
}

#[cfg(feature = "napi6")]
impl TryFrom<sys::napi_key_filter> for KeyFilter {
  type Error = Error;

  fn try_from(value: sys::napi_key_filter) -> Result<Self> {
    match value {
      sys::KeyFilter::all_properties => Ok(Self::AllProperties),
      sys::KeyFilter::writable => Ok(Self::Writable),
      sys::KeyFilter::enumerable => Ok(Self::Enumerable),
      sys::KeyFilter::configurable => Ok(Self::Configurable),
      sys::KeyFilter::skip_strings => Ok(Self::SkipStrings),
      sys::KeyFilter::skip_symbols => Ok(Self::SkipSymbols),
      _ => Err(Error::new(
        crate::Status::InvalidArg,
        format!("Invalid key filter [{}]", value),
      )),
    }
  }
}

#[cfg(feature = "napi6")]
impl From<KeyFilter> for sys::napi_key_filter {
  fn from(value: KeyFilter) -> Self {
    match value {
      KeyFilter::AllProperties => sys::KeyFilter::all_properties,
      KeyFilter::Writable => sys::KeyFilter::writable,
      KeyFilter::Enumerable => sys::KeyFilter::enumerable,
      KeyFilter::Configurable => sys::KeyFilter::configurable,
      KeyFilter::SkipStrings => sys::KeyFilter::skip_strings,
      KeyFilter::SkipSymbols => sys::KeyFilter::skip_symbols,
    }
  }
}

#[cfg(feature = "napi6")]
pub enum KeyConversion {
  KeepNumbers,
  NumbersToStrings,
}

#[cfg(feature = "napi6")]
impl TryFrom<sys::napi_key_conversion> for KeyConversion {
  type Error = Error;

  fn try_from(value: sys::napi_key_conversion) -> Result<Self> {
    match value {
      sys::KeyConversion::keep_numbers => Ok(Self::KeepNumbers),
      sys::KeyConversion::numbers_to_strings => Ok(Self::NumbersToStrings),
      _ => Err(Error::new(
        crate::Status::InvalidArg,
        format!("Invalid key conversion [{}]", value),
      )),
    }
  }
}

#[cfg(feature = "napi6")]
impl From<KeyConversion> for sys::napi_key_conversion {
  fn from(value: KeyConversion) -> Self {
    match value {
      KeyConversion::KeepNumbers => sys::KeyConversion::keep_numbers,
      KeyConversion::NumbersToStrings => sys::KeyConversion::numbers_to_strings,
    }
  }
}
