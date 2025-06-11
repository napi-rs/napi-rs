use std::any::{type_name, TypeId};
#[cfg(feature = "napi6")]
use std::convert::TryFrom;
use std::ffi::{c_void, CString};
use std::marker::PhantomData;
use std::ptr;

use crate::{
  bindgen_prelude::*, check_status, raw_finalize, sys, type_of, Callback, JsValue, Ref,
  TaggedObject, Value, ValueType,
};
#[cfg(feature = "napi5")]
use crate::{Env, PropertyClosures};

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
    K: JsValue<'k>,
    T: FromNapiValue + ValidateNapiValue,
  {
    let mut raw_value = ptr::null_mut();
    let env = self.value().env;
    check_status!(unsafe {
      sys::napi_get_property(env, self.value().value, key.raw(), &mut raw_value)
    })?;
    unsafe { T::validate(env, raw_value) }.map_err(|mut err| {
      err.reason = format!(
        "Object property '{:?}' type mismatch. {}",
        key
          .coerce_to_string()
          .and_then(|s| s.into_utf8())
          .and_then(|s| s.into_owned()),
        err.reason
      );
      err
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
      if !properties.is_empty() {
        let mut closures = properties_iter
          .clone()
          .map(|p| p.data)
          .filter(|data| !data.is_null())
          .collect::<Vec<*mut std::ffi::c_void>>();
        let len = Box::into_raw(Box::new(closures.len()));
        check_status!(
          unsafe {
            sys::napi_add_finalizer(
              env,
              self.value().value,
              closures.as_mut_ptr().cast(),
              Some(finalize_closures),
              len.cast(),
              ptr::null_mut(),
            )
          },
          "Failed to add finalizer"
        )?;
        std::mem::forget(closures);
      }
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
  pub fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Self {
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
    check_status_or_throw!(
      raw_env,
      unsafe { sys::napi_delete_reference(raw_env, raw_ref) },
      "Delete reference in finalize callback failed"
    );
  }
}

#[cfg(feature = "napi5")]
pub(crate) unsafe extern "C" fn finalize_closures(
  _env: sys::napi_env,
  data: *mut c_void,
  len: *mut c_void,
) {
  let length: usize = *unsafe { Box::from_raw(len.cast()) };
  let closures: Vec<*mut PropertyClosures> =
    unsafe { Vec::from_raw_parts(data.cast(), length, length) };
  for closure_ptr in closures.into_iter() {
    if !closure_ptr.is_null() {
      let closures = unsafe { Box::from_raw(closure_ptr) };
      // Free the actual closure functions using the stored drop functions
      if !closures.getter_closure.is_null() {
        if let Some(drop_fn) = closures.getter_drop_fn {
          unsafe { drop_fn(closures.getter_closure) };
        }
      }
      if !closures.setter_closure.is_null() {
        if let Some(drop_fn) = closures.setter_drop_fn {
          unsafe { drop_fn(closures.setter_closure) };
        }
      }
    }
  }
}
