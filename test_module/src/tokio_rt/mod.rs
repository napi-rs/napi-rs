use napi::{Module, Result};

mod read_file;

use read_file::*;

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("testExecuteTokioReadfile", test_execute_tokio_readfile)?;
  module.create_named_method("testTokioError", error_from_tokio_future)?;
  Ok(())
}
