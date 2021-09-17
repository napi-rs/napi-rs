use napi::{CallContext, JsNumber, Result};

#[js_function]
pub fn get_napi_version(ctx: CallContext) -> Result<JsNumber> {
  ctx.env.create_uint32(ctx.env.get_napi_version()?)
}
