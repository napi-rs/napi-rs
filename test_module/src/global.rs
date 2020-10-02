use std::convert::TryInto;

use napi::{CallContext, JsFunction, JsNumber, JsTimeout, Module, Result};

#[js_function(2)]
pub fn set_timeout(ctx: CallContext) -> Result<JsTimeout> {
  let handler: JsFunction = ctx.get(0)?;
  let timeout: JsNumber = ctx.get(1)?;
  ctx
    .env
    .get_global()?
    .set_timeout(handler, timeout.try_into()?)
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("setTimeout", set_timeout)?;
  Ok(())
}
