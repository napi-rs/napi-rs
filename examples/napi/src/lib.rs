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

#[cfg(all(not(target_family = "wasm"), not(target_os = "aix")))]
use napi::bindgen_prelude::create_custom_tokio_runtime_factory;
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
static TOKIO_ACTIVE_THREAD_COUNT: AtomicU32 = AtomicU32::new(0);
#[cfg(not(target_family = "wasm"))]
static TOKIO_RUNTIME_FACTORY_CALL_COUNT: AtomicU32 = AtomicU32::new(0);
#[cfg(not(target_family = "wasm"))]
static TOKIO_THREAD_STOP_BARRIER: Mutex<Option<(String, String, String)>> = Mutex::new(None);

#[cfg(all(not(target_family = "wasm"), not(target_os = "aix")))]
#[napi_derive::module_init]
fn init() {
  create_custom_tokio_runtime_factory(|| {
    TOKIO_RUNTIME_FACTORY_CALL_COUNT.fetch_add(1, Ordering::SeqCst);
    tokio::runtime::Builder::new_multi_thread()
      .enable_all()
      .on_thread_start(|| {
        TOKIO_ACTIVE_THREAD_COUNT.fetch_add(1, Ordering::SeqCst);
        #[cfg(not(feature = "noop"))]
        tokio_runtime_lifecycle::register_worker_tls_retirement_probe();
        let thread = std::thread::current();
        println!("tokio thread started {:?}", thread.name());
      })
      .on_thread_stop(|| {
        let barrier = TOKIO_THREAD_STOP_BARRIER
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .clone();
        if let Some((entered_path, release_path, completed_path)) = barrier {
          if std::fs::write(entered_path, b"entered").is_ok() {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
            while !std::path::Path::new(&release_path).exists()
              && std::time::Instant::now() < deadline
            {
              std::thread::sleep(std::time::Duration::from_millis(1));
            }
            if std::path::Path::new(&release_path).exists()
              && TOKIO_ACTIVE_THREAD_COUNT.fetch_sub(1, Ordering::SeqCst) == 1
            {
              let _ = std::fs::write(completed_path, b"completed");
            }
            return;
          }
        }
        TOKIO_ACTIVE_THREAD_COUNT.fetch_sub(1, Ordering::SeqCst);
      })
      .build()
  });
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn tokio_runtime_factory_call_count() -> u32 {
  TOKIO_RUNTIME_FACTORY_CALL_COUNT.load(Ordering::SeqCst)
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn configure_tokio_thread_stop_file_barrier(
  entered_path: String,
  release_path: String,
  completed_path: String,
) {
  *TOKIO_THREAD_STOP_BARRIER
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner) =
    Some((entered_path, release_path, completed_path));
}

#[napi]
/// This is a const
pub const DEFAULT_COST: u32 = 12;

#[napi(skip_typescript)]
pub const TYPE_SKIPPED_CONST: u32 = 12;

#[napi]
pub fn shutdown_runtime() -> Result<()> {
  #[cfg(all(not(target_family = "wasm"), not(feature = "noop")))]
  {
    napi::bindgen_prelude::try_shutdown_async_runtime()?;
    let retirement = napi::bindgen_prelude::tokio_runtime_retirement_waiter();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
      match retirement.wait() {
        Ok(()) => break,
        Err(error)
          if error.status == napi::Status::WouldDeadlock
            && std::time::Instant::now() < deadline =>
        {
          std::thread::sleep(std::time::Duration::from_millis(1));
        }
        Err(error) => return Err(error),
      }
    }
  }
  #[cfg(all(target_family = "wasm", tokio_unstable, not(feature = "noop")))]
  {
    napi::bindgen_prelude::shutdown_async_runtime();
  }
  Ok(())
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
#[cfg(not(target_family = "wasm"))]
mod async_work_lifecycle;
mod bigint;
mod borrowed_value;
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
#[cfg(napi_tsfn_public_behavior_test)]
mod threadsafe_function_browser;
#[cfg(all(not(target_family = "wasm"), not(feature = "noop")))]
mod tokio_runtime_lifecycle;
#[cfg(all(target_family = "wasm", not(feature = "noop")))]
mod tokio_wasi_lifecycle;
mod transparent;
mod r#type;
mod type_tag;
mod typed_array;
mod wasm;
