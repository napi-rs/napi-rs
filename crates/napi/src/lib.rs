#![deny(clippy::all)]
#![allow(non_upper_case_globals)]

//! High level Node.js [N-API](https://nodejs.org/api/n-api.html) binding
//!
//! **napi-rs** provides minimal overhead to write N-API modules in `Rust`.
//!
//! ## Feature flags
//!
//! ### napi1 ~ napi10
//!
//! Because `Node.js` N-API has versions. So there are feature flags to choose what version of `N-API` you want to build for.
//! For example, if you want build a library which can be used by `node@10.17.0`, you should choose the `napi5` or lower.
//!
//! The details of N-API versions and support matrix: [Node-API version matrix](https://nodejs.org/api/n-api.html#node-api-version-matrix)
//!
//! ### tokio_rt
//! With `tokio_rt` feature, `napi-rs` provides a ***tokio runtime*** (a separate worker thread
//! on native targets; a current-thread runtime on wasm, or a multi-thread runtime on wasm
//! when the `tokio_unstable` cfg is set).
//! And you can easily run tokio `future` in it and return `promise`.
//!
//! ```
//! use futures::prelude::*;
//! use napi::bindgen_prelude::*;
//! use tokio;
//!
//! #[napi]
//! pub fn tokio_readfile(js_filepath: String) -> Result<Buffer> {
//!     ctx.env.spawn_future_with_callback(
//!         tokio::fs::read(js_filepath)
//!           .map(|v| v.map_err(|e| Error::new(Status::Unknown, format!("failed to read file, {}", e)))),
//!         |_, data| data.into(),
//!     )
//! }
//! ```
//!
//! ### async-runtime
//!
//! The `async-runtime` feature exposes an additive service-provider interface. An addon may call
//! `register_async_runtime` from `#[module_init]` to select its own executor before the first
//! environment is activated. In a combined `async-runtime` + `tokio_rt` build, omitting
//! registration selects the built-in Tokio runtime for generated JavaScript-facing futures and
//! generated `#[napi(async_runtime)]` entry guards. A pure `async-runtime` addon may omit
//! registration and still load and expose synchronous APIs; runtime-backed operations then return
//! a clear missing-backend error. If no custom backend is registered, the registration window
//! closes when napi begins activating the first environment, or earlier when a runtime-backed
//! operation commits a backend choice. A missing-backend error before any environment is activated
//! leaves selection undecided and does not prevent later registration.
//!
//! The established free `spawn`, `spawn_blocking`, `block_on`, and
//! `within_runtime_if_available` APIs remain Tokio-backed whenever `tokio_rt` is enabled.
//! Selecting or activating a custom backend in a combined build does not construct Tokio; the
//! first call to one of those compatibility APIs creates the Tokio runtime lazily, and later calls
//! reuse that generation until shutdown. On threadless `wasm32-wasip1`, `spawn` and
//! `spawn_blocking` panic immediately because the built-in current-thread Tokio runtime has no
//! background driver and native blocking threads are unavailable; use a registered custom runtime
//! or `wasm32-wasip1-threads`.
//! `spawn_on_custom_runtime`, `spawn_blocking_on_custom_runtime`,
//! `block_on_custom_runtime`, and `try_block_on_custom_runtime` explicitly require a registered
//! custom backend. Current `napi-derive` v4 `#[napi(async_runtime)]` callbacks use the selected
//! backend: custom when registered in time, otherwise Tokio in a combined build. The previously
//! released `napi-derive` 3.5.9 synchronous `#[napi(async_runtime)]` guard called the established
//! `within_runtime_if_available` compatibility helper, so it enters Tokio when both features are
//! enabled; its generated async exports still use the selected backend. Use a pure
//! `async-runtime` build or upgrade the derive crate when synchronous custom-runtime entry is
//! required. A pure `async-runtime` build remains tokio-free (enable the `tokio` feature
//! explicitly if you still want the `napi::tokio` re-export). The public
//! `execute_tokio_future` function and deprecated
//! `Env::execute_tokio_future` method remain available only with `tokio_rt` and always use the
//! built-in Tokio runtime.
//!
//! `spawn_on_custom_runtime` and `spawn_blocking_on_custom_runtime` return napi-owned joinable
//! handles over the corresponding `AsyncRuntime` submission hooks. When a backend declines work,
//! its `AsyncRuntimeRejection` error is preserved as the handle's rejection diagnostic. Backends
//! may synchronously drive a submitted task or blocking closure inside the corresponding hook; the
//! first poll or invocation commits acceptance. napi does not create an unbounded fallback thread.
//! Under the `noop` feature the explicit custom-runtime helpers are unavailable to callers.
//! Explicit shutdown also closes synchronous custom-runtime block-on and entry until restart;
//! shutdown waits for an entry already in progress to return and drop its runtime guard. Exported
//! callbacks should use `try_block_on_custom_runtime` when they require custom routing and need a
//! JavaScript exception instead of the compatibility wrapper's Rust panic.
//!
//! ### Thread-safe function teardown
//!
//! `ThreadsafeFunction::register_finalizer`,
//! `ThreadsafeFunctionBuilder::build_callback_with_finalizer`, and
//! `ThreadsafeFunctionBuilder::build_with_finalizer` are unsafe lifecycle APIs. Before their
//! finalizer returns, including if it unwinds, it must quiesce every native thread or task that can
//! call, clone, or drop the thread-safe function or otherwise execute addon code. It must not wait
//! for JavaScript callbacks or queued thread-safe function payloads, because hosts may drain them
//! only after the native finalizer returns.
//!
//! Thread-safe functions are referenced by default. If natural environment teardown must invoke a
//! finalizer to stop a worker that retains the thread-safe function, build it with `.weak::<true>()`
//! or explicitly unref it first; otherwise the reference can keep the event loop alive and prevent
//! the finalizer from running.
//!
//! `ThreadsafeFunction::abort` takes `&self` and is shared and idempotent. Call it directly through
//! a borrow or `Arc`; do not clone a thread-safe function merely to give `abort` ownership.
//!
//! ### latin1
//!
//! Decode latin1 string from JavaScript using [encoding_rs](https://docs.rs/encoding_rs).
//!
//! With this feature, you can use `JsString.as_latin1_string` function
//!
//! ### serde-json
//!
//! Enable Serialize/Deserialize data cross `JavaScript Object` and `Rust struct`.
//!
//! ```
//! #[derive(Serialize, Debug, Deserialize)]
//! struct AnObject {
//!     a: u32,
//!     b: Vec<f64>,
//!     c: String,
//! }
//!
//! #[napi]
//! fn deserialize_from_js(arg0: JsUnknown) -> Result<JsUndefined> {
//!     let de_serialized: AnObject = ctx.env.from_js_value(arg0)?;
//!     ...
//! }
//!
//! #[napi]
//! fn serialize(env: Env) -> Result<JsUnknown> {
//!     let value = AnyObject { a: 1, b: vec![0.1, 2.22], c: "hello" };
//!     env.to_js_value(&value)
//! }
//! ```
//!

