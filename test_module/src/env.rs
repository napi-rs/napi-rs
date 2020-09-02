use napi::{CallContext, JsBoolean, JsUnknown, Module, Result};

#[js_function(2)]
pub fn instanceof(ctx: CallContext) -> Result<JsBoolean> {
  let object = ctx.get::<JsUnknown>(0)?;
  let constructor = ctx.get::<JsUnknown>(1)?;
  ctx.env.get_boolean(object.instanceof(constructor)?)
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

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("instanceof", instanceof)?;
  module.create_named_method("isTypedarray", is_typedarray)?;
  module.create_named_method("isDataview", is_dataview)?;
  module.create_named_method("strictEquals", strict_equals)?;
  Ok(())
}
