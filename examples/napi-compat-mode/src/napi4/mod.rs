use napi::{bindgen_prelude::Unknown, Env, JsObject, Property, Result};

mod deferred;
mod tsfn;
mod tsfn_dua_instance;

use tsfn::*;
use tsfn_dua_instance::*;

pub fn register_js(exports: &mut JsObject, env: &Env) -> Result<()> {
  exports.create_named_method("testThreadsafeFunction", test_threadsafe_function)?;
  exports.create_named_method("testTsfnError", test_tsfn_error)?;
  exports.create_named_method("testTokioReadfile", test_tokio_readfile)?;
  exports.create_named_method("testTsfnWithRef", test_tsfn_with_ref)?;
  exports.create_named_method("testDeferred", deferred::test_deferred)?;

  let obj = env.define_class::<Unknown>(
    "A",
    constructor,
    &[Property::new().with_utf8_name("call")?.with_method(call)],
  )?;

  exports.set_named_property("A", obj)?;
  Ok(())
}
