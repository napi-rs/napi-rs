#[macro_use]
extern crate napi_derive;

use napi::{Env, JsObject, Result};

#[cfg(all(unix, not(target_env = "musl"), not(target_arch = "aarch64")))]
#[global_allocator]
static ALLOC: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[cfg(windows)]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod async_compute;
mod buffer;
mod get_set_property;
mod noop;
mod plus;

#[module_exports]
fn init(mut exports: JsObject, env: Env) -> Result<()> {
  exports.create_named_method("noop", noop::noop)?;

  async_compute::register_js(&mut exports)?;
  buffer::register_js(&mut exports)?;
  plus::register_js(&mut exports)?;
  get_set_property::register_js(&mut exports, &env)?;

  Ok(())
}
