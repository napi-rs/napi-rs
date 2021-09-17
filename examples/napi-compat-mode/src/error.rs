use napi::{CallContext, Error, JsBoolean, JsObject, JsString, JsUnknown, Result, Status};

#[js_function]
fn test_throw(_ctx: CallContext) -> Result<JsUnknown> {
  Err(Error::from_status(Status::GenericFailure))
}

#[js_function(1)]
fn test_throw_with_reason(ctx: CallContext) -> Result<JsUnknown> {
  let reason = ctx.get::<JsString>(0)?;
  Err(Error::new(
    Status::GenericFailure,
    reason.into_utf8()?.into_owned()?,
  ))
}

#[js_function]
pub fn test_throw_with_panic(_ctx: CallContext) -> Result<JsUnknown> {
  panic!("don't panic.");
}

#[js_function(1)]
pub fn is_error(ctx: CallContext) -> Result<JsBoolean> {
  let js_value = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(js_value.is_error()?)
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testThrow", test_throw)?;
  exports.create_named_method("testThrowWithReason", test_throw_with_reason)?;
  exports.create_named_method("isError", is_error)?;
  Ok(())
}