#[cfg(all(target_family = "wasm", not(feature = "noop"), feature = "napi3"))]
#[link(wasm_import_module = "napi")]
extern "C" {
  fn napi_add_env_cleanup_hook(
    env: sys::napi_env,
    fun: Option<unsafe extern "C" fn(arg: *mut core::ffi::c_void)>,
    arg: *mut core::ffi::c_void,
  ) -> sys::napi_status;
  fn napi_remove_env_cleanup_hook(
    env: sys::napi_env,
    fun: Option<unsafe extern "C" fn(arg: *mut core::ffi::c_void)>,
    arg: *mut core::ffi::c_void,
  ) -> sys::napi_status;
}

#[cfg(feature = "napi8")]
mod async_cleanup_hook;
#[cfg(feature = "napi8")]
pub use async_cleanup_hook::AsyncCleanupHook;
mod async_work;
mod bindgen_runtime;
#[cfg(feature = "compat-mode")]
mod call_context;
#[cfg(feature = "napi3")]
mod cleanup_env;
mod env;
mod error;
mod js_values;
mod status;
mod task;
#[cfg(all(
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
mod tokio_runtime;
mod value_type;
#[cfg(feature = "napi3")]
pub use cleanup_env::CleanupEnvHook;
#[cfg(not(feature = "noop"))]
mod sendable_resolver;
#[cfg(feature = "napi4")]
pub mod threadsafe_function;
#[cfg(not(feature = "noop"))]
pub use sendable_resolver::SendableResolver;

