use napi::{JsFunction, CallContext, JsNull, Result, JsObject};

#[js_function(1)]
pub fn call_function(ctx: CallContext) -> Result<JsNull> {
  let js_func = ctx.get::<JsFunction>(0)?;
  let js_string_hello = ctx.env.create_string("hello".as_ref())?.into_unknown()?;
  let js_string_world = ctx.env.create_string("world".as_ref())?.into_unknown()?;

  js_func.call(None, &[js_string_hello, js_string_world])?;

  ctx.env.get_null()
}

#[js_function(1)]
pub fn call_function_with_this(ctx: CallContext<JsObject>) -> Result<JsNull> {
  let js_this = ctx.this;
  let js_func = ctx.get::<JsFunction>(0)?;

  js_func.call(Some(&js_this), &[])?;

  ctx.env.get_null()
}
