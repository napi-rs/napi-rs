#![allow(dead_code)]
#![allow(unreachable_code)]
#![allow(clippy::disallowed_names)]
#![allow(clippy::uninlined_format_args)]

use napi::{Env, JsUnknown};

#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

#[cfg(feature = "snmalloc")]
#[global_allocator]
static ALLOC: snmalloc_rs::SnMalloc = snmalloc_rs::SnMalloc;

#[napi]
/// This is a const
pub const DEFAULT_COST: u32 = 12;

#[napi(skip_typescript)]
pub const TYPE_SKIPPED_CONST: u32 = 12;

mod array;
mod r#async;
mod bigint;
mod callback;
mod class;
mod class_factory;
mod date;
mod either;
mod r#enum;
mod error;
mod events;
mod external;
mod fn_strict;
mod fn_ts_override;
mod generator;
mod js_mod;
mod map;
mod nullable;
mod number;
mod object;
mod promise;
mod reference;
mod serde;
mod shared;
mod string;
mod symbol;
mod task;
mod threadsafe_function;
mod typed_array;

#[napi]
pub fn run_script(env: Env, script: String) -> napi::Result<JsUnknown> {
  env.run_script(script)
}
