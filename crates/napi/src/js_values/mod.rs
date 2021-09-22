use std::convert::TryFrom;
use std::ffi::CString;
use std::ptr;

use crate::{check_status, sys, type_of, Callback, Error, Result, Status, ValueType};

#[cfg(feature = "serde-json")]
mod de;
#[cfg(feature = "serde-json")]
mod ser;

mod arraybuffer;
#[cfg(feature = "napi6")]
mod bigint;
mod boolean;
mod buffer;
#[cfg(feature = "napi5")]
mod date;
mod either;
mod escapable_handle_scope;
mod function;
mod global;
mod number;
mod object;
mod object_property;
mod string;
mod tagged_object;
mod undefined;
mod value;
mod value_ref;

pub use arraybuffer::*;
#[cfg(feature = "napi6")]
pub use bigint::JsBigint;
pub use boolean::JsBoolean;
pub use buffer::*;
#[cfg(feature = "napi5")]
pub use date::*;
#[cfg(feature = "serde-json")]
pub(crate) use de::De;
pub use either::Either;
pub use escapable_handle_scope::EscapableHandleScope;
pub use function::JsFunction;
pub use global::*;
pub use number::JsNumber;
pub use object::*;
pub use object_property::*;
#[cfg(feature = "serde-json")]
pub(crate) use ser::Ser;
pub use string::*;
pub(crate) use tagged_object::TaggedObject;
pub use undefined::JsUndefined;
pub(crate) use value::Value;
pub use value_ref::*;

// Value types

pub struct JsUnknown(pub(crate) Value);

#[derive(Clone, Copy)]
pub struct JsNull(pub(crate) Value);

#[derive(Clone, Copy)]
pub struct JsSymbol(pub(crate) Value);

pub struct JsExternal(pub(crate) Value);

macro_rules! impl_napi_value_trait {
  ($js_value:ident, $value_type:ident) => {
    impl NapiValue for $js_value {
      unsafe fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<$js_value> {
        let value_type = type_of!(env, value)?;
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

      unsafe fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> $js_value {
        $js_value(Value {
          env,
          value,
          value_type: $value_type,
        })
      }
    }

    impl NapiRaw for $js_value {
      unsafe fn raw(&self) -> sys::napi_value {
        self.0.value
      }
    }

    impl<'env> NapiRaw for &'env $js_value {
      unsafe fn raw(&self) -> sys::napi_value {
        self.0.value
      }
    }

    impl TryFrom<JsUnknown> for $js_value {
      type Error = Error;
      fn try_from(value: JsUnknown) -> Result<$js_value> {
        unsafe { $js_value::from_raw(value.0.env, value.0.value) }
      }
    }
  };
}

macro_rules! impl_js_value_methods {
  ($js_value:ident) => {
    impl $js_value {
      pub fn into_unknown(self) -> JsUnknown {
        unsafe { JsUnknown::from_raw_unchecked(self.0.env, self.0.value) }
      }

      pub fn coerce_to_number(self) -> Result<JsNumber> {
        let mut new_raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_coerce_to_number(self.0.env, self.0.value, &mut new_raw_value)
        })?;
        Ok(JsNumber(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::Number,
        }))
      }

      pub fn coerce_to_string(self) -> Result<JsString> {
        let mut new_raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_coerce_to_string(self.0.env, self.0.value, &mut new_raw_value)
        })?;
        Ok(JsString(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::String,
        }))
      }

      pub fn coerce_to_object(self) -> Result<JsObject> {
        let mut new_raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_coerce_to_object(self.0.env, self.0.value, &mut new_raw_value)
        })?;
        Ok(JsObject(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::Object,
        }))
      }

      #[cfg(feature = "napi5")]

      pub fn is_date(&self) -> Result<bool> {
        let mut is_date = true;
        check_status!(unsafe { sys::napi_is_date(self.0.env, self.0.value, &mut is_date) })?;
        Ok(is_date)
      }

      pub fn is_promise(&self) -> Result<bool> {
        let mut is_promise = true;
        check_status!(unsafe { sys::napi_is_promise(self.0.env, self.0.value, &mut is_promise) })?;
        Ok(is_promise)
      }

      pub fn is_error(&self) -> Result<bool> {
        let mut result = false;
        check_status!(unsafe { sys::napi_is_error(self.0.env, self.0.value, &mut result) })?;
        Ok(result)
      }

      pub fn is_typedarray(&self) -> Result<bool> {
        let mut result = false;
        check_status!(unsafe { sys::napi_is_typedarray(self.0.env, self.0.value, &mut result) })?;
        Ok(result)
      }

      pub fn is_dataview(&self) -> Result<bool> {
        let mut result = false;
        check_status!(unsafe { sys::napi_is_dataview(self.0.env, self.0.value, &mut result) })?;
        Ok(result)
      }

      pub fn is_array(&self) -> Result<bool> {
        let mut is_array = false;
        check_status!(unsafe { sys::napi_is_array(self.0.env, self.0.value, &mut is_array) })?;
        Ok(is_array)
      }

      pub fn is_buffer(&self) -> Result<bool> {
        let mut is_buffer = false;
        check_status!(unsafe { sys::napi_is_buffer(self.0.env, self.0.value, &mut is_buffer) })?;
        Ok(is_buffer)
      }

      pub fn instanceof<Constructor>(&self, constructor: Constructor) -> Result<bool>
      where
        Constructor: NapiRaw,
      {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_instanceof(self.0.env, self.0.value, constructor.raw(), &mut result)
        })?;
        Ok(result)
      }

      #[cfg(feature = "napi8")]
      pub fn freeze(&mut self) -> Result<()> {
        check_status!(unsafe { sys::napi_object_freeze(self.0.env, self.0.value) })
      }

      #[cfg(feature = "napi8")]
      pub fn seal(&mut self) -> Result<()> {
        check_status!(unsafe { sys::napi_object_seal(self.0.env, self.0.value) })
      }
    }
  };
}

