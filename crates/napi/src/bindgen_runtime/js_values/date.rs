use std::ptr;

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
