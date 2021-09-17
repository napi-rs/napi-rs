use std::convert::TryInto;

use napi::{CallContext, JsBoolean, JsDate, JsNumber, JsUnknown, Result};

#[js_function(1)]
pub fn test_object_is_date(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(obj.is_date()?)
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
