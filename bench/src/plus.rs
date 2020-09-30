use std::convert::TryInto;

use napi::{CallContext, JsNumber, Module, Result};

#[js_function(2)]
fn bench_plus(ctx: CallContext) -> Result<JsNumber> {
  let a: u32 = ctx.get::<JsNumber>(0)?.try_into()?;
  let b: u32 = ctx.get::<JsNumber>(1)?.try_into()?;
  ctx.env.create_uint32(a + b)
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("plus", bench_plus)?;
  Ok(())
}
