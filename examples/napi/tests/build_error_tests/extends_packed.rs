//! `#[napi(extends = ...)]` cannot be combined with `#[repr(packed)]`: packed
//! can misalign the embedded parent field, making `&self.parent` UB.

use napi_derive::napi;

#[napi]
pub struct Parent {
  pub a: i32,
}

#[napi(extends = Parent)]
#[repr(C, packed)]
pub struct Child {
  parent: Parent,
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