macro_rules! impl_object_methods {
  ($js_value:ident) => {
    impl $js_value {
      pub fn set_property<V>(&mut self, key: JsString, value: V) -> Result<()>
      where
        V: NapiRaw,
      {
        check_status!(unsafe {
          sys::napi_set_property(self.0.env, self.0.value, key.0.value, value.raw())
        })
      }

      pub fn get_property<K, T>(&self, key: K) -> Result<T>
      where
        K: NapiRaw,
        T: NapiValue,
      {
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_property(self.0.env, self.0.value, key.raw(), &mut raw_value)
        })?;
        unsafe { T::from_raw(self.0.env, raw_value) }
      }

      pub fn get_property_unchecked<K, T>(&self, key: K) -> Result<T>
      where
        K: NapiRaw,
        T: NapiValue,
      {
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_property(self.0.env, self.0.value, key.raw(), &mut raw_value)
        })?;
        Ok(unsafe { T::from_raw_unchecked(self.0.env, raw_value) })
      }

      pub fn set_named_property<T>(&mut self, name: &str, value: T) -> Result<()>
      where
        T: NapiRaw,
      {
        let key = CString::new(name)?;
        check_status!(unsafe {
          sys::napi_set_named_property(self.0.env, self.0.value, key.as_ptr(), value.raw())
        })
      }

      pub fn create_named_method(&mut self, name: &str, function: Callback) -> Result<()> {
        let mut js_function = ptr::null_mut();
        let len = name.len();
        let name = CString::new(name.as_bytes())?;
        check_status!(unsafe {
          sys::napi_create_function(
            self.0.env,
            name.as_ptr(),
            len,
            Some(function),
            ptr::null_mut(),
            &mut js_function,
          )
        })?;
        check_status!(unsafe {
          sys::napi_set_named_property(self.0.env, self.0.value, name.as_ptr(), js_function)
        })
      }

      pub fn get_named_property<T>(&self, name: &str) -> Result<T>
      where
        T: NapiValue,
      {
        let key = CString::new(name)?;
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_named_property(self.0.env, self.0.value, key.as_ptr(), &mut raw_value)
        })?;
        unsafe { T::from_raw(self.0.env, raw_value) }
      }

      pub fn get_named_property_unchecked<T>(&self, name: &str) -> Result<T>
      where
        T: NapiValue,
      {
        let key = CString::new(name)?;
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_named_property(self.0.env, self.0.value, key.as_ptr(), &mut raw_value)
        })?;
        Ok(unsafe { T::from_raw_unchecked(self.0.env, raw_value) })
      }

      pub fn has_named_property(&self, name: &str) -> Result<bool> {
        let mut result = false;
        let key = CString::new(name)?;
        check_status!(unsafe {
          sys::napi_has_named_property(self.0.env, self.0.value, key.as_ptr(), &mut result)
        })?;
        Ok(result)
      }

      pub fn delete_property<S>(&mut self, name: S) -> Result<bool>
      where
        S: NapiRaw,
      {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_delete_property(self.0.env, self.0.value, name.raw(), &mut result)
        })?;
        Ok(result)
      }

      pub fn delete_named_property(&mut self, name: &str) -> Result<bool> {
        let mut result = false;
        let key_str = CString::new(name)?;
        let mut js_key = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_create_string_utf8(self.0.env, key_str.as_ptr(), name.len(), &mut js_key)
        })?;
        check_status!(unsafe {
          sys::napi_delete_property(self.0.env, self.0.value, js_key, &mut result)
        })?;
        Ok(result)
      }

      pub fn has_own_property(&self, key: &str) -> Result<bool> {
        let mut result = false;
        let string = CString::new(key)?;
        let mut js_key = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_create_string_utf8(self.0.env, string.as_ptr(), key.len(), &mut js_key)
        })?;
        check_status!(unsafe {
          sys::napi_has_own_property(self.0.env, self.0.value, js_key, &mut result)
        })?;
        Ok(result)
      }

      pub fn has_own_property_js<K>(&self, key: K) -> Result<bool>
      where
        K: NapiRaw,
      {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_has_own_property(self.0.env, self.0.value, key.raw(), &mut result)
        })?;
        Ok(result)
      }

      pub fn has_property(&self, name: &str) -> Result<bool> {
        let string = CString::new(name)?;
        let mut js_key = ptr::null_mut();
        let mut result = false;
        check_status!(unsafe {
          sys::napi_create_string_utf8(self.0.env, string.as_ptr(), name.len(), &mut js_key)
        })?;
        check_status!(unsafe {
          sys::napi_has_property(self.0.env, self.0.value, js_key, &mut result)
        })?;
        Ok(result)
      }

      pub fn has_property_js<K>(&self, name: K) -> Result<bool>
      where
        K: NapiRaw,
      {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_has_property(self.0.env, self.0.value, name.raw(), &mut result)
        })?;
        Ok(result)
      }

      pub fn get_property_names(&self) -> Result<JsObject> {
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_property_names(self.0.env, self.0.value, &mut raw_value)
        })?;
        Ok(unsafe { JsObject::from_raw_unchecked(self.0.env, raw_value) })
      }

      /// https://nodejs.org/api/n-api.html#n_api_napi_get_all_property_names
      /// return `Array` of property names
      #[cfg(feature = "napi6")]
      pub fn get_all_property_names(
        &self,
        mode: KeyCollectionMode,
        filter: KeyFilter,
        conversion: KeyConversion,
      ) -> Result<JsObject> {
        let mut properties_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_all_property_names(
            self.0.env,
            self.0.value,
            mode.into(),
            filter.into(),
            conversion.into(),
            &mut properties_value,
          )
        })?;
        Ok(unsafe { JsObject::from_raw_unchecked(self.0.env, properties_value) })
      }

      /// This returns the equivalent of `Object.getPrototypeOf` (which is not the same as the function's prototype property).
      pub fn get_prototype<T>(&self) -> Result<T>
      where
        T: NapiValue,
      {
        let mut result = ptr::null_mut();
        check_status!(unsafe { sys::napi_get_prototype(self.0.env, self.0.value, &mut result) })?;
        unsafe { T::from_raw(self.0.env, result) }
      }

      pub fn get_prototype_unchecked<T>(&self) -> Result<T>
      where
        T: NapiValue,
      {
        let mut result = ptr::null_mut();
        check_status!(unsafe { sys::napi_get_prototype(self.0.env, self.0.value, &mut result) })?;
        Ok(unsafe { T::from_raw_unchecked(self.0.env, result) })
      }

      pub fn set_element<T>(&mut self, index: u32, value: T) -> Result<()>
      where
        T: NapiRaw,
      {
        check_status!(unsafe {
          sys::napi_set_element(self.0.env, self.0.value, index, value.raw())
        })
      }

      pub fn has_element(&self, index: u32) -> Result<bool> {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_has_element(self.0.env, self.0.value, index, &mut result)
        })?;
        Ok(result)
      }

      pub fn delete_element(&mut self, index: u32) -> Result<bool> {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_delete_element(self.0.env, self.0.value, index, &mut result)
        })?;
        Ok(result)
      }

      pub fn get_element<T>(&self, index: u32) -> Result<T>
      where
        T: NapiValue,
      {
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_element(self.0.env, self.0.value, index, &mut raw_value)
        })?;
        unsafe { T::from_raw(self.0.env, raw_value) }
      }

      pub fn get_element_unchecked<T>(&self, index: u32) -> Result<T>
      where
        T: NapiValue,
      {
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_element(self.0.env, self.0.value, index, &mut raw_value)
        })?;
        Ok(unsafe { T::from_raw_unchecked(self.0.env, raw_value) })
      }

      /// This method allows the efficient definition of multiple properties on a given object.
      pub fn define_properties(&mut self, properties: &[Property]) -> Result<()> {
        check_status!(unsafe {
          sys::napi_define_properties(
            self.0.env,
            self.0.value,
            properties.len(),
            properties
              .iter()
              .map(|property| property.raw())
              .collect::<Vec<sys::napi_property_descriptor>>()
              .as_ptr(),
          )
        })
      }

      /// Perform `is_array` check before get the length
      /// if `Object` is not array, `ArrayExpected` error returned
      pub fn get_array_length(&self) -> Result<u32> {
        if self.is_array()? != true {
          return Err(Error::new(
            Status::ArrayExpected,
            "Object is not array".to_owned(),
          ));
        }
        self.get_array_length_unchecked()
      }

      /// use this API if you can ensure this `Object` is `Array`
      pub fn get_array_length_unchecked(&self) -> Result<u32> {
        let mut length: u32 = 0;
        check_status!(unsafe {
          sys::napi_get_array_length(self.0.env, self.0.value, &mut length)
        })?;
        Ok(length)
      }
    }
  };
}

