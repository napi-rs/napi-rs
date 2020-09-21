use std::convert::{From, TryFrom};
use std::ptr;

use crate::error::check_status;
use crate::{sys, Env, Error, Result, Status};

#[cfg(feature = "serde-json")]
mod de;
#[cfg(feature = "serde-json")]
mod ser;

#[cfg(napi6)]
mod bigint;
mod boolean;
mod buffer;
mod function;
mod number;
mod object;
mod object_property;
mod string;
mod tagged_object;
mod undefined;
mod value;
mod value_ref;
mod value_type;

#[cfg(napi6)]
pub use bigint::JsBigint;
pub use boolean::JsBoolean;
pub use buffer::JsBuffer;
#[cfg(feature = "serde-json")]
pub(crate) use de::De;
pub use function::JsFunction;
pub use number::JsNumber;
pub use object::JsObject;
pub use object_property::Property;
#[cfg(feature = "serde-json")]
pub(crate) use ser::Ser;
pub use string::JsString;
pub(crate) use tagged_object::TaggedObject;
pub use undefined::JsUndefined;
pub(crate) use value::Value;
pub(crate) use value_ref::Ref;
pub use value_type::ValueType;

// Value types
#[derive(Debug)]
pub struct JsUnknown<'env>(pub(crate) Value<'env>);

#[derive(Debug)]
pub struct JsNull<'env>(pub(crate) Value<'env>);

#[derive(Debug)]
pub struct JsSymbol<'env>(pub(crate) Value<'env>);

#[derive(Debug)]
pub struct JsExternal<'env>(pub(crate) Value<'env>);

#[inline]
pub(crate) fn type_of(env: sys::napi_env, raw_value: sys::napi_value) -> Result<ValueType> {
  unsafe {
    let mut value_type = sys::napi_valuetype::napi_undefined;
    check_status(sys::napi_typeof(env, raw_value, &mut value_type))?;
    Ok(ValueType::from(value_type))
  }
}

macro_rules! impl_napi_value_trait {
  ($js_value:ident, $value_type:ident) => {
    impl<'env> NapiValue<'env> for $js_value<'env> {
      fn from_raw(env: &'env Env, value: sys::napi_value) -> Result<$js_value<'env>> {
        let value_type = type_of(env.0, value)?;
        if value_type != $value_type {
          Err(Error::new(
            Status::InvalidArg,
            format!("expect {:?}, got: {:?}", $value_type, value_type),
          ))
        } else {
          Ok($js_value(Value {
            env,
            value,
            value_type: $value_type,
          }))
        }
      }

      fn raw_value(&self) -> sys::napi_value {
        self.0.value
      }

      fn from_raw_unchecked(env: &'env Env, value: sys::napi_value) -> $js_value {
        $js_value(Value {
          env,
          value,
          value_type: $value_type,
        })
      }
    }

    impl<'env> TryFrom<JsUnknown<'env>> for $js_value<'env> {
      type Error = Error;
      fn try_from(value: JsUnknown<'env>) -> Result<$js_value<'env>> {
        $js_value::from_raw(value.0.env, value.0.value)
      }
    }
  };
}

