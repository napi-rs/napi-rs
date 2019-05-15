#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

include!("bindings.rs");

#[cfg(node8)]
mod node8;
#[cfg(node8)]
pub use self::node8::Status;

#[cfg(nodestable)]
mod stable;
#[cfg(nodestable)]
pub use self::stable::Status;
