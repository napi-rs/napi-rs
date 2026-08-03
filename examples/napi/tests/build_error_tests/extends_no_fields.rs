//! `#[napi(extends = ...)]` requires at least one field: the embedded parent
//! must be the (first) field. A fieldless struct has nothing to embed, so the
//! parser rejects it even though `#[repr(C)]` is present.

use napi_derive::napi;

#[napi]
pub struct Parent {
  pub a: i32,
}

#[napi(extends = Parent)]
#[repr(C)]
pub struct Child {}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
