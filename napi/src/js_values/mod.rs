use std::convert::From;
use std::ptr;

use crate::error::check_status;
use crate::{sys, Error, Result, Status};

mod arraybuffer;
mod boolean;
mod buffer;
mod class_property;
mod either;
mod function;
mod number;
mod object;
mod string;
mod tagged_object;
mod undefined;
mod value;
mod value_ref;
mod value_type;

pub use arraybuffer::JsArrayBuffer;
pub use boolean::JsBoolean;
pub use buffer::JsBuffer;
pub use class_property::Property;
pub use either::Either;
pub use function::JsFunction;
pub use number::JsNumber;
pub use object::JsObject;
pub use string::JsString;
pub(crate) use tagged_object::TaggedObject;
pub use undefined::JsUndefined;
pub(crate) use value::Value;
pub(crate) use value_ref::Ref;
pub use value_type::ValueType;

// Value types
#[derive(Clone, Copy, Debug)]
pub struct JsUnknown(pub(crate) Value);

#[derive(Clone, Copy, Debug)]
pub struct JsNull(pub(crate) Value);

#[cfg(napi6)]
#[derive(Clone, Copy, Debug)]
pub struct JsBigint(pub(crate) Value);

#[derive(Clone, Copy, Debug)]
pub struct JsSymbol(pub(crate) Value);

#[derive(Clone, Copy, Debug)]
pub struct JsExternal(pub(crate) Value);

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
    impl NapiValue for $js_value {
      fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<$js_value> {
        let value_type = type_of(env, value)?;
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
    }

    impl $js_value {
      #[inline]
      pub fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self {
        Self(Value {
          env,
          value,
          value_type: $value_type,
        })
      }
    }
  };
}

macro_rules! impl_js_value_methods {
  ($js_value:ident) => {
    impl $js_value {
      #[inline]
      pub fn into_unknown(self) -> Result<JsUnknown> {
        JsUnknown::from_raw(self.0.env, self.0.value)
      }

      #[inline]
      pub fn coerce_to_number(self) -> Result<JsNumber> {
        let mut new_raw_value = ptr::null_mut();
        let status =
          unsafe { sys::napi_coerce_to_number(self.0.env, self.0.value, &mut new_raw_value) };
        check_status(status)?;
        Ok(JsNumber(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::Number,
        }))
      }
      #[inline]
      pub fn coerce_to_string(self) -> Result<JsString> {
        let mut new_raw_value = ptr::null_mut();
        let status =
          unsafe { sys::napi_coerce_to_string(self.0.env, self.0.value, &mut new_raw_value) };
        check_status(status)?;
        Ok(JsString(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::String,
        }))
      }
      #[inline]
      pub fn coerce_to_object(self) -> Result<JsObject> {
        let mut new_raw_value = ptr::null_mut();
        let status =
          unsafe { sys::napi_coerce_to_object(self.0.env, self.0.value, &mut new_raw_value) };
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
        let status = unsafe { sys::napi_is_date(self.0.env, self.0.value, &mut is_date) };
        check_status(status)?;
        Ok(is_date)
      }
    }
  };
}

pub trait NapiValue: Sized {
  fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self>;

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
#[cfg(napi6)]
impl_js_value_methods!(JsBigint);
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
#[cfg(napi6)]
impl_napi_value_trait!(JsBigint, Bigint);
impl_napi_value_trait!(JsSymbol, Symbol);

impl NapiValue for JsUnknown {
  fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    Ok(JsUnknown(Value {
      env,
      value,
      value_type: Unknown,
    }))
  }

  fn raw_value(&self) -> sys::napi_value {
    self.0.value
  }
}

impl JsUnknown {
  #[inline]
  pub fn get_type(&self) -> Result<ValueType> {
    type_of(self.0.env, self.0.value)
  }
}