pub trait NapiRaw {
  #[allow(clippy::missing_safety_doc)]
  unsafe fn raw(&self) -> sys::napi_value;
}

pub trait NapiValue: Sized + NapiRaw {
  #[allow(clippy::missing_safety_doc)]
  unsafe fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self>;

  #[allow(clippy::missing_safety_doc)]
  unsafe fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self;
}

impl_js_value_methods!(JsUnknown);
impl_js_value_methods!(JsUndefined);
impl_js_value_methods!(JsNull);
impl_js_value_methods!(JsBoolean);
impl_js_value_methods!(JsBuffer);
impl_js_value_methods!(JsArrayBuffer);
impl_js_value_methods!(JsTypedArray);
impl_js_value_methods!(JsDataView);
impl_js_value_methods!(JsNumber);
impl_js_value_methods!(JsString);
impl_js_value_methods!(JsObject);
impl_js_value_methods!(JsGlobal);
#[cfg(feature = "napi5")]
impl_js_value_methods!(JsDate);
impl_js_value_methods!(JsFunction);
impl_js_value_methods!(JsExternal);
impl_js_value_methods!(JsSymbol);
impl_js_value_methods!(JsTimeout);

impl_object_methods!(JsObject);
impl_object_methods!(JsBuffer);
impl_object_methods!(JsArrayBuffer);
impl_object_methods!(JsTypedArray);
impl_object_methods!(JsDataView);
impl_object_methods!(JsGlobal);

