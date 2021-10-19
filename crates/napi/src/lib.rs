#![deny(clippy::all)]

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
//! #[js_function(1)]
//! pub fn tokio_readfile(ctx: CallContext) -> Result<JsObject> {
//!     let js_filepath = ctx.get::<JsString>(0)?;
//!     let path_str = js_filepath.as_str()?;
//!     ctx.env.execute_tokio_future(
//!         tokio::fs::read(path_str.to_owned())
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
//! #[js_function(1)]
//! fn deserialize_from_js(ctx: CallContext) -> Result<JsUndefined> {
//!     let arg0 = ctx.get::<JsUnknown>(0)?;
//!     let de_serialized: AnObject = ctx.env.from_js_value(arg0)?;
//!     ...
//! }
//!
//! #[js_function]
//! fn serialize(ctx: CallContext) -> Result<JsUnknown> {
//!     let value = AnyObject { a: 1, b: vec![0.1, 2.22], c: "hello" };
//!     ctx.env.to_js_value(&value)
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

#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
mod promise;
mod status;
mod task;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
mod tokio_runtime;
mod value_type;
#[cfg(feature = "napi3")]
pub use cleanup_env::CleanupEnvHook;
#[cfg(feature = "napi4")]
pub mod threadsafe_function;

mod version;
#[cfg(target_os = "windows")]
mod win_delay_load_hook;

pub use napi_sys as sys;

pub use async_work::AsyncWorkPromise;
pub use call_context::CallContext;

pub use env::*;
pub use error::*;
pub use js_values::*;
pub use status::Status;
pub use task::Task;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
pub use tokio_runtime::shutdown_tokio_rt;
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
    check_status!($crate::sys::napi_typeof($env, $value, &mut value_type))
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
  #[cfg(feature = "compat-mode")]
  pub use crate::bindgen_runtime::register_module_exports;
  pub use crate::{
    assert_type_of, bindgen_runtime::*, check_status, check_status_or_throw, error, error::*, sys,
    type_of, JsError, Property, PropertyAttributes, Result, Status, Task, ValueType,
  };
}
