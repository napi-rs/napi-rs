#[macro_use]
extern crate napi_derive;

use napi::{JsObject, Result};

mod async_compute;
mod noop;
mod plus;

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
  exports.create_named_method("noop", noop::noop)?;

  async_compute::register_js(&mut exports)?;
  plus::register_js(&mut exports)?;

  Ok(())
}
