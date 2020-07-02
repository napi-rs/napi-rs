mod async_work;
mod call_context;
mod env;
mod error;
mod js_values;
mod module;
#[cfg(all(feature = "libuv", napi4))]
mod promise;
mod status;
pub mod sys;
mod task;
#[cfg(napi4)]
pub mod threadsafe_function;
#[cfg(all(feature = "libuv", napi4))]
mod uv;
mod version;

pub use async_work::AsyncWork;
pub use call_context::CallContext;
pub use env::*;
pub use error::{Error, Result};
pub use js_values::*;
pub use module::Module;
pub use status::Status;
pub use sys::napi_valuetype;
pub use task::Task;
pub use version::NodeVersion;

#[macro_export]
macro_rules! register_module {
  ($module_name:ident, $init:ident) => {
    #[no_mangle]
    #[cfg_attr(target_os = "linux", link_section = ".ctors")]
    #[cfg_attr(target_os = "macos", link_section = "__DATA,__mod_init_func")]
    #[cfg_attr(target_os = "windows", link_section = ".CRT$XCU")]
    pub static __REGISTER_MODULE: extern "C" fn() = {
      use std::io::Write;
      use std::os::raw::c_char;
      use std::ptr;
      use $crate::{sys, Env, JsObject, Module, NapiValue};

      extern "C" fn register_module() {
        static mut MODULE_DESCRIPTOR: Option<sys::napi_module> = None;
        unsafe {
          MODULE_DESCRIPTOR = Some(sys::napi_module {
            nm_version: 1,
            nm_flags: 0,
            nm_filename: concat!(file!(), "\0").as_ptr() as *const c_char,
            nm_register_func: Some(init_module),
            nm_modname: concat!(stringify!($module_name), "\0").as_ptr() as *const c_char,
            nm_priv: 0 as *mut _,
            reserved: [0 as *mut _; 4],
          });

          sys::napi_module_register(MODULE_DESCRIPTOR.as_mut().unwrap() as *mut sys::napi_module);
        }

        extern "C" fn init_module(
          raw_env: sys::napi_env,
          raw_exports: sys::napi_value,
        ) -> sys::napi_value {
          let env = Env::from_raw(raw_env);
          let mut exports: JsObject = JsObject::from_raw_unchecked(raw_env, raw_exports);
          let mut cjs_module = Module { env, exports };
          let result = $init(&mut cjs_module);

          match result {
            Ok(_) => exports.into_raw(),
            Err(e) => {
              unsafe {
                sys::napi_throw_error(
                  raw_env,
                  ptr::null(),
                  format!("Error initializing module: {:?}", e).as_ptr() as *const _,
                )
              };
              ptr::null_mut()
            }
          }
        }
      }

      register_module
    };
  };
}
