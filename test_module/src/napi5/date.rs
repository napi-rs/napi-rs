use napi::{CallContext, JsBoolean, JsUnknown, Result};

#[js_function(1)]
pub fn test_object_is_date(ctx: CallContext) -> Result<JsBoolean> {
  let obj = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(obj.is_date()?)
}
