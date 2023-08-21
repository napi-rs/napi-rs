use std::{ptr, str::FromStr};

use chrono::{DateTime, NaiveDateTime, Utc};

use crate::{bindgen_prelude::*, check_status, sys, ValueType};

impl TypeName for DateTime<Utc> {
  fn type_name() -> &'static str {
    "DateTime"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl ValidateNapiValue for DateTime<Utc> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
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
}

impl ToNapiValue for NaiveDateTime {
  unsafe fn to_napi_value(env: sys::napi_env, val: NaiveDateTime) -> Result<sys::napi_value> {
    let mut ptr = std::ptr::null_mut();
    let millis_since_epoch_utc = val.timestamp_millis() as f64;

    check_status!(
      unsafe { sys::napi_create_date(env, millis_since_epoch_utc, &mut ptr) },
      "Failed to convert rust type `NaiveDateTime` into napi value",
    )?;

    Ok(ptr)
  }
}

impl FromNapiValue for NaiveDateTime {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut to_iso_string = ptr::null_mut();
    check_status!(
      unsafe {
        napi_sys::napi_create_string_utf8(
          env,
          "toISOString\0".as_ptr().cast(),
          11,
          &mut to_iso_string,
        )
      },
      "create toISOString JavaScript string failed"
    )?;
    let mut to_iso_string_method = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_property(env, napi_val, to_iso_string, &mut to_iso_string_method) },
      "get toISOString method failed"
    )?;
    let mut iso_string_value = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_call_function(
          env,
          napi_val,
          to_iso_string_method,
          0,
          ptr::null(),
          &mut iso_string_value,
        )
      },
      "Call toISOString on Date Object failed"
    )?;

    let mut iso_string_length = 0;
    check_status!(
      unsafe {
        sys::napi_get_value_string_utf8(
          env,
          iso_string_value,
          ptr::null_mut(),
          0,
          &mut iso_string_length,
        )
      },
      "Get ISOString length failed"
    )?;
    let mut iso_string = String::with_capacity(iso_string_length + 1);
    check_status!(
      unsafe {
        sys::napi_get_value_string_utf8(
          env,
          iso_string_value,
          iso_string.as_mut_ptr().cast(),
          iso_string_length,
          &mut iso_string_length,
        )
      },
      "Get ISOString length failed"
    )?;

    unsafe { iso_string.as_mut_vec().set_len(iso_string_length) };

    let naive = NaiveDateTime::from_str(iso_string.as_str()).map_err(|err| {
      Error::new(
        Status::InvalidArg,
        format!(
          "Failed to convert napi value into rust type `NaiveDateTime` {} {}",
          err, iso_string
        ),
      )
    })?;

    Ok(naive)
  }
}

impl ToNapiValue for DateTime<Utc> {
  unsafe fn to_napi_value(env: sys::napi_env, val: DateTime<Utc>) -> Result<sys::napi_value> {
    let mut ptr = std::ptr::null_mut();
    let millis_since_epoch_utc = val.timestamp_millis() as f64;

    check_status!(
      unsafe { sys::napi_create_date(env, millis_since_epoch_utc, &mut ptr) },
      "Failed to convert rust type `DateTime<Utc>` into napi value",
    )?;

    Ok(ptr)
  }
}

impl FromNapiValue for DateTime<Utc> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut milliseconds_since_epoch_utc = 0.0;

    check_status!(
      unsafe { sys::napi_get_date_value(env, napi_val, &mut milliseconds_since_epoch_utc) },
      "Failed to convert napi value into rust type `DateTime<Utc>`",
    )?;

    let milliseconds_since_epoch_utc = milliseconds_since_epoch_utc as i64;
    let timestamp_seconds = milliseconds_since_epoch_utc / 1_000;
    let naive = NaiveDateTime::from_timestamp_opt(
      timestamp_seconds,
      (milliseconds_since_epoch_utc % 1_000 * 1_000_000) as u32,
    )
    .ok_or_else(|| Error::new(Status::DateExpected, "Found invalid date".to_owned()))?;
    Ok(DateTime::<Utc>::from_utc(naive, Utc))
  }
}
