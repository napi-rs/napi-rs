#![allow(deprecated)]

use std::any::{type_name, TypeId};
#[cfg(feature = "compat-mode")]
use std::convert::TryFrom;
use std::ffi::c_void;
use std::ffi::CString;
use std::marker::PhantomData;
use std::ptr;

#[cfg(feature = "napi5")]
use crate::bindgen_runtime::FinalizeContext;
#[cfg(feature = "compat-mode")]
use crate::type_of;
use crate::{
  bindgen_runtime::{FromNapiValue, Object, ToNapiValue, ValidateNapiValue},
  check_status, raw_finalize, sys, Callback, Error, Result, Status, ValueType,
};

#[cfg(feature = "compat-mode")]
mod arraybuffer;
#[cfg(all(feature = "napi6", feature = "compat-mode"))]
mod bigint;
#[cfg(feature = "compat-mode")]
mod boolean;
#[cfg(feature = "compat-mode")]
mod buffer;
#[cfg(feature = "napi5")]
mod date;
#[cfg(feature = "serde-json")]
mod de;
#[cfg(feature = "napi4")]
mod deferred;
mod either;
mod escapable_handle_scope;
#[cfg(feature = "compat-mode")]
mod external;
#[cfg(feature = "compat-mode")]
mod function;
mod global;
#[cfg(feature = "compat-mode")]
mod null;
mod number;
#[cfg(feature = "compat-mode")]
mod object;
mod object_property;
#[cfg(feature = "serde-json")]
mod ser;
mod string;
mod symbol;
mod tagged_object;
#[cfg(feature = "compat-mode")]
mod undefined;
mod unknown;
mod value;
mod value_ref;

#[cfg(feature = "napi6")]
pub use crate::bindgen_prelude::{KeyCollectionMode, KeyConversion, KeyFilter};
#[cfg(feature = "compat-mode")]
pub use arraybuffer::*;
#[cfg(all(feature = "napi6", feature = "compat-mode"))]
pub use bigint::JsBigInt;
#[cfg(feature = "compat-mode")]
pub use boolean::JsBoolean;
#[cfg(feature = "compat-mode")]
pub use buffer::*;
#[cfg(feature = "napi5")]
pub use date::*;
#[cfg(feature = "serde-json")]
pub use de::De;
#[cfg(feature = "napi4")]
pub use deferred::*;
pub use either::Either;
pub use escapable_handle_scope::EscapableHandleScope;
#[cfg(feature = "compat-mode")]
pub use external::JsExternal;
#[cfg(feature = "compat-mode")]
pub use function::JsFunction;
pub use global::*;
#[cfg(feature = "compat-mode")]
pub use null::*;
pub use number::JsNumber;
#[cfg(feature = "compat-mode")]
pub use object::*;
pub use object_property::*;
#[cfg(feature = "serde-json")]
pub use ser::Ser;
pub use string::*;
pub use symbol::*;
pub(crate) use tagged_object::TaggedObject;
#[cfg(feature = "compat-mode")]
pub use undefined::JsUndefined;
pub use unknown::Unknown;
pub(crate) use value::Value;
pub use value_ref::*;

