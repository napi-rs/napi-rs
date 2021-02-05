#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

use napi::{Env, JsObject, Result};

mod cleanup_env;
#[cfg(feature = "latest")]
mod napi4;
#[cfg(feature = "latest")]
mod napi5;
#[cfg(feature = "latest")]
mod napi6;
#[cfg(feature = "latest")]
mod tokio_rt;

mod array;
mod arraybuffer;
mod buffer;
mod class;
mod either;
mod env;
mod error;
mod external;
mod function;
mod global;
mod napi_version;
mod object;
mod serde;
mod string;
mod symbol;
mod task;

use napi_version::get_napi_version;

#[module_exports]
fn init(mut exports: JsObject, env: Env) -> Result<()> {
  exports.create_named_method("getNapiVersion", get_napi_version)?;
  array::register_js(&mut exports)?;
  error::register_js(&mut exports)?;
  string::register_js(&mut exports)?;
  serde::register_js(&mut exports)?;
  task::register_js(&mut exports)?;
  external::register_js(&mut exports)?;
  arraybuffer::register_js(&mut exports)?;
  buffer::register_js(&mut exports)?;
  either::register_js(&mut exports)?;
  symbol::register_js(&mut exports)?;
  function::register_js(&mut exports, &env)?;
  class::register_js(&mut exports)?;
  env::register_js(&mut exports)?;
  object::register_js(&mut exports)?;
  global::register_js(&mut exports)?;
  cleanup_env::register_js(&mut exports)?;
  #[cfg(feature = "latest")]
  napi4::register_js(&mut exports)?;
  #[cfg(feature = "latest")]
  tokio_rt::register_js(&mut exports)?;
  #[cfg(feature = "latest")]
  napi5::register_js(&mut exports)?;
  #[cfg(feature = "latest")]
  napi6::register_js(&mut exports)?;
  Ok(())
}