mod version;

pub use napi_sys as sys;

pub use async_work::AsyncWorkPromise;
#[cfg(feature = "compat-mode")]
pub use call_context::CallContext;

pub use bindgen_runtime::iterator;
pub use env::*;
pub use error::*;
pub use js_values::*;
pub use status::Status;
pub use task::{ScopedTask, Task};
pub use value_type::*;
pub use version::NodeVersion;
#[cfg(feature = "serde-json")]
#[macro_use]
extern crate serde;

pub type ContextlessResult<T> = Result<Option<T>>;

#[doc(hidden)]
#[macro_export(local_inner_macros)]
macro_rules! type_of {
  ($env:expr, $value:expr) => {{
    let mut value_type = 0;
    #[allow(unused_unsafe)]
    check_status!(unsafe { $crate::sys::napi_typeof($env, $value, &mut value_type) })
      .and_then(|_| Ok($crate::ValueType::from(value_type)))
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! assert_type_of {
  ($env: expr, $value:expr, $value_ty: expr) => {
    $crate::type_of!($env, $value).and_then(|received_type| {
      if received_type == $value_ty {
        Ok(())
      } else {
        Err($crate::Error::new(
          $crate::Status::InvalidArg,
          format!(
            "Expect value to be {}, but received {}",
            $value_ty, received_type
          ),
        ))
      }
    })
  };
}

pub mod bindgen_prelude {
  #[cfg(all(feature = "compat-mode", not(feature = "noop")))]
  pub use crate::bindgen_runtime::register_module_exports;
  #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
  pub use crate::tokio_runtime::*;
  pub use crate::{
    assert_type_of, bindgen_runtime::*, check_pending_exception, check_status,
    check_status_or_throw, error, error::*, sys, type_of, JsError, JsValue, Property,
    PropertyAttributes, Result, Status, Task, ValueType,
  };
  #[cfg(feature = "tracing")]
  pub use ::tracing;

  /// Emit NAPI call tracing through one shared callsite.
  ///
  /// Keep this out of line: every generated NAPI wrapper calls this function, and inlining the
  /// tracing macro would duplicate its static callsite metadata in every wrapper.
  #[cfg(feature = "tracing")]
  #[doc(hidden)]
  #[inline(never)]
  pub fn trace_napi_call(name: &'static str) {
    ::tracing::debug!(target: "napi", "{}", name);
  }

  // This function's signature must be kept in sync with the one in tokio_runtime.rs, otherwise napi
  // will fail to compile without the `tokio_rt` feature.

  /// If the feature `tokio_rt` has been enabled this will enter the runtime context and
  /// then call the provided closure. Otherwise it will just call the provided closure.
  #[cfg(not(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  )))]
  pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
    f()
  }

  #[doc(hidden)]
  #[cfg(not(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  )))]
  pub fn within_selected_async_runtime<F: FnOnce() -> crate::Result<T>, T>(
    f: F,
  ) -> crate::Result<T> {
    f()
  }

  /// Compatibility entry point used by previously released `napi-derive` code.
  #[doc(hidden)]
  pub fn within_custom_runtime_if_available<F: FnOnce() -> crate::Result<T>, T>(
    f: F,
  ) -> crate::Result<T> {
    within_selected_async_runtime(f)
  }
}

#[doc(hidden)]
pub mod __private {
  pub use crate::bindgen_runtime::{
    get_class_constructor, get_class_constructor_for_env, get_class_constructor_for_env_by_type,
    iterator::create_iterator, register_class, ___CALL_FROM_FACTORY,
  };

  #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
  pub use crate::bindgen_runtime::async_iterator::create_async_iterator;

  /// Versioned contract between generated `napi-derive` code and napi's selected async runtime.
  ///
  /// Code generation must move to a new module version when these signatures or routing semantics
  /// change. Older generated async functions continue to use their existing compatibility entry
  /// points.
  #[doc(hidden)]
  pub mod async_runtime_v1 {
    pub const CONTRACT_VERSION: u32 = 1;

    #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
    pub use crate::tokio_runtime::within_selected_async_runtime;

    #[cfg(not(any(feature = "tokio_rt", feature = "async-runtime")))]
    pub use crate::bindgen_prelude::within_selected_async_runtime;
  }

  /// Versioned contract used by current `napi-derive` output.
  ///
  /// Previously released derive code continues to use the legacy hidden exports above. New code
  /// generation must only add dependencies through a versioned module so runtime/derive release
  /// compatibility can be tested explicitly.
  #[doc(hidden)]
  pub mod codegen_v1 {
    pub const CONTRACT_VERSION: u32 = 1;

    pub const fn assert_contract_version(version: u32) {
      assert!(
        version == CONTRACT_VERSION,
        "incompatible napi codegen contract"
      );
    }

    pub use super::async_runtime_v1::within_selected_async_runtime;
    pub use crate::bindgen_runtime::iterator::try_create_iterator as create_iterator;
    pub use crate::bindgen_runtime::{
      acquire_native_borrow, get_class_constructor_for_env_by_type, new_instance_with_owned_value,
      register_native_borrow, register_native_borrow_with_value, NativeBorrowBarrier,
      NativeBorrowScope,
    };
    #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
    pub use crate::tokio_runtime::execute_async_future_with_finalize_callback;

    #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
    pub use crate::bindgen_runtime::async_iterator::try_create_async_iterator as create_async_iterator;

    pub unsafe fn try_new_class_instance<'env, T: 'env>(
      value: crate::sys::napi_value,
      env: crate::sys::napi_env,
      inner: *mut T,
    ) -> crate::Result<crate::bindgen_runtime::ClassInstance<'env, T>> {
      unsafe { crate::bindgen_runtime::ClassInstance::try_new(value, env, inner) }
    }
  }

  use crate::sys;

  pub unsafe fn log_js_value<V: AsRef<[sys::napi_value]>>(
    // `info`, `log`, `warning` or `error`
    method: &str,
    env: sys::napi_env,
    values: V,
  ) {
    use std::ffi::CString;
    use std::ptr;

    let mut g = ptr::null_mut();
    unsafe { sys::napi_get_global(env, &mut g) };
    let mut console = ptr::null_mut();
    let console_c_string = CString::new("console").unwrap();
    let method_c_string = CString::new(method).unwrap();
    unsafe { sys::napi_get_named_property(env, g, console_c_string.as_ptr(), &mut console) };
    let mut method_js_fn = ptr::null_mut();
    unsafe {
      sys::napi_get_named_property(env, console, method_c_string.as_ptr(), &mut method_js_fn)
    };
    unsafe {
      sys::napi_call_function(
        env,
        console,
        method_js_fn,
        values.as_ref().len(),
        values.as_ref().as_ptr(),
        ptr::null_mut(),
      )
    };
  }
}

pub extern crate ctor;

#[cfg(feature = "tokio")]
pub extern crate tokio;

#[cfg(feature = "error_anyhow")]
pub extern crate anyhow;

#[cfg(feature = "web_stream")]
pub extern crate futures_core;
#[cfg(feature = "web_stream")]
pub extern crate tokio_stream;