pub trait JsValue<'env>: Sized {
  fn value(&self) -> Value;

  fn raw(&self) -> sys::napi_value {
    self.value().value
  }

  /// Convert the value to an unknown
  fn to_unknown(&self) -> Unknown<'env> {
    Unknown(
      Value {
        env: self.value().env,
        value: self.value().value,
        value_type: ValueType::Unknown,
      },
      std::marker::PhantomData,
    )
  }

  /// Coerce the value to a boolean
  fn coerce_to_bool(&self) -> Result<bool> {
    let mut new_raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_coerce_to_bool(env, self.value().value, &mut new_raw_value)
    })?;
    unsafe { bool::from_napi_value(env, new_raw_value) }
  }

  fn coerce_to_number(&self) -> Result<JsNumber> {
    let mut new_raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_coerce_to_number(env, self.value().value, &mut new_raw_value)
    })?;
    Ok(JsNumber(
      Value {
        env,
        value: new_raw_value,
        value_type: ValueType::Number,
      },
      std::marker::PhantomData,
    ))
  }

  fn coerce_to_string(&self) -> Result<JsString> {
    let mut new_raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_coerce_to_string(env, self.value().value, &mut new_raw_value)
    })?;
    Ok(JsString(
      Value {
        env,
        value: new_raw_value,
        value_type: ValueType::String,
      },
      std::marker::PhantomData,
    ))
  }

  fn coerce_to_object(&self) -> Result<Object<'env>> {
    let mut new_raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_coerce_to_object(env, self.value().value, &mut new_raw_value)
    })?;
    Ok(Object::from_raw(env, new_raw_value))
  }

  #[cfg(feature = "napi5")]
  fn is_date(&self) -> Result<bool> {
    let mut is_date = true;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_date(env, self.value().value, &mut is_date) })?;
    Ok(is_date)
  }

  fn is_promise(&self) -> Result<bool> {
    let mut is_promise = true;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_promise(env, self.value().value, &mut is_promise) })?;
    Ok(is_promise)
  }

  fn is_error(&self) -> Result<bool> {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_error(env, self.value().value, &mut result) })?;
    Ok(result)
  }

  fn is_typedarray(&self) -> Result<bool> {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_typedarray(env, self.value().value, &mut result) })?;
    Ok(result)
  }

  fn is_dataview(&self) -> Result<bool> {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_dataview(env, self.value().value, &mut result) })?;
    Ok(result)
  }

  fn is_array(&self) -> Result<bool> {
    let mut is_array = false;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_array(env, self.value().value, &mut is_array) })?;
    Ok(is_array)
  }

  fn is_buffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_buffer(env, self.value().value, &mut is_buffer) })?;
    Ok(is_buffer)
  }

  fn is_arraybuffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_is_arraybuffer(env, self.value().value, &mut is_buffer) })?;
    Ok(is_buffer)
  }

  fn instanceof<'c, Constructor>(&self, constructor: Constructor) -> Result<bool>
  where
    Constructor: JsValue<'c>,
  {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_instanceof(env, self.value().value, constructor.raw(), &mut result)
    })?;
    Ok(result)
  }
}

