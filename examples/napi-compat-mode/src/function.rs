use napi::{CallContext, JsError, JsFunction, JsNull, JsObject, JsUnknown, Result};

#[js_function(1)]
pub fn call_function(ctx: CallContext) -> Result<JsNull> {
  let js_func = ctx.get::<JsFunction>(0)?;
  let js_string_hello = ctx.env.create_string("hello".as_ref())?.into_unknown();
  let js_string_world = ctx.env.create_string("world".as_ref())?.into_unknown();

  js_func.call(None, &[js_string_hello, js_string_world])?;

  ctx.env.get_null()
}

#[js_function(1)]
pub fn call_function_with_ref_arguments(ctx: CallContext) -> Result<JsNull> {
  let js_func = ctx.get::<JsFunction>(0)?;
  let js_string_hello = ctx.env.create_string("hello".as_ref())?;
  let js_string_world = ctx.env.create_string("world".as_ref())?;

  js_func.call(None, &[&js_string_hello, &js_string_world])?;

  ctx.env.get_null()
}

#[js_function(1)]
pub fn call_function_with_this(ctx: CallContext) -> Result<JsNull> {
  let js_this: JsObject = ctx.this_unchecked();
  let js_func = ctx.get::<JsFunction>(0)?;

  js_func.call_without_args(Some(&js_this))?;

  ctx.env.get_null()
}

#[js_function(2)]
pub fn call_function_error(ctx: CallContext) -> Result<JsUnknown> {
  let js_func = ctx.get::<JsFunction>(0)?;
  let error_func = ctx.get::<JsFunction>(1)?;

  match js_func.call_without_args(None) {
    Ok(v) => Ok(v),
    Err(e) => error_func.call(None, &[JsError::from(e).into_unknown(*ctx.env)]),
  }
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testCallFunction", call_function)?;
  exports.create_named_method(
    "testCallFunctionWithRefArguments",
    call_function_with_ref_arguments,
  )?;
  exports.create_named_method("testCallFunctionWithThis", call_function_with_this)?;
  exports.create_named_method("testCallFunctionError", call_function_error)?;
  Ok(())
}
