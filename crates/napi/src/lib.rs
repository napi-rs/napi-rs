#![deny(clippy::all)]
#![forbid(unsafe_op_in_unsafe_fn)]
#![allow(non_upper_case_globals)]

//! High level Node.js [N-API](https://nodejs.org/api/n-api.html) binding
//!
//! **napi-rs** provides minimal overhead to write N-API modules in `Rust`.
//!
//! ## Feature flags
//!
//! ### napi1 ~ napi8
//!
//! Because `Node.js` N-API has versions. So there are feature flags to choose what version of `N-API` you want to build for.
//! For example, if you want build a library which can be used by `node@10.17.0`, you should choose the `napi5` or lower.
//!
//! The details of N-API versions and support matrix: [n_api_version_matrix](https://nodejs.org/api/n-api.html#n_api_n_api_version_matrix)
//!
//! ### tokio_rt
//! With `tokio_rt` feature, `napi-rs` provides a ***tokio runtime*** in an additional thread.
//! And you can easily run tokio `future` in it and return `promise`.
//!
//! ```
//! use futures::prelude::*;
//! use napi::{CallContext, Error, JsObject, JsString, Result, Status};
//! use tokio;
//!
//! #[napi]
//! pub async fn tokio_readfile(js_filepath: String) -> Result<JsBuffer> {
//!     ctx.env.execute_tokio_future(
//!         tokio::fs::read(js_filepath)
//!           .map(|v| v.map_err(|e| Error::new(Status::Unknown, format!("failed to read file, {}", e)))),
//!         |&mut env, data| env.create_buffer_with_data(data),
//!     )
//! }
//! ```
//!
//! ***Tokio channel in `napi-rs` buffer size is default `100`.***
//!
//! ***You can adjust it via `NAPI_RS_TOKIO_CHANNEL_BUFFER_SIZE` environment variable***
//!
//! ```
//! NAPI_RS_TOKIO_CHANNEL_BUFFER_SIZE=1000 node ./app.js
//! ```
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

#[cfg(feature = "napi8")]
mod async_cleanup_hook;
#[cfg(feature = "napi8")]
pub use async_cleanup_hook::AsyncCleanupHook;
mod async_work;
mod bindgen_runtime;
mod call_context;
#[cfg(feature = "napi3")]
mod cleanup_env;
mod env;
mod error;
mod js_values;
mod status;
mod task;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
mod tokio_runtime;
mod value_type;
#[cfg(feature = "napi3")]
pub use cleanup_env::CleanupEnvHook;
#[cfg(feature = "napi4")]
pub mod threadsafe_function;
// #[cfg(target_arch = "wasm32")]
mod wasm_async_runtime;

mod version;

pub use napi_sys as sys;

pub use async_work::AsyncWorkPromise;
pub use call_context::CallContext;

pub use bindgen_runtime::iterator;
pub use env::*;
pub use error::*;
pub use js_values::*;
pub use status::Status;
pub use task::Task;
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

pub use crate::bindgen_runtime::ctor as module_init;

pub mod bindgen_prelude {
  #[cfg(all(feature = "compat-mode", not(feature = "noop")))]
  pub use crate::bindgen_runtime::register_module_exports;
  #[cfg(feature = "tokio_rt")]
  pub use crate::tokio_runtime::*;
  pub use crate::{
    assert_type_of, bindgen_runtime::*, check_pending_exception, check_status,
    check_status_or_throw, error, error::*, sys, type_of, JsError, Property, PropertyAttributes,
    Result, Status, Task, ValueType,
  };

  // This function's signature must be kept in sync with the one in tokio_runtime.rs, otherwise napi
  // will fail to compile without the `tokio_rt` feature.

  /// If the feature `tokio_rt` has been enabled this will enter the runtime context and
  /// then call the provided closure. Otherwise it will just call the provided closure.
  #[cfg(not(all(feature = "tokio_rt", feature = "napi4")))]
  pub fn within_runtime_if_available<F: FnOnce() -> T, T>(f: F) -> T {
    f()
  }
}

#[doc(hidden)]
pub mod __private {
  pub use crate::bindgen_runtime::{
    get_class_constructor, iterator::create_iterator, register_class, ___CALL_FROM_FACTORY,
  };

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

#[cfg(feature = "tokio_rt")]
pub extern crate tokio;

#[cfg(feature = "error_anyhow")]
pub extern crate anyhow;
