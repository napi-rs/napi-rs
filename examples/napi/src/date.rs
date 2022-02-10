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
