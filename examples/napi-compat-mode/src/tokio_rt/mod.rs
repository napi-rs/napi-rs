use napi::{JsObject, Result};

mod read_file;

use read_file::*;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testExecuteTokioReadfile", test_execute_tokio_readfile)?;
  exports.create_named_method("testTokioError", error_from_tokio_future)?;
  Ok(())
}
