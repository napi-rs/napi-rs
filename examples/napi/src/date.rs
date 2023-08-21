use std::str::FromStr;

use chrono::{Duration, Utc};
use napi::bindgen_prelude::*;

#[napi]
fn date_to_number(input: Date) -> Result<f64> {
  input.value_of()
}

#[napi]
fn chrono_date_to_millis(input: chrono::DateTime<Utc>) -> i64 {
  input.timestamp_millis()
}

#[napi]
fn chrono_date_add_1_minute(input: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
  input + Duration::minutes(1)
}

#[napi(object)]
pub struct Dates {
  pub start: chrono::DateTime<Utc>,
  pub end: Option<chrono::DateTime<Utc>>,
}

#[napi]
pub fn chrono_native_date_time(date: chrono::NaiveDateTime) -> i64 {
  date.timestamp_millis()
}

#[napi]
pub fn chrono_native_date_time_return() -> Option<chrono::NaiveDateTime> {
  chrono::NaiveDateTime::from_str("2016-12-23T15:25:59.325").ok()
}
