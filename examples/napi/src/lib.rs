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
use napi::bindgen_prelude::{Env, JsObjectValue, Object, Result, Symbol};
pub use napi_shared::*;

#[cfg(not(feature = "noop"))]
const LIFECYCLE_FIXTURE_GLOBAL: &str = "__NAPI_RS_LIFECYCLE_FIXTURE__";
#[cfg(not(feature = "noop"))]
const LIFECYCLE_FIXTURE_TOKEN_PROPERTY: &str = "__napiRsLifecycleFixtureToken";
#[cfg(not(feature = "noop"))]
const LIFECYCLE_FIXTURE_TOKEN: &str = "napi-rs-internal-lifecycle-fixture-v1";

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
static TOKIO_THREAD_STOP_BARRIER: Mutex<Option<(String, String, String)>> = Mutex::new(None);

#[cfg(not(target_family = "wasm"))]
#[napi_derive::module_init]
fn init() {
  let rt = tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .on_thread_start(|| {
      TOKIO_ACTIVE_THREAD_COUNT.fetch_add(1, Ordering::SeqCst);
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
    .unwrap();
  create_custom_tokio_runtime(rt);
}

#[cfg(not(target_family = "wasm"))]
#[napi(no_export)]
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
pub fn shutdown_runtime() {
  #[cfg(all(target_family = "wasm", tokio_unstable))]
  {
    napi::bindgen_prelude::shutdown_async_runtime();
  }
}

#[napi(module_exports)]
pub fn exports(mut export: Object, env: Env) -> Result<()> {
  let symbol = Symbol::for_desc("NAPI_RS_SYMBOL");
  export.set_named_property("NAPI_RS_SYMBOL", symbol)?;

  #[cfg(feature = "noop")]
  let _ = env;

  #[cfg(not(feature = "noop"))]
  {
    let global = env.get_global()?;
    if global.has_named_property(LIFECYCLE_FIXTURE_GLOBAL)? {
      let mut fixture: Object = global.get_named_property(LIFECYCLE_FIXTURE_GLOBAL)?;
      let enabled = fixture.has_named_property(LIFECYCLE_FIXTURE_TOKEN_PROPERTY)?
        && fixture.get_named_property::<String>(LIFECYCLE_FIXTURE_TOKEN_PROPERTY)?
          == LIFECYCLE_FIXTURE_TOKEN;
      if !enabled {
        return Ok(());
      }

      #[cfg(not(target_family = "wasm"))]
      fixture.create_named_method(
        "configureTokioThreadStopFileBarrier",
        configure_tokio_thread_stop_file_barrier_c_callback,
      )?;

      r#async::install_lifecycle_fixture(&mut fixture)?;
      class::install_lifecycle_fixture(&mut fixture)?;
      env::install_lifecycle_fixture(&mut fixture)?;
      error::install_lifecycle_fixture(&mut fixture)?;
      external::install_lifecycle_fixture(&mut fixture)?;
      string::install_lifecycle_fixture(&mut fixture)?;
      threadsafe_function::install_lifecycle_fixture(&mut fixture)?;

      #[cfg(not(target_family = "wasm"))]
      tokio_runtime_lifecycle::install_lifecycle_fixture(&mut fixture)?;
      #[cfg(target_family = "wasm")]
      tokio_wasi_lifecycle::install_lifecycle_fixture(&mut fixture)?;

      if fixture.has_named_property("moduleFinalizers")? {
        let probe_paths: Object = fixture.get_named_property("moduleFinalizers")?;
        object::install_module_finalizer_probes(&mut export, &probe_paths)?;
      }
    }
  }

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
#[cfg(not(target_family = "wasm"))]
mod tokio_runtime_lifecycle;
#[cfg(target_family = "wasm")]
mod tokio_wasi_lifecycle;
mod transparent;
mod r#type;
mod typed_array;
mod wasm;
