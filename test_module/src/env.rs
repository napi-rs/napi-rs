use napi::{CallContext, JsBoolean, JsObject, JsUnknown, Result};

#[js_function(2)]
pub fn instanceof(ctx: CallContext) -> Result<JsBoolean> {
  let object = ctx.get::<JsUnknown>(0)?;
  let constructor = ctx.get::<JsUnknown>(1)?;
  ctx.env.get_boolean(object.instanceof(&constructor)?)
}

#[js_function(1)]
pub fn is_typedarray(ctx: CallContext) -> Result<JsBoolean> {
  let js_value = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(js_value.is_typedarray()?)
}

#[js_function(1)]
pub fn is_dataview(ctx: CallContext) -> Result<JsBoolean> {
  let js_value = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(js_value.is_dataview()?)
}

#[js_function(2)]
pub fn strict_equals(ctx: CallContext) -> Result<JsBoolean> {
  let a: JsUnknown = ctx.get(0)?;
  let b: JsUnknown = ctx.get(1)?;
  ctx.env.get_boolean(ctx.env.strict_equals(a, b)?)
}

#[js_function(1)]
pub fn cast_unknown(ctx: CallContext) -> Result<JsObject> {
  let arg: JsUnknown = ctx.get(0)?;
  Ok(unsafe { arg.cast::<JsObject>() })
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("instanceof", instanceof)?;
  exports.create_named_method("isTypedarray", is_typedarray)?;
  exports.create_named_method("isDataview", is_dataview)?;
  exports.create_named_method("strictEquals", strict_equals)?;
  exports.create_named_method("castUnknown", cast_unknown)?;
  Ok(())
}
