use std::collections::HashMap;

use chrono::{DateTime, Utc};
use napi::{bindgen_prelude::*, JsSymbol, JsUnknown};

#[napi(strict)]
fn validate_array(arr: Vec<u32>) -> u32 {
  arr.len() as u32
}

#[napi(strict)]
fn validate_buffer(b: Buffer) -> u32 {
  b.len() as u32
}

#[napi(strict)]
fn validate_typed_array(input: Uint8Array) -> u32 {
  input.len() as u32
}

#[napi(strict)]
fn validate_typed_array_slice(input: &[u8]) -> u32 {
  input.len() as u32
}

#[napi(strict)]
fn validate_uint8_clamped_slice(input: Uint8ClampedSlice) -> u32 {
  input.len() as u32
}

#[napi(strict)]
fn validate_buffer_slice(input: BufferSlice) -> u32 {
  input.len() as u32
}

#[napi(strict)]
fn validate_bigint(input: BigInt) -> i128 {
  input.get_i128().0
}

#[napi(strict)]
fn validate_boolean(i: bool) -> bool {
  !i
}

#[napi(strict)]
fn validate_date(d: Date) -> Result<f64> {
  d.value_of()
}

#[napi(strict)]
fn validate_date_time(_d: DateTime<Utc>) -> i64 {
  1
}

#[napi(strict)]
fn validate_external(e: &External<u32>) -> u32 {
  **e
}

#[napi(strict, ts_args_type = "cb: () => number")]
fn validate_function(cb: Function<(), JsUnknown>) -> Result<u32> {
  Ok(cb.call(())?.coerce_to_number()?.get_uint32()? + 3)
}

#[napi(strict)]
fn validate_hash_map(input: HashMap<String, u32>) -> u32 {
  input.len() as u32
}

#[napi(strict)]
fn validate_null(_i: Null) -> bool {
  true
}

#[napi(strict)]
fn validate_undefined(_i: Undefined) -> bool {
  true
}

#[napi(strict)]
fn validate_number(i: f64) -> f64 {
  i + 1.0
}

#[napi(strict)]
async fn validate_promise(p: Promise<u32>) -> Result<u32> {
  Ok(p.await? + 1)
}

#[napi(strict)]
fn validate_string(s: String) -> String {
  s + "!"
}

#[napi(strict)]
fn validate_symbol(_s: JsSymbol) -> bool {
  true
}

#[napi(strict)]
fn validate_optional(input1: Option<String>, input2: Option<bool>) -> bool {
  input1.is_some() || input2.unwrap_or(false)
}

/// default enum values are continuos i32s start from 0
#[napi]
pub enum KindInValidate {
  /// Barks
  Dog,
  /// Kills birds
  Cat,
  /// Tasty
  Duck,
}

#[napi(strict)]
pub fn validate_enum(input: KindInValidate) -> i32 {
  input as i32
}

#[napi(string_enum)]
#[derive(Debug)]
pub enum StatusInValidate {
  Poll,
  Ready,
  Done,
}

#[napi(strict)]
pub fn validate_string_enum(input: StatusInValidate) -> String {
  format!("{:?}", input)
}

#[napi(return_if_invalid)]
fn return_undefined_if_invalid(input: bool) -> bool {
  !input
}

#[napi(return_if_invalid)]
async fn return_undefined_if_invalid_promise(input: Promise<bool>) -> Result<bool> {
  let input_value = input.await?;
  Ok(!input_value)
}
