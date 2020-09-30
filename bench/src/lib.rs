#[macro_use]
extern crate napi;
#[macro_use]
extern crate napi_derive;

use napi::{Module, Result};

mod async_compute;
mod noop;
mod plus;

register_module!(bench, init);

fn init(module: &mut Module) -> Result<()> {
  module.create_named_method("noop", noop::noop)?;

  async_compute::register_js(module)?;
  plus::register_js(module)?;

  Ok(())
}
