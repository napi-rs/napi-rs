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
use crate::{Error, Result};

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
    F: FnOnce(FinalizeContext<T, Hint>),
  {
    let mut maybe_ref = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_add_finalizer(
        self.0.env,
        self.0.value,
        Box::leak(Box::new((native, finalize_cb, maybe_ref))) as *mut _ as *mut c_void,
        Some(
          finalize_callback::<T, Hint, F>
            as unsafe extern "C" fn(
              env: sys::napi_env,
              finalize_data: *mut c_void,
              finalize_hint: *mut c_void,
            ),
        ),
        Box::leak(Box::new(finalize_hint)) as *mut _ as *mut c_void,
        &mut maybe_ref,
      )
    })
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
  let (value, callback, raw_ref) = *Box::from_raw(finalize_data as *mut (T, F, sys::napi_ref));
  let hint = *Box::from_raw(finalize_hint as *mut Hint);
  let env = Env::from_raw(raw_env);
  callback(FinalizeContext { value, hint, env });
  if !raw_ref.is_null() {
    let status = sys::napi_delete_reference(raw_env, raw_ref);
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
      sys::napi_key_collection_mode::napi_key_include_prototypes => Ok(Self::IncludePrototypes),
      sys::napi_key_collection_mode::napi_key_own_only => Ok(Self::OwnOnly),
    }
  }
}

#[cfg(feature = "napi6")]
impl From<KeyCollectionMode> for sys::napi_key_collection_mode {
  fn from(value: KeyCollectionMode) -> Self {
    match value {
      KeyCollectionMode::IncludePrototypes => {
        sys::napi_key_collection_mode::napi_key_include_prototypes
      }
      KeyCollectionMode::OwnOnly => sys::napi_key_collection_mode::napi_key_own_only,
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
      sys::napi_key_filter::napi_key_all_properties => Ok(Self::AllProperties),
      sys::napi_key_filter::napi_key_writable => Ok(Self::Writable),
      sys::napi_key_filter::napi_key_enumerable => Ok(Self::Enumerable),
      sys::napi_key_filter::napi_key_configurable => Ok(Self::Configurable),
      sys::napi_key_filter::napi_key_skip_strings => Ok(Self::SkipStrings),
      sys::napi_key_filter::napi_key_skip_symbols => Ok(Self::SkipSymbols),
    }
  }
}

#[cfg(feature = "napi6")]
impl From<KeyFilter> for sys::napi_key_filter {
  fn from(value: KeyFilter) -> Self {
    match value {
      KeyFilter::AllProperties => Self::napi_key_all_properties,
      KeyFilter::Writable => Self::napi_key_writable,
      KeyFilter::Enumerable => Self::napi_key_enumerable,
      KeyFilter::Configurable => Self::napi_key_configurable,
      KeyFilter::SkipStrings => Self::napi_key_skip_strings,
      KeyFilter::SkipSymbols => Self::napi_key_skip_symbols,
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
      sys::napi_key_conversion::napi_key_keep_numbers => Ok(Self::KeepNumbers),
      sys::napi_key_conversion::napi_key_numbers_to_strings => Ok(Self::NumbersToStrings),
    }
  }
}

#[cfg(feature = "napi6")]
impl From<KeyConversion> for sys::napi_key_conversion {
  fn from(value: KeyConversion) -> Self {
    match value {
      KeyConversion::KeepNumbers => Self::napi_key_keep_numbers,
      KeyConversion::NumbersToStrings => Self::napi_key_numbers_to_strings,
    }
  }
}
