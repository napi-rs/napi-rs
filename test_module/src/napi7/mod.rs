use napi::{JsObject, Result};

mod buffer;

use buffer::*;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testDetachArrayBuffer", detach_arraybuffer)?;
  exports.create_named_method("testIsDetachedArrayBuffer", is_detach_arraybuffer)?;
  Ok(())
}
