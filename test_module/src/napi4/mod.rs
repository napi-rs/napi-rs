use napi::{Module, Result};

mod tsfn;

use tsfn::*;

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("testThreadsafeFunction", test_threadsafe_function)?;
  module.create_named_method("testTsfnError", test_tsfn_error)?;
  module.create_named_method("testTokioReadfile", test_tokio_readfile)?;
  module.create_named_method(
    "testAbortThreadsafeFunction",
    test_abort_threadsafe_function,
  )?;
  module.create_named_method(
    "testAbortIndependentThreadsafeFunction",
    test_abort_independent_threadsafe_function,
  )?;
  module.create_named_method(
    "testCallAbortedThreadsafeFunction",
    test_call_aborted_threadsafe_function,
  )?;
  Ok(())
}
