use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{bindgen_prelude::*, sys, ValueType};

use super::common::{date_from_millis, get_date_millis, validate_date};

impl TypeName for SystemTime {
  fn type_name() -> &'static str {
    "SystemTime"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl ValidateNapiValue for SystemTime {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    unsafe { validate_date(env, napi_val) }
  }
}

impl ToNapiValue for SystemTime {
  unsafe fn to_napi_value(env: sys::napi_env, val: SystemTime) -> Result<sys::napi_value> {
    let millis_since_epoch = match val.duration_since(UNIX_EPOCH) {
      Ok(duration) => duration.as_millis() as f64,
      Err(err) => -(err.duration().as_millis() as f64),
    };

    unsafe { date_from_millis(env, millis_since_epoch) }
  }
}

impl FromNapiValue for SystemTime {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let milliseconds_since_epoch = unsafe { get_date_millis(env, napi_val) }?;

    let result = if !milliseconds_since_epoch.is_finite() {
      None
    } else if milliseconds_since_epoch.is_sign_negative() {
      UNIX_EPOCH.checked_sub(Duration::from_millis((-milliseconds_since_epoch) as u64))
    } else {
      UNIX_EPOCH.checked_add(Duration::from_millis(milliseconds_since_epoch as u64))
    };

    match result {
      Some(timestamp) => Ok(timestamp),
      None => Err(Error::new(
        Status::DateExpected,
        "Date cannot be represented as rust type `SystemTime`".to_owned(),
      )),
    }
  }
}
