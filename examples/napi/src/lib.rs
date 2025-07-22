#![allow(dead_code)]
#![allow(unreachable_code)]
#![allow(clippy::disallowed_names)]
#![allow(clippy::uninlined_format_args)]
#![allow(clippy::new_without_default)]
#![allow(deprecated)]

#[cfg(not(target_family = "wasm"))]
use napi::bindgen_prelude::create_custom_tokio_runtime;
use napi::bindgen_prelude::{JsObjectValue, Object, Result, Symbol};
// pub use napi_shared::*;

#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

#[cfg(feature = "snmalloc")]
#[global_allocator]
static ALLOC: snmalloc_rs::SnMalloc = snmalloc_rs::SnMalloc;

#[cfg(not(target_family = "wasm"))]
#[napi_derive::module_init]
fn init() {
  use std::thread::current;

  let rt = tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .on_thread_start(|| {
      let thread = std::thread::current();
      println!("tokio thread started {:?}", thread.name());
    })
    .build()
    .unwrap();
  create_custom_tokio_runtime(rt);
}

#[napi]
/// This is a const
pub const DEFAULT_COST: u32 = 12;

#[napi(skip_typescript)]
pub const TYPE_SKIPPED_CONST: u32 = 12;

#[napi]
pub fn shutdown_runtime() {
  #[cfg(all(target_family = "wasm", tokio_unstable))]
  {
    napi::bindgen_prelude::shutdown_async_runtime();
  }
}

#[napi(module_exports)]
pub fn exports(mut export: Object) -> Result<()> {
  let symbol = Symbol::for_desc("NAPI_RS_SYMBOL");
  export.set_named_property("NAPI_RS_SYMBOL", symbol)?;
  Ok(())
}

mod array;
mod r#async;
mod bigint;
mod callback;
mod class;
mod class_factory;
mod constructor;
mod date;
mod either;
mod r#enum;
mod env;
mod error;
mod external;
mod fn_strict;
mod fn_ts_override;
mod function;
mod generator;
mod js_mod;
mod lifetime;
mod map;
mod nullable;
mod number;
mod object;
mod promise;
mod reference;
mod scope;
mod serde;
mod set;
mod shared;
mod stream;
mod string;
mod symbol;
mod task;
mod threadsafe_function;
mod transparent;
mod r#type;
mod typed_array;
