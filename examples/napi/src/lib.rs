#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

#[napi]
pub const DEFAULT_COST: u32 = 12;

mod array;
mod r#async;
mod bigint;
mod callback;
mod class;
mod class_factory;
mod either;
mod r#enum;
mod error;
mod nullable;
mod number;
mod object;
mod promise;
mod serde;
mod string;
mod symbol;
mod task;
mod threadsafe_function;
mod typed_array;
