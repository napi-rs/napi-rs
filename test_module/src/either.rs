use std::convert::TryInto;

use napi::{CallContext, Either, JsNumber, JsString, Result};

#[js_function(1)]
pub fn either_number_string(ctx: CallContext) -> Result<Either<JsNumber, JsString>> {
  let arg = ctx.get::<Either<JsNumber, JsString>>(0)?;
  match arg {
    Either::A(n) => {
      let n: u32 = n.try_into()?;
      ctx.env.create_uint32(n + 100).map(Either::A)
    }
    Either::B(s) => {
      let content = format!("Either::B({})", s.as_str()?);
      ctx.env.create_string_from_std(content).map(Either::B)
    }
  }
}

#[js_function(1)]
pub fn dynamic_argument_length(ctx: CallContext) -> Result<JsNumber> {
  let value: Option<JsNumber> = ctx.try_get::<JsNumber>(0)?.into();
  if let Some(n) = value {
    let n: u32 = n.try_into()?;
    ctx.env.create_uint32(n + 100)
  } else {
    ctx.env.create_uint32(42)
  }
}
