//! `#[napi(extends = ...)]` is only valid on a class struct, not on
//! `#[napi(object)]` (nor array / transparent / string enum).

use napi_derive::napi;

#[napi(object, extends = SomeParent)]
pub struct NotAClass {
  pub a: i32,
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
