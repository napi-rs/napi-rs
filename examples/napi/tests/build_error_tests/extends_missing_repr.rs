//! `#[napi(extends = ...)]` requires `#[repr(C)]` so the embedded parent stays
//! at offset 0. A private parent field + no constructor keeps this fixture's
//! output to exactly the one macro diagnostic (no field-accessor codegen).

use napi_derive::napi;

#[napi]
pub struct Parent {
  pub a: i32,
}

#[napi(extends = Parent)]
pub struct Child {
  parent: Parent,
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
