use napi::{Module, Result};

mod tsfn;

use tsfn::*;

pub fn register_js(module: &mut Module) -> Result<()> {
  // module.create_named_method("testTsfnError", test_tsfn_error)?;
  module.create_named_method("testThreadsafeFunction", test_threadsafe_function)?;
  // module.create_named_method("testTokioReadfile", test_tokio_readfile)?;
  Ok(())
}
