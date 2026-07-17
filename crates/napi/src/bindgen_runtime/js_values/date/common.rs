use std::ptr;

use crate::{bindgen_prelude::*, check_status, sys};

/// Validates that the value holds the `Date` object
/// and returns the results of the validation in [`ValidateNapiValue::validate`] format
///
/// # Safety
///
/// The caller must ensure that:
/// - The `env` is a valid napi env pointer
/// - The `napi_val` is a valid js value pointer
pub unsafe fn validate_date(
  env: sys::napi_env,
  napi_val: sys::napi_value,
) -> Result<sys::napi_value> {
  let mut is_date = false;
  check_status!(unsafe { sys::napi_is_date(env, napi_val, &mut is_date) })?;
  if !is_date {
    return Err(Error::new(
      Status::InvalidArg,
      "Expected a Date object".to_owned(),
    ));
  }

  Ok(ptr::null_mut())
}

/// Returns number of milliseconds since the UNIX epoch stored in the `Date`
///
/// # Safety
///
/// The caller must ensure that:
/// - The `env` is a valid napi env pointer
/// - The `napi_val` is a valid js value pointer
pub unsafe fn get_date_millis(env: sys::napi_env, napi_val: sys::napi_value) -> Result<f64> {
  let mut milliseconds_since_epoch_utc = 0.0;

  check_status!(
    unsafe { sys::napi_get_date_value(env, napi_val, &mut milliseconds_since_epoch_utc) },
    "Failed to get milliseconds since epoch from a Date object",
  )?;

  Ok(milliseconds_since_epoch_utc)
}

/// Creates a `Date` object storing the specified timestamp in milliseconds since epoch
///
/// # Safety
///
/// The caller must ensure that:
/// - The `env` is a valid napi env pointer
pub unsafe fn date_from_millis(
  env: sys::napi_env,
  millis_since_epoch: f64,
) -> Result<sys::napi_value> {
  // Avoid silently creating invalid dates
  // https://tc39.es/ecma262/#sec-timeclip
  if millis_since_epoch.abs() > 8.64e15 {
    return Err(Error::new(
      Status::InvalidArg,
      format!("Date object cannot represent {} ms", millis_since_epoch),
    ));
  }

  let mut ptr = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_date(env, millis_since_epoch, &mut ptr) },
    "Failed to create a Date object",
  )?;

  Ok(ptr)
}
