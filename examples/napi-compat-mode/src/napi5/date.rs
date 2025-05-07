use std::convert::TryInto;

use napi::{CallContext, JsDate, JsNumber, JsValue, Result, Unknown};

#[js_function(1)]
pub fn test_object_is_date(ctx: CallContext) -> Result<bool> {
  let obj = ctx.get::<Unknown>(0)?;
  obj.is_date()
}

#[js_function(1)]
pub fn test_create_date(ctx: CallContext) -> Result<JsDate> {
  let timestamp: f64 = ctx.get::<JsNumber>(0)?.try_into()?;
  ctx.env.create_date(timestamp)
}

#[js_function(1)]
pub fn test_get_date_value(ctx: CallContext) -> Result<JsNumber> {
  let date = ctx.get::<JsDate>(0)?;
  ctx.env.create_double(date.value_of()?)
}