pub trait JsObjectValue<'env>: JsValue<'env> {
  fn set_property<'k, 'v, K, V>(&mut self, key: K, value: V) -> Result<()>
  where
    K: JsValue<'k>,
    V: JsValue<'v>,
  {
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_set_property(env, self.value().value, key.raw(), value.raw())
    })
  }

  fn get_property<'k, K, T>(&self, key: K) -> Result<T>
  where
    K: JsObjectValue<'k>,
    T: FromNapiValue,
  {
    let mut raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_get_property(env, self.value().value, key.raw(), &mut raw_value)
    })?;
    unsafe { T::from_napi_value(env, raw_value) }
  }

  fn get_property_unchecked<'k, K, T>(&self, key: K) -> Result<T>
  where
    K: JsValue<'k>,
    T: FromNapiValue,
  {
    let mut raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_get_property(env, self.value().value, key.raw(), &mut raw_value)
    })?;
    unsafe { T::from_napi_value(env, raw_value) }
  }

  fn set_named_property<T>(&mut self, name: &str, value: T) -> Result<()>
  where
    T: ToNapiValue,
  {
    let key = CString::new(name)?;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_set_named_property(env, self.raw(), key.as_ptr(), T::to_napi_value(env, value)?)
    })
  }

  fn create_named_method(&mut self, name: &str, function: Callback) -> Result<()> {
    let mut js_function = ptr::null_mut();
    let len = name.len();
    let name = CString::new(name)?;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_create_function(
        env,
        name.as_ptr(),
        len as isize,
        Some(function),
        ptr::null_mut(),
        &mut js_function,
      )
    })?;
    check_status!(
      unsafe { sys::napi_set_named_property(env, self.value().value, name.as_ptr(), js_function) },
      "create_named_method error"
    )
  }

  fn get_named_property<T>(&self, name: &str) -> Result<T>
  where
    T: FromNapiValue + ValidateNapiValue,
  {
    let key = CString::new(name)?;
    let mut raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(
      unsafe {
        sys::napi_get_named_property(env, self.value().value, key.as_ptr(), &mut raw_value)
      },
      "get_named_property error"
    )?;
    unsafe { <T as ValidateNapiValue>::validate(env, raw_value) }.map_err(|mut err| {
      err.reason = format!("Object property '{name}' type mismatch. {}", err.reason);
      err
    })?;
    unsafe { <T as FromNapiValue>::from_napi_value(env, raw_value) }
  }

  fn get_named_property_unchecked<T>(&self, name: &str) -> Result<T>
  where
    T: FromNapiValue,
  {
    let key = CString::new(name)?;
    let mut raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(
      unsafe {
        sys::napi_get_named_property(env, self.value().value, key.as_ptr(), &mut raw_value)
      },
      "get_named_property_unchecked error"
    )?;
    unsafe { <T as FromNapiValue>::from_napi_value(env, raw_value) }
  }

  fn has_named_property<N: AsRef<str>>(&self, name: N) -> Result<bool> {
    let mut result = false;
    let key = CString::new(name.as_ref())?;
    let env = self.value().env;
    check_status!(
      unsafe { sys::napi_has_named_property(env, self.value().value, key.as_ptr(), &mut result) },
      "napi_has_named_property error"
    )?;
    Ok(result)
  }

  fn delete_property<'s, S>(&mut self, name: S) -> Result<bool>
  where
    S: JsValue<'s>,
  {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_delete_property(env, self.value().value, name.raw(), &mut result)
    })?;
    Ok(result)
  }

  fn delete_named_property(&mut self, name: &str) -> Result<bool> {
    let mut result = false;
    let mut js_key = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_create_string_utf8(env, name.as_ptr().cast(), name.len() as isize, &mut js_key)
    })?;
    check_status!(unsafe {
      sys::napi_delete_property(env, self.value().value, js_key, &mut result)
    })?;
    Ok(result)
  }

  fn has_own_property(&self, key: &str) -> Result<bool> {
    let mut result = false;
    let mut js_key = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_create_string_utf8(env, key.as_ptr().cast(), key.len() as isize, &mut js_key)
    })?;
    check_status!(unsafe {
      sys::napi_has_own_property(env, self.value().value, js_key, &mut result)
    })?;
    Ok(result)
  }

  fn has_own_property_js<'k, K>(&self, key: K) -> Result<bool>
  where
    K: JsValue<'k>,
  {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_has_own_property(env, self.value().value, key.raw(), &mut result)
    })?;
    Ok(result)
  }

  fn has_property(&self, name: &str) -> Result<bool> {
    let mut js_key = ptr::null_mut();
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_create_string_utf8(env, name.as_ptr().cast(), name.len() as isize, &mut js_key)
    })?;
    check_status!(unsafe { sys::napi_has_property(env, self.value().value, js_key, &mut result) })?;
    Ok(result)
  }

  fn has_property_js<'k, K>(&self, name: K) -> Result<bool>
  where
    K: JsValue<'k>,
  {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_has_property(env, self.value().value, name.raw(), &mut result)
    })?;
    Ok(result)
  }

  fn get_property_names(&self) -> Result<Object<'env>> {
    let mut raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_get_property_names(env, self.value().value, &mut raw_value)
    })?;
    Ok(Object::from_raw(env, raw_value))
  }

  /// Create a reference and return it as a `Ref<Object<'static>>`.
  fn create_ref(&self) -> Result<Ref<Object<'static>>> {
    let env = self.value().env;
    let mut raw_ref = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_reference(env, self.value().value, 1, &mut raw_ref) })?;
    Ok(Ref {
      raw_ref,
      taken: false,
      _phantom: PhantomData,
    })
  }

  /// <https://nodejs.org/api/n-api.html#n_api_napi_get_all_property_names>
  /// return `Array` of property names
  #[cfg(feature = "napi6")]
  fn get_all_property_names(
    &self,
    mode: KeyCollectionMode,
    filter: KeyFilter,
    conversion: KeyConversion,
  ) -> Result<Object<'env>> {
    let mut properties_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_get_all_property_names(
        env,
        self.value().value,
        mode.into(),
        filter.into(),
        conversion.into(),
        &mut properties_value,
      )
    })?;
    Ok(Object::from_raw(env, properties_value))
  }

  /// This returns the equivalent of `Object.getPrototypeOf` (which is not the same as the function's prototype property).
  fn get_prototype(&self) -> Result<Unknown<'env>> {
    let mut result = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe { sys::napi_get_prototype(env, self.value().value, &mut result) })?;
    Ok(unsafe { Unknown::from_raw_unchecked(env, result) })
  }

  fn get_prototype_unchecked<T>(&self) -> Result<T>
  where
    T: FromNapiValue,
  {
    let mut result = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe { sys::napi_get_prototype(env, self.value().value, &mut result) })?;
    unsafe { T::from_napi_value(env, result) }
  }

  fn set_element<'t, T>(&mut self, index: u32, value: T) -> Result<()>
  where
    T: JsValue<'t>,
  {
    let env = self.value().env;
    check_status!(unsafe { sys::napi_set_element(env, self.value().value, index, value.raw()) })
  }

  fn has_element(&self, index: u32) -> Result<bool> {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_has_element(env, self.value().value, index, &mut result) })?;
    Ok(result)
  }

  fn delete_element(&mut self, index: u32) -> Result<bool> {
    let mut result = false;
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_delete_element(env, self.value().value, index, &mut result)
    })?;
    Ok(result)
  }

  fn get_element<T>(&self, index: u32) -> Result<T>
  where
    T: FromNapiValue,
  {
    let mut raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_get_element(env, self.value().value, index, &mut raw_value)
    })?;
    unsafe { T::from_napi_value(env, raw_value) }
  }

  /// This method allows the efficient definition of multiple properties on a given object.
  fn define_properties(&mut self, properties: &[Property]) -> Result<()> {
    let properties_iter = properties.iter().map(|property| property.raw());
    let env = self.value().env;
    #[cfg(feature = "napi5")]
    {
      let mut closures = properties_iter
        .clone()
        .map(|p| p.data)
        .filter(|data| !data.is_null())
        .collect::<Vec<*mut std::ffi::c_void>>();
      let len = Box::into_raw(Box::new(closures.len()));
      check_status!(unsafe {
        sys::napi_add_finalizer(
          env,
          self.value().value,
          closures.as_mut_ptr().cast(),
          Some(finalize_closures),
          len.cast(),
          ptr::null_mut(),
        )
      })?;
      std::mem::forget(closures);
    }
    check_status!(unsafe {
      sys::napi_define_properties(
        env,
        self.value().value,
        properties.len(),
        properties_iter
          .collect::<Vec<sys::napi_property_descriptor>>()
          .as_ptr(),
      )
    })
  }

  /// Perform `is_array` check before get the length
  /// if `Object` is not array, `ArrayExpected` error returned
  fn get_array_length(&self) -> Result<u32> {
    if !(self.is_array()?) {
      return Err(Error::new(
        Status::ArrayExpected,
        "Object is not array".to_owned(),
      ));
    }
    self.get_array_length_unchecked()
  }

  /// use this API if you can ensure this `Object` is `Array`
  fn get_array_length_unchecked(&self) -> Result<u32> {
    let mut length: u32 = 0;
    let env = self.value().env;
    check_status!(unsafe { sys::napi_get_array_length(env, self.value().value, &mut length) })?;
    Ok(length)
  }

  fn wrap<T: 'static>(&mut self, native_object: T, size_hint: Option<usize>) -> Result<()> {
    let env = self.value().env;
    let value = self.raw();
    check_status!(unsafe {
      sys::napi_wrap(
        env,
        value,
        Box::into_raw(Box::new(TaggedObject::new(native_object))).cast(),
        Some(raw_finalize::<TaggedObject<T>>),
        Box::into_raw(Box::new(size_hint.unwrap_or(0) as i64)).cast(),
        ptr::null_mut(),
      )
    })
  }

  fn unwrap<T: 'static>(&self) -> Result<&mut T> {
    let env = self.value().env;
    let value = self.raw();
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      check_status!(sys::napi_unwrap(env, value, &mut unknown_tagged_object,))?;

      let type_id = unknown_tagged_object as *const TypeId;
      if *type_id == TypeId::of::<T>() {
        let tagged_object = unknown_tagged_object as *mut TaggedObject<T>;
        (*tagged_object).object.as_mut().ok_or_else(|| {
          Error::new(
            Status::InvalidArg,
            "Invalid argument, nothing attach to js_object".to_owned(),
          )
        })
      } else {
        Err(Error::new(
          Status::InvalidArg,
          format!(
            "Invalid argument, {} on unwrap is not the type of wrapped object",
            type_name::<T>()
          ),
        ))
      }
    }
  }

  fn drop_wrapped<T: 'static>(&mut self) -> Result<()> {
    let env = self.value().env;
    let value = self.raw();
    unsafe {
      let mut unknown_tagged_object = ptr::null_mut();
      check_status!(sys::napi_remove_wrap(
        env,
        value,
        &mut unknown_tagged_object,
      ))?;
      let type_id = unknown_tagged_object as *const TypeId;
      if *type_id == TypeId::of::<T>() {
        drop(Box::from_raw(unknown_tagged_object as *mut TaggedObject<T>));
        Ok(())
      } else {
        Err(Error::new(
          Status::InvalidArg,
          format!(
            "Invalid argument, {} on unwrap is not the type of wrapped object",
            type_name::<T>()
          ),
        ))
      }
    }
  }

  #[cfg(feature = "napi5")]
  fn add_finalizer<T, Hint, F>(
    &mut self,
    native: T,
    finalize_hint: Hint,
    finalize_cb: F,
  ) -> Result<()>
  where
    T: 'static,
    Hint: 'static,
    F: FnOnce(FinalizeContext<T, Hint>) + 'static,
  {
    let mut maybe_ref = ptr::null_mut();
    let env = self.value().env;
    let value = self.raw();
    let wrap_context = Box::leak(Box::new((native, finalize_cb, ptr::null_mut())));
    check_status!(unsafe {
      sys::napi_add_finalizer(
        env,
        value,
        wrap_context as *mut _ as *mut c_void,
        Some(
          finalize_callback::<T, Hint, F>
            as unsafe extern "C" fn(
              env: sys::napi_env,
              finalize_data: *mut c_void,
              finalize_hint: *mut c_void,
            ),
        ),
        Box::leak(Box::new(finalize_hint)) as *mut _ as *mut c_void,
        &mut maybe_ref, // Note: this does not point to the boxed one…
      )
    })?;
    wrap_context.2 = maybe_ref;
    Ok(())
  }

  #[cfg(feature = "napi8")]
  fn freeze(&mut self) -> Result<()> {
    let env = self.value().env;
    check_status!(unsafe { sys::napi_object_freeze(env, self.value().value) })
  }

  #[cfg(feature = "napi8")]
  fn seal(&mut self) -> Result<()> {
    let env = self.value().env;
    check_status!(unsafe { sys::napi_object_seal(env, self.value().value) })
  }
}

