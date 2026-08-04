//! `#[napi(extends = ...)]` requires the embedded parent to be the FIRST field.
//! Here the parent is present but sits behind an `i32`, so the parser accepts
//! the shape (it has a first field and is `#[repr(C)]`) but the generated
//! same-type layout assertion fails — surfacing the clearer
//! `#[diagnostic::on_unimplemented]` message instead of a raw trait-bound error.

use napi_derive::napi;

#[napi]
pub struct Parent {
  pub a: i32,
}

#[napi(extends = Parent)]
#[repr(C)]
pub struct Child {
  first: i32,
  parent: Parent,
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
