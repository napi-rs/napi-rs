#[cfg(feature = "napi6")]
use std::convert::TryFrom;
#[cfg(feature = "napi5")]
use std::ffi::c_void;
#[cfg(feature = "napi5")]
use std::ptr;

#[cfg(feature = "napi5")]
use super::check_status;
use super::Value;
#[cfg(feature = "napi5")]
use crate::sys;
#[cfg(feature = "napi5")]
use crate::Env;
#[cfg(feature = "napi6")]
use crate::Error;
#[cfg(feature = "napi5")]
use crate::Result;

pub struct JsObject(pub(crate) Value);

#[cfg(feature = "napi5")]
pub struct FinalizeContext<T: 'static, Hint: 'static> {
  pub env: Env,
  pub value: T,
  pub hint: Hint,
}

#[cfg(feature = "napi5")]
impl JsObject {
  pub fn add_finalizer<T, Hint, F>(
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
    let wrap_context = Box::leak(Box::new((native, finalize_cb, ptr::null_mut())));
    check_status!(unsafe {
      sys::napi_add_finalizer(
        self.0.env,
        self.0.value,
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
  let (value, callback, raw_ref) =
    unsafe { *Box::from_raw(finalize_data as *mut (T, F, sys::napi_ref)) };
  let hint = unsafe { *Box::from_raw(finalize_hint as *mut Hint) };
  let env = unsafe { Env::from_raw(raw_env) };
  callback(FinalizeContext { env, value, hint });
  if !raw_ref.is_null() {
    let status = unsafe { sys::napi_delete_reference(raw_env, raw_ref) };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Delete reference in finalize callback failed"
    );
  }
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
