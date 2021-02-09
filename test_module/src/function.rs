use napi::*;

#[js_function(1)]
pub fn call_function(ctx: CallContext) -> Result<JsNull> {
  let js_func = ctx.get::<JsFunction>(0)?;
  let js_string_hello = ctx.env.create_string("hello".as_ref())?.into_unknown();
  let js_string_world = ctx.env.create_string("world".as_ref())?.into_unknown();

  js_func.call(None, &[js_string_hello, js_string_world])?;

  ctx.env.get_null()
}

#[js_function(1)]
pub fn call_function_with_this(ctx: CallContext) -> Result<JsNull> {
  let js_this: JsObject = ctx.this_unchecked();
  let js_func = ctx.get::<JsFunction>(0)?;

  js_func.call(Some(&js_this), &[])?;

  ctx.env.get_null()
}

#[js_function(1)]
pub fn function_with_string_context(ctx: CallContext) -> Result<JsBoolean> {
  let utf8_string = ctx.get::<JsString>(0)?.into_utf8()?;
  let context = ctx.context_ref_unchecked::<String>();
  ctx.env.get_boolean(utf8_string.as_str()? == context)
}

pub fn register_js(exports: &mut JsObject, env: &Env) -> Result<()> {
  exports.create_named_method("testCallFunction", call_function)?;
  exports.create_named_method("testCallFunctionWithThis", call_function_with_this)?;

  let (func_with_string_context, _) = env.create_function_with_context(
    "functionWithStringContext",
    "1".to_owned(),
    function_with_string_context,
  )?;

  exports.set_named_property("functionWithStringContext", func_with_string_context)?;
  Ok(())
}
