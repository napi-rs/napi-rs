use std::convert::TryInto;

use napi::{bindgen_prelude::External, CallContext, JsNumber, JsObject, Result};

struct NativeObject {
  count: i32,
}

#[js_function(1)]
pub fn create_external(ctx: CallContext) -> Result<External<NativeObject>> {
  let count = ctx.get::<JsNumber>(0)?.try_into()?;
  let native = NativeObject { count };
  Ok(External::new(native))
}

#[js_function(1)]
pub fn create_external_with_hint(ctx: CallContext) -> Result<External<NativeObject>> {
  let count = ctx.get::<JsNumber>(0)?.try_into()?;
  let native = NativeObject { count };
  Ok(External::new_with_size_hint(native, 5))
}

#[js_function(1)]
pub fn get_external_count(ctx: CallContext) -> Result<JsNumber> {
  let attached_obj = ctx.get::<&External<NativeObject>>(0)?;
  ctx.env.create_int32(attached_obj.count)
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("createExternal", create_external)?;
  exports.create_named_method("createExternalWithHint", create_external_with_hint)?;
  exports.create_named_method("getExternalCount", get_external_count)?;
  Ok(())
}
