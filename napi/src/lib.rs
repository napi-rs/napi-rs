#![deny(clippy::all)]

//! High level NodeJS [N-API](https://nodejs.org/api/n-api.html) binding
//!
//! **napi-rs** provides minimal overhead to write N-API modules in `Rust`.
//!
//! ## Feature flags
//!
//! ### napi1 ~ napi8
//!
//! Because `NodeJS` N-API has versions. So there are feature flags to choose what version of `N-API` you want to build for.
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
mod call_context;
#[cfg(feature = "napi3")]
mod cleanup_env;
mod env;
mod error;
mod js_values;
mod module;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
mod promise;
mod status;
mod task;
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
pub use error::{Error, ExtendedErrorInfo, Result};
pub use js_values::*;
pub use module::Module;
pub use status::Status;
pub use task::Task;
pub use version::NodeVersion;

#[cfg(feature = "serde-json")]
#[macro_use]
extern crate serde;

pub type ContextlessResult<T> = Result<Option<T>>;

/// Deprecated
/// register nodejs module
///
/// ## Example
/// ```
/// register_module!(test_module, init);
///
/// fn init(module: &mut Module) -> Result<()> {
///     module.create_named_method("nativeFunction", native_function)?;
/// }
/// ```
#[macro_export]
#[deprecated(since = "1.0.0", note = "[module_exports] macro instead")]
macro_rules! register_module {
  ($module_name:ident, $init:ident) => {
    #[inline]
    #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
    fn check_status(code: $crate::sys::napi_status) -> Result<()> {
      use $crate::{Error, Status};
      let status = Status::from(code);
      match status {
        Status::Ok => Ok(()),
        _ => Err(Error::from_status(status)),
      }
    }

    #[no_mangle]
    unsafe extern "C" fn napi_register_module_v1(
      raw_env: $crate::sys::napi_env,
      raw_exports: $crate::sys::napi_value,
    ) -> $crate::sys::napi_value {
      use std::ffi::CString;
      use std::io::Write;
      use std::os::raw::c_char;
      use std::ptr;
      use $crate::{Env, JsObject, NapiValue};

      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      use $crate::shutdown_tokio_rt;

      if cfg!(debug_assertions) {
        println!("`register_module` macro will deprecate soon, please migrate to [module_exports]");
      }

      let env = Env::from_raw(raw_env);
      let mut exports: JsObject = JsObject::from_raw_unchecked(raw_env, raw_exports);
      let mut cjs_module = Module { env, exports };
      let result = $init(&mut cjs_module);
      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      let hook_result = check_status(unsafe {
        $crate::sys::napi_add_env_cleanup_hook(raw_env, Some(shutdown_tokio_rt), ptr::null_mut())
      });
      #[cfg(not(all(feature = "tokio_rt", feature = "napi4")))]
      let hook_result = Ok(());
      match hook_result.and_then(move |_| result) {
        Ok(_) => cjs_module.exports.raw(),
        Err(e) => {
          let c_string =
            CString::from_vec_unchecked(format!("Error initializing module: {}", e).into());
          unsafe { $crate::sys::napi_throw_error(raw_env, ptr::null(), c_string.as_ptr()) };
          ptr::null_mut()
        }
      }
    }
  };
}
