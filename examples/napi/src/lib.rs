#![allow(dead_code)]
#![allow(unreachable_code)]

#[macro_use]
extern crate napi_derive;
#[cfg(not(target_arch = "wasm32"))]
#[macro_use]
extern crate serde_derive;

#[napi]
/// This is a const
pub const DEFAULT_COST: u32 = 12;

#[napi(skip_typescript)]
pub const TYPE_SKIPPED_CONST: u32 = 12;

#[cfg(not(target_arch = "wasm32"))]
mod array;
#[cfg(not(target_arch = "wasm32"))]
mod r#async;
#[cfg(not(target_arch = "wasm32"))]
mod bigint;
#[cfg(not(target_arch = "wasm32"))]
mod callback;
#[cfg(not(target_arch = "wasm32"))]
mod class;
#[cfg(not(target_arch = "wasm32"))]
mod class_factory;
#[cfg(not(target_arch = "wasm32"))]
mod date;
#[cfg(not(target_arch = "wasm32"))]
mod either;
mod r#enum;
#[cfg(not(target_arch = "wasm32"))]
mod error;
#[cfg(not(target_arch = "wasm32"))]
mod external;
#[cfg(not(target_arch = "wasm32"))]
mod fn_strict;
#[cfg(not(target_arch = "wasm32"))]
mod fn_ts_override;
#[cfg(not(target_arch = "wasm32"))]
mod generator;
#[cfg(not(target_arch = "wasm32"))]
mod js_mod;
#[cfg(not(target_arch = "wasm32"))]
mod map;
#[cfg(not(target_arch = "wasm32"))]
mod nullable;
#[cfg(not(target_arch = "wasm32"))]
mod number;
#[cfg(not(target_arch = "wasm32"))]
mod object;
#[cfg(not(target_arch = "wasm32"))]
mod promise;
#[cfg(not(target_arch = "wasm32"))]
mod reference;
#[cfg(not(target_arch = "wasm32"))]
mod serde;
#[cfg(not(target_arch = "wasm32"))]
mod string;
#[cfg(not(target_arch = "wasm32"))]
mod symbol;
#[cfg(not(target_arch = "wasm32"))]
mod task;
#[cfg(not(target_arch = "wasm32"))]
mod threadsafe_function;
#[cfg(not(target_arch = "wasm32"))]
mod typed_array;