macro_rules! impl_js_value_methods {
  ($js_value:ident) => {
    impl<'env> $js_value<'env> {
      #[inline]
      pub fn into_unknown(self) -> Result<JsUnknown<'env>> {
        JsUnknown::from_raw(self.0.env, self.0.value)
      }

      #[inline]
      pub fn coerce_to_number(self) -> Result<JsNumber<'env>> {
        let mut new_raw_value = ptr::null_mut();
        let status =
          unsafe { sys::napi_coerce_to_number(self.0.env.0, self.0.value, &mut new_raw_value) };
        check_status(status)?;
        Ok(JsNumber(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::Number,
        }))
      }
      #[inline]
      pub fn coerce_to_string(self) -> Result<JsString<'env>> {
        let mut new_raw_value = ptr::null_mut();
        let status =
          unsafe { sys::napi_coerce_to_string(self.0.env.0, self.0.value, &mut new_raw_value) };
        check_status(status)?;
        Ok(JsString(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::String,
        }))
      }

      #[inline]
      pub fn coerce_to_object(self) -> Result<JsObject<'env>> {
        let mut new_raw_value = ptr::null_mut();
        let status =
          unsafe { sys::napi_coerce_to_object(self.0.env.0, self.0.value, &mut new_raw_value) };
        check_status(status)?;
        Ok(JsObject(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::Object,
        }))
      }

      #[inline]
      #[cfg(napi5)]
      pub fn is_date(&self) -> Result<bool> {
        let mut is_date = true;
        let status = unsafe { sys::napi_is_date(self.0.env.0, self.0.value, &mut is_date) };
        check_status(status)?;
        Ok(is_date)
      }

      #[inline]
      pub fn is_error(&self) -> Result<bool> {
        let mut result = false;
        check_status(unsafe { sys::napi_is_error(self.0.env.0, self.0.value, &mut result) })?;
        Ok(result)
      }

      #[inline]
      pub fn is_typedarray(&self) -> Result<bool> {
        let mut result = false;
        check_status(unsafe { sys::napi_is_typedarray(self.0.env.0, self.0.value, &mut result) })?;
        Ok(result)
      }

      #[inline]
      pub fn is_dataview(&self) -> Result<bool> {
        let mut result = false;
        check_status(unsafe { sys::napi_is_dataview(self.0.env.0, self.0.value, &mut result) })?;
        Ok(result)
      }

      #[inline]
      pub fn is_array(&self) -> Result<bool> {
        let mut is_array = false;
        check_status(unsafe { sys::napi_is_array(self.0.env.0, self.0.value, &mut is_array) })?;
        Ok(is_array)
      }

      #[inline]
      pub fn is_buffer(&self) -> Result<bool> {
        let mut is_buffer = false;
        check_status(unsafe { sys::napi_is_buffer(self.0.env.0, self.0.value, &mut is_buffer) })?;
        Ok(is_buffer)
      }

      #[inline]
      pub fn instanceof<Constructor: NapiValue<'env>>(
        &self,
        constructor: Constructor,
      ) -> Result<bool> {
        let mut result = false;
        check_status(unsafe {
          sys::napi_instanceof(
            self.0.env.0,
            self.0.value,
            constructor.raw_value(),
            &mut result,
          )
        })?;
        Ok(result)
      }
    }
  };
}

pub trait NapiValue<'env>: Sized {
  fn from_raw(env: &'env Env, value: sys::napi_value) -> Result<Self>;

  fn from_raw_unchecked(env: &'env Env, value: sys::napi_value) -> Self;

  fn raw_value(&self) -> sys::napi_value;
}

impl_js_value_methods!(JsUnknown);
impl_js_value_methods!(JsUndefined);
impl_js_value_methods!(JsNull);
impl_js_value_methods!(JsBoolean);
impl_js_value_methods!(JsNumber);
impl_js_value_methods!(JsString);
impl_js_value_methods!(JsObject);
impl_js_value_methods!(JsFunction);
impl_js_value_methods!(JsExternal);
impl_js_value_methods!(JsSymbol);

use ValueType::*;

impl_napi_value_trait!(JsUndefined, Undefined);
impl_napi_value_trait!(JsNull, Null);
impl_napi_value_trait!(JsBoolean, Boolean);
impl_napi_value_trait!(JsNumber, Number);
impl_napi_value_trait!(JsString, String);
impl_napi_value_trait!(JsObject, Object);
impl_napi_value_trait!(JsFunction, Function);
impl_napi_value_trait!(JsExternal, External);
impl_napi_value_trait!(JsSymbol, Symbol);

impl<'env> NapiValue<'env> for JsUnknown<'env> {
  fn from_raw(env: &'env Env, value: sys::napi_value) -> Result<Self> {
    Ok(JsUnknown(Value {
      env,
      value,
      value_type: Unknown,
    }))
  }

  fn from_raw_unchecked(env: &'env Env, value: sys::napi_value) -> Self {
    JsUnknown(Value {
      env,
      value,
      value_type: Unknown,
    })
  }

  fn raw_value(&self) -> sys::napi_value {
    self.0.value
  }
}

impl<'env> JsUnknown<'env> {
  #[inline]
  pub fn get_type(&self) -> Result<ValueType> {
    type_of(self.0.env.0, self.0.value)
  }
}
