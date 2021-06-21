#[macro_use]
extern crate napi_derive;

use napi::{Env, JsObject, Result};

#[cfg(all(
  target_arch = "x86_64",
  not(target_env = "musl"),
  not(debug_assertions)
))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod async_compute;
mod buffer;
mod create_array;
mod get_set_property;
mod get_value_from_js;
mod noop;
mod plus;
mod query;

#[module_exports]
fn init(mut exports: JsObject, env: Env) -> Result<()> {
  exports.create_named_method("noop", noop::noop)?;

  async_compute::register_js(&mut exports)?;
  buffer::register_js(&mut exports)?;
  plus::register_js(&mut exports)?;
  get_set_property::register_js(&mut exports, &env)?;
  create_array::register_js(&mut exports)?;
  get_value_from_js::register_js(&mut exports)?;
  query::register_js(&mut exports)?;

  Ok(())
}
