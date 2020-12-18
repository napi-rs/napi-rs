use napi::{JsObject, Result};

mod tsfn;

use tsfn::*;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testThreadsafeFunction", test_threadsafe_function)?;
  exports.create_named_method("testTsfnError", test_tsfn_error)?;
  exports.create_named_method("testTokioReadfile", test_tokio_readfile)?;
  exports.create_named_method(
    "testAbortThreadsafeFunction",
    test_abort_threadsafe_function,
  )?;
  exports.create_named_method(
    "testAbortIndependentThreadsafeFunction",
    test_abort_independent_threadsafe_function,
  )?;
  exports.create_named_method(
    "testCallAbortedThreadsafeFunction",
    test_call_aborted_threadsafe_function,
  )?;
  exports.create_named_method("testTsfnWithRef", test_tsfn_with_ref)?;
  Ok(())
}
