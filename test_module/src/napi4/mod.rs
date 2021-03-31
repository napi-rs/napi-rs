use napi::{Env, JsObject, Result};

mod tsfn;
mod tsfn_dua_instance;

use tsfn::*;
use tsfn_dua_instance::constructor;

pub fn register_js(exports: &mut JsObject, env: &Env) -> Result<()> {
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

  let obj = env.define_class("A", constructor, &[])?;

  exports.set_named_property("A", obj)?;
  Ok(())
}
