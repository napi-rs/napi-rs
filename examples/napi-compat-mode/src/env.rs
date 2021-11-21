use napi::{
  CallContext, ContextlessResult, Env, JsBoolean, JsFunction, JsObject, JsString, JsUndefined,
  JsUnknown, Result,
};

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

#[js_function(1)]
pub fn cast_unknown(ctx: CallContext) -> Result<JsObject> {
  let arg: JsUnknown = ctx.get(0)?;
  Ok(unsafe { arg.cast::<JsObject>() })
}

#[contextless_function]
fn get_env_variable(env: Env) -> ContextlessResult<JsString> {
  env
    .create_string_from_std(std::env::var("npm_package_name").unwrap())
    .map(Some)
}

#[js_function(1)]
pub fn throw_syntax_error(ctx: CallContext) -> Result<JsUndefined> {
  let message: JsString = ctx.get(0)?;
  let syntax_error = ctx
    .env
    .get_global()?
    .get_named_property::<JsFunction>("SyntaxError")?;
  ctx.env.throw(syntax_error.new_instance(&[message])?)?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn coerce_to_bool(ctx: CallContext) -> Result<JsBoolean> {
  let arg: JsUnknown = ctx.get(0)?;
  arg.coerce_to_bool()
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("instanceof", instanceof)?;
  exports.create_named_method("isTypedarray", is_typedarray)?;
  exports.create_named_method("isDataview", is_dataview)?;
  exports.create_named_method("strictEquals", strict_equals)?;
  exports.create_named_method("castUnknown", cast_unknown)?;
  exports.create_named_method("getEnvVariable", get_env_variable)?;
  exports.create_named_method("throwSyntaxError", throw_syntax_error)?;
  exports.create_named_method("coerceToBool", coerce_to_bool)?;
  Ok(())
}
