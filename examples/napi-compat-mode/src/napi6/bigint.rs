use napi::{CallContext, JsBigInt, JsNumber, JsObject, Result};
use std::convert::TryFrom;

#[js_function]
pub fn test_create_bigint_from_i64(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_i64(i64::MAX)
}

#[js_function]
pub fn test_create_bigint_from_min_i64(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_i64(i64::MIN)
}

#[js_function]
pub fn test_create_bigint_from_negative_i64(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_i64(-10_i64)
}

#[js_function]
pub fn test_create_bigint_from_u64(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_u64(u64::MAX)
}

#[js_function]
pub fn test_create_bigint_from_i128(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_i128(i128::MAX)
}

#[js_function]
pub fn test_create_bigint_from_min_i128(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_i128(i128::MIN)
}

#[js_function]
pub fn test_create_bigint_from_negative_i128(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_i128(-10_i128)
}

#[js_function]
pub fn test_create_bigint_from_u128(ctx: CallContext) -> Result<JsBigInt> {
  ctx.env.create_bigint_from_u128(u128::MAX)
}

#[js_function]
pub fn test_create_bigint_from_words(ctx: CallContext) -> Result<JsBigInt> {
  ctx
    .env
    .create_bigint_from_words(true, vec![u64::MAX, u64::MAX])
}

#[js_function(1)]
pub fn test_get_bigint_i64(ctx: CallContext) -> Result<JsNumber> {
  let js_bigint = ctx.get::<JsBigInt>(0)?;
  let val = i64::try_from(js_bigint)?;
  ctx.env.create_int32(val as i32)
}

#[js_function(1)]
pub fn test_get_bigint_u64(ctx: CallContext) -> Result<JsNumber> {
  let js_bigint = ctx.get::<JsBigInt>(0)?;
  let val = u64::try_from(js_bigint)?;
  ctx.env.create_int32(val as i32)
}

#[js_function(0)]
pub fn test_get_bigint_words(ctx: CallContext) -> Result<JsObject> {
  let mut js_bigint = ctx
    .env
    .create_bigint_from_words(true, vec![i64::MAX as u64, i64::MAX as u64])?;
  let mut js_arr = ctx.env.create_array_with_length(2)?;
  let (_signed, words) = js_bigint.get_words()?;
  js_arr.set_element(0, ctx.env.create_bigint_from_u64(words[0])?)?;
  js_arr.set_element(1, ctx.env.create_bigint_from_u64(words[1])?)?;
  Ok(js_arr)
}
