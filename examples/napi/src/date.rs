use std::str::FromStr;

use chrono::{Duration, FixedOffset, Local, TimeZone, Utc};
use napi::bindgen_prelude::*;

#[napi]
fn date_to_number(input: Date) -> Result<f64> {
  input.value_of()
}

#[napi]
fn chrono_utc_date_to_millis(input: chrono::DateTime<Utc>) -> i64 {
  input.timestamp_millis()
}

#[napi]
fn chrono_local_date_to_millis(input: chrono::DateTime<Local>) -> i64 {
  input.timestamp_millis()
}

#[napi]
fn chrono_date_with_timezone_to_millis(input: chrono::DateTime<FixedOffset>) -> i64 {
  input.timestamp_millis()
}

#[napi]
fn chrono_date_add_1_minute(input: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
  Duration::try_minutes(1).map(|d| input + d).unwrap()
}

#[napi(object)]
pub struct UtcDates {
  pub start: chrono::DateTime<Utc>,
  pub end: Option<chrono::DateTime<Utc>>,
}

#[napi(object)]
pub struct LocalDates {
  pub start: chrono::DateTime<Local>,
  pub end: Option<chrono::DateTime<Local>>,
}

#[napi(object)]
pub struct DatesWithTimeZone {
  pub start: chrono::DateTime<FixedOffset>,
  pub end: Option<chrono::DateTime<FixedOffset>>,
}

#[napi]
pub fn chrono_native_date_time(date: chrono::NaiveDateTime) -> i64 {
  date.and_utc().timestamp_millis()
}

#[napi]
pub fn chrono_native_date_time_return() -> Option<chrono::NaiveDateTime> {
  chrono::NaiveDateTime::from_str("2016-12-23T15:25:59.325").ok()
}

#[napi]
pub fn chrono_utc_date_return() -> Option<chrono::DateTime<Utc>> {
  chrono::DateTime::<Utc>::from_str("2016-12-23T15:25:59.325").ok()
}

#[napi]
pub fn chrono_local_date_return() -> Option<chrono::DateTime<Local>> {
  chrono::DateTime::<Local>::from_str("2016-12-23T15:25:59.325").ok()
}

#[napi]
pub fn chrono_date_with_timezone_return() -> Option<chrono::DateTime<FixedOffset>> {
  chrono::DateTime::<FixedOffset>::from_str("2016-12-23T15:25:59.325").ok()
}

#[napi]
pub fn chrono_date_fixture_return1() -> chrono::DateTime<FixedOffset> {
  // Pacific Standard Time: UTC-08:00
  let pst = FixedOffset::west_opt(8 * 3600).unwrap();
  pst
    .with_ymd_and_hms(2024, 2, 7, 18, 28, 18)
    .single()
    .unwrap()
}

#[napi]
pub fn chrono_date_fixture_return2() -> chrono::DateTime<FixedOffset> {
  // Indian Standard Time: UTC+05:30
  let ist = FixedOffset::east_opt(5 * 3600 + 30 * 60).unwrap();
  ist
    .with_ymd_and_hms(2024, 2, 7, 18, 28, 18)
    .single()
    .unwrap()
}