use ValueType::*;

impl_napi_value_trait!(JsUndefined, Undefined);
impl_napi_value_trait!(JsNull, Null);
impl_napi_value_trait!(JsBoolean, Boolean);
impl_napi_value_trait!(JsBuffer, Object);
impl_napi_value_trait!(JsArrayBuffer, Object);
impl_napi_value_trait!(JsTypedArray, Object);
impl_napi_value_trait!(JsDataView, Object);
impl_napi_value_trait!(JsNumber, Number);
impl_napi_value_trait!(JsString, String);
impl_napi_value_trait!(JsObject, Object);
impl_napi_value_trait!(JsGlobal, Object);
#[cfg(feature = "napi5")]
impl_napi_value_trait!(JsDate, Object);
impl_napi_value_trait!(JsTimeout, Object);
impl_napi_value_trait!(JsFunction, Function);
impl_napi_value_trait!(JsExternal, External);
impl_napi_value_trait!(JsSymbol, Symbol);

impl NapiValue for JsUnknown {
  unsafe fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    Ok(JsUnknown(Value {
      env,
      value,
      value_type: Unknown,
    }))
  }

  unsafe fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self {
    JsUnknown(Value {
      env,
      value,
      value_type: Unknown,
    })
  }
}

impl NapiRaw for JsUnknown {
  /// get raw js value ptr
  unsafe fn raw(&self) -> sys::napi_value {
    self.0.value
  }
}

impl<'env> NapiRaw for &'env JsUnknown {
  /// get raw js value ptr
  unsafe fn raw(&self) -> sys::napi_value {
    self.0.value
  }
}

impl JsUnknown {
  pub fn get_type(&self) -> Result<ValueType> {
    unsafe { type_of!(self.0.env, self.0.value) }
  }

  /// # Safety
  ///
  /// This function should be called after `JsUnknown::get_type`
  ///
  /// And the `V` must be match with the return value of `get_type`
  pub unsafe fn cast<V>(&self) -> V
  where
    V: NapiValue,
  {
    V::from_raw_unchecked(self.0.env, self.0.value)
  }
}
