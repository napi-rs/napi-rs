#[macro_use]
extern crate napi;
#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

use napi::{Module, Result};

#[cfg(feature = "napi3")]
mod cleanup_env;
#[cfg(feature = "napi4")]
mod libuv;
#[cfg(feature = "napi4")]
mod napi4;
#[cfg(feature = "napi5")]
mod napi5;
#[cfg(feature = "napi6")]
mod napi6;
#[cfg(feature = "napi4")]
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

register_module!(test_module, init);

fn init(module: &mut Module) -> Result<()> {
  module.create_named_method("getNapiVersion", get_napi_version)?;
  array::register_js(module)?;
  error::register_js(module)?;
  string::register_js(module)?;
  serde::register_js(module)?;
  task::register_js(module)?;
  external::register_js(module)?;
  arraybuffer::register_js(module)?;
  buffer::register_js(module)?;
  either::register_js(module)?;
  symbol::register_js(module)?;
  function::register_js(module)?;
  class::register_js(module)?;
  env::register_js(module)?;
  object::register_js(module)?;
  global::register_js(module)?;
  #[cfg(feature = "napi3")]
  cleanup_env::register_js(module)?;
  #[cfg(feature = "napi4")]
  napi4::register_js(module)?;
  #[cfg(feature = "napi4")]
  tokio_rt::register_js(module)?;
  #[cfg(feature = "napi4")]
  libuv::read_file::register_js(module)?;
  #[cfg(feature = "napi5")]
  napi5::register_js(module)?;
  #[cfg(feature = "napi6")]
  napi6::register_js(module)?;
  Ok(())
}