#[cfg(feature = "compat-mode")]
macro_rules! impl_napi_value_trait {
  ($js_value:ident, $value_type:expr) => {
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

    impl TryFrom<Unknown<'_>> for $js_value {
      type Error = Error;
      fn try_from(value: Unknown) -> Result<$js_value> {
        unsafe { $js_value::from_raw(value.0.env, value.0.value) }
      }
    }
  };
}

#[cfg(feature = "compat-mode")]
macro_rules! impl_js_value_methods {
  ($js_value:ident) => {
    impl $js_value {
      pub fn into_unknown<'env>(self) -> Unknown<'env> {
        unsafe { Unknown::from_raw_unchecked(self.0.env, self.0.value) }
      }

      #[cfg(feature = "compat-mode")]
      pub fn coerce_to_bool(self) -> Result<JsBoolean> {
        let mut new_raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_coerce_to_bool(self.0.env, self.0.value, &mut new_raw_value)
        })?;
        Ok(JsBoolean(Value {
          env: self.0.env,
          value: new_raw_value,
          value_type: ValueType::Boolean,
        }))
      }

      pub fn coerce_to_number<'env>(self) -> Result<JsNumber<'env>> {
        let mut new_raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_coerce_to_number(self.0.env, self.0.value, &mut new_raw_value)
        })?;
        Ok(JsNumber(
          Value {
            env: self.0.env,
            value: new_raw_value,
            value_type: ValueType::Number,
          },
          std::marker::PhantomData,
        ))
      }

      pub fn coerce_to_string<'env>(self) -> Result<JsString<'env>> {
        let mut new_raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_coerce_to_string(self.0.env, self.0.value, &mut new_raw_value)
        })?;
        Ok(JsString(
          Value {
            env: self.0.env,
            value: new_raw_value,
            value_type: ValueType::String,
          },
          std::marker::PhantomData,
        ))
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

      pub fn is_arraybuffer(&self) -> Result<bool> {
        let mut is_buffer = false;
        check_status!(unsafe {
          sys::napi_is_arraybuffer(self.0.env, self.0.value, &mut is_buffer)
        })?;
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
    }
  };
}

