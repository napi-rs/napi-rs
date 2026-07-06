#![allow(dead_code)]
#![allow(unreachable_code)]
#![allow(clippy::disallowed_names)]
#![allow(clippy::uninlined_format_args)]
#![allow(clippy::new_without_default)]
#![allow(non_snake_case)]
#![allow(deprecated)]

#[cfg(not(target_family = "wasm"))]
use std::sync::{
  atomic::{AtomicU32, Ordering},
  Mutex,
};

#[cfg(not(target_family = "wasm"))]
use napi::bindgen_prelude::create_custom_tokio_runtime;
use napi::bindgen_prelude::{JsObjectValue, Object, Result, Symbol};
pub use napi_shared::*;

#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

#[cfg(feature = "snmalloc")]
#[global_allocator]
static ALLOC: snmalloc_rs::SnMalloc = snmalloc_rs::SnMalloc;

#[cfg(feature = "mimalloc")]
#[global_allocator]
static ALLOC: mimalloc_safe::MiMalloc = mimalloc_safe::MiMalloc;

#[cfg(not(target_family = "wasm"))]
static TOKIO_THREAD_STOP_COUNT: AtomicU32 = AtomicU32::new(0);
#[cfg(not(target_family = "wasm"))]
static TOKIO_THREAD_STOP_BARRIER: Mutex<Option<(String, String)>> = Mutex::new(None);

#[cfg(not(target_family = "wasm"))]
#[napi_derive::module_init]
fn init() {
  let rt = tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .on_thread_start(|| {
      let thread = std::thread::current();
      println!("tokio thread started {:?}", thread.name());
    })
    .on_thread_stop(|| {
      TOKIO_THREAD_STOP_COUNT.fetch_add(1, Ordering::SeqCst);
      let barrier = TOKIO_THREAD_STOP_BARRIER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
      let Some((entered_path, release_path)) = barrier else {
        return;
      };
      if std::fs::write(entered_path, b"entered").is_err() {
        return;
      }
      let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
      while !std::path::Path::new(&release_path).exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(1));
      }
    })
    .build()
    .unwrap();
  create_custom_tokio_runtime(rt);
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn configure_tokio_thread_stop_file_barrier(entered_path: String, release_path: String) {
  *TOKIO_THREAD_STOP_BARRIER
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((entered_path, release_path));
}

#[cfg(not(target_family = "wasm"))]
#[napi(skip_typescript)]
pub fn tokio_thread_stop_count() -> u32 {
  TOKIO_THREAD_STOP_COUNT.load(Ordering::SeqCst)
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
mod async_generator_repro;
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
#[cfg(not(target_family = "wasm"))]
mod fetch;
mod fn_return_if_invalid;
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
mod wasm;