#[cfg(feature = "compat-mode")]
macro_rules! impl_object_methods {
  ($js_value:ident) => {
    impl $js_value {
      pub fn set_property<K, V>(&mut self, key: K, value: V) -> Result<()>
      where
        K: ToNapiValue,
        V: ToNapiValue,
      {
        check_status!(unsafe {
          sys::napi_set_property(
            self.0.env,
            self.0.value,
            ToNapiValue::to_napi_value(self.0.env, key)?,
            ToNapiValue::to_napi_value(self.0.env, value)?,
          )
        })
      }

      pub fn get_property<K, T>(&self, key: K) -> Result<T>
      where
        K: ToNapiValue,
        T: FromNapiValue,
      {
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_property(
            self.0.env,
            self.0.value,
            ToNapiValue::to_napi_value(self.0.env, key)?,
            &mut raw_value,
          )
        })?;
        unsafe { T::from_napi_value(self.0.env, raw_value) }
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
        T: ToNapiValue,
      {
        let key = CString::new(name)?;
        check_status!(unsafe {
          sys::napi_set_named_property(
            self.0.env,
            self.0.value,
            key.as_ptr(),
            T::to_napi_value(self.0.env, value)?,
          )
        })
      }

      pub fn create_named_method(&mut self, name: &str, function: Callback) -> Result<()> {
        let mut js_function = ptr::null_mut();
        let len = name.len();
        let name = CString::new(name)?;
        check_status!(unsafe {
          sys::napi_create_function(
            self.0.env,
            name.as_ptr(),
            len as isize,
            Some(function),
            ptr::null_mut(),
            &mut js_function,
          )
        })?;
        check_status!(
          unsafe {
            sys::napi_set_named_property(self.0.env, self.0.value, name.as_ptr(), js_function)
          },
          "create_named_method error"
        )
      }

      pub fn get_named_property<T>(&self, name: &str) -> Result<T>
      where
        T: FromNapiValue + ValidateNapiValue,
      {
        let key = CString::new(name)?;
        let mut raw_value = ptr::null_mut();
        check_status!(
          unsafe {
            sys::napi_get_named_property(self.0.env, self.0.value, key.as_ptr(), &mut raw_value)
          },
          "get_named_property error"
        )?;
        unsafe { <T as ValidateNapiValue>::validate(self.0.env, raw_value) }.map_err(
          |mut err| {
            err.reason = format!("Object property '{name}' type mismatch. {}", err.reason);
            err
          },
        )?;
        unsafe { <T as FromNapiValue>::from_napi_value(self.0.env, raw_value) }
      }

      pub fn get_named_property_unchecked<T>(&self, name: &str) -> Result<T>
      where
        T: FromNapiValue,
      {
        let key = CString::new(name)?;
        let mut raw_value = ptr::null_mut();
        check_status!(
          unsafe {
            sys::napi_get_named_property(self.0.env, self.0.value, key.as_ptr(), &mut raw_value)
          },
          "get_named_property_unchecked error"
        )?;
        unsafe { <T as FromNapiValue>::from_napi_value(self.0.env, raw_value) }
      }

      pub fn has_named_property<N: AsRef<str>>(&self, name: N) -> Result<bool> {
        let mut result = false;
        let key = CString::new(name.as_ref())?;
        check_status!(
          unsafe {
            sys::napi_has_named_property(self.0.env, self.0.value, key.as_ptr(), &mut result)
          },
          "napi_has_named_property error"
        )?;
        Ok(result)
      }

      pub fn delete_property<S>(&mut self, name: S) -> Result<bool>
      where
        S: ToNapiValue,
      {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_delete_property(
            self.0.env,
            self.0.value,
            ToNapiValue::to_napi_value(self.0.env, name)?,
            &mut result,
          )
        })?;
        Ok(result)
      }

      pub fn delete_named_property(&mut self, name: &str) -> Result<bool> {
        let mut result = false;
        let mut js_key = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_create_string_utf8(
            self.0.env,
            name.as_ptr().cast(),
            name.len() as isize,
            &mut js_key,
          )
        })?;
        check_status!(unsafe {
          sys::napi_delete_property(self.0.env, self.0.value, js_key, &mut result)
        })?;
        Ok(result)
      }

      pub fn has_own_property(&self, key: &str) -> Result<bool> {
        let mut result = false;
        let mut js_key = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_create_string_utf8(
            self.0.env,
            key.as_ptr().cast(),
            key.len() as isize,
            &mut js_key,
          )
        })?;
        check_status!(unsafe {
          sys::napi_has_own_property(self.0.env, self.0.value, js_key, &mut result)
        })?;
        Ok(result)
      }

      pub fn has_own_property_js<K>(&self, key: K) -> Result<bool>
      where
        K: ToNapiValue,
      {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_has_own_property(
            self.0.env,
            self.0.value,
            ToNapiValue::to_napi_value(self.0.env, key)?,
            &mut result,
          )
        })?;
        Ok(result)
      }

      pub fn has_property(&self, name: &str) -> Result<bool> {
        let mut js_key = ptr::null_mut();
        let mut result = false;
        check_status!(unsafe {
          sys::napi_create_string_utf8(
            self.0.env,
            name.as_ptr().cast(),
            name.len() as isize,
            &mut js_key,
          )
        })?;
        check_status!(unsafe {
          sys::napi_has_property(self.0.env, self.0.value, js_key, &mut result)
        })?;
        Ok(result)
      }

      pub fn has_property_js<K>(&self, name: K) -> Result<bool>
      where
        K: ToNapiValue,
      {
        let mut result = false;
        check_status!(unsafe {
          sys::napi_has_property(
            self.0.env,
            self.0.value,
            ToNapiValue::to_napi_value(self.0.env, name)?,
            &mut result,
          )
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

      /// <https://nodejs.org/api/n-api.html#n_api_napi_get_all_property_names>
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
        T: ToNapiValue,
      {
        check_status!(unsafe {
          sys::napi_set_element(
            self.0.env,
            self.0.value,
            index,
            ToNapiValue::to_napi_value(self.0.env, value)?,
          )
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
        T: FromNapiValue,
      {
        let mut raw_value = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_get_element(self.0.env, self.0.value, index, &mut raw_value)
        })?;
        unsafe { T::from_napi_value(self.0.env, raw_value) }
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
        let properties_iter = properties.iter().map(|property| property.raw());
        #[cfg(feature = "napi5")]
        {
          let mut closures = properties_iter
            .clone()
            .map(|p| p.data)
            .filter(|data| !data.is_null())
            .collect::<Vec<*mut std::ffi::c_void>>();
          let len = Box::into_raw(Box::new(closures.len()));
          check_status!(unsafe {
            sys::napi_add_finalizer(
              self.0.env,
              self.0.value,
              closures.as_mut_ptr().cast(),
              Some(finalize_closures),
              len.cast(),
              ptr::null_mut(),
            )
          })?;
          std::mem::forget(closures);
        }
        check_status!(unsafe {
          sys::napi_define_properties(
            self.0.env,
            self.0.value,
            properties.len(),
            properties_iter
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

#[cfg(feature = "compat-mode")]
pub trait NapiRaw {
  #[allow(clippy::missing_safety_doc)]
  unsafe fn raw(&self) -> sys::napi_value;
}

#[cfg(feature = "compat-mode")]
pub trait NapiValue: Sized + NapiRaw {
  #[allow(clippy::missing_safety_doc)]
  unsafe fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Self>;

  #[allow(clippy::missing_safety_doc)]
  unsafe fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Self;
}

#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsUndefined);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsNull);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsBoolean);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsBuffer);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsArrayBuffer);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsTypedArray);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsDataView);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsObject);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsFunction);
#[cfg(feature = "compat-mode")]
impl_js_value_methods!(JsExternal);

#[cfg(feature = "compat-mode")]
impl_object_methods!(JsObject);
#[cfg(feature = "compat-mode")]
impl_object_methods!(JsBuffer);
#[cfg(feature = "compat-mode")]
impl_object_methods!(JsArrayBuffer);
#[cfg(feature = "compat-mode")]
impl_object_methods!(JsTypedArray);
#[cfg(feature = "compat-mode")]
impl_object_methods!(JsDataView);

#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsUndefined, ValueType::Undefined);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsNull, ValueType::Null);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsBoolean, ValueType::Boolean);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsBuffer, ValueType::Object);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsArrayBuffer, ValueType::Object);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsTypedArray, ValueType::Object);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsDataView, ValueType::Object);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsObject, ValueType::Object);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsFunction, ValueType::Object);
#[cfg(feature = "compat-mode")]
impl_napi_value_trait!(JsExternal, ValueType::External);

#[cfg(feature = "napi5")]
unsafe extern "C" fn finalize_closures(_env: sys::napi_env, data: *mut c_void, len: *mut c_void) {
  let length: usize = *unsafe { Box::from_raw(len.cast()) };
  let closures: Vec<*mut PropertyClosures> =
    unsafe { Vec::from_raw_parts(data.cast(), length, length) };
  for closure in closures.into_iter() {
    drop(unsafe { Box::from_raw(closure) });
  }
}

#[cfg(feature = "napi5")]
unsafe extern "C" fn finalize_callback<T, Hint, F>(
  raw_env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) where
  T: 'static,
  Hint: 'static,
  F: FnOnce(FinalizeContext<T, Hint>),
{
  use crate::Env;

  let (value, callback, raw_ref) =
    unsafe { *Box::from_raw(finalize_data as *mut (T, F, sys::napi_ref)) };
  let hint = unsafe { *Box::from_raw(finalize_hint as *mut Hint) };
  let env = Env::from_raw(raw_env);
  callback(FinalizeContext { env, value, hint });
  if !raw_ref.is_null() {
    let status = unsafe { sys::napi_delete_reference(raw_env, raw_ref) };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Delete reference in finalize callback failed"
    );
  }
}
