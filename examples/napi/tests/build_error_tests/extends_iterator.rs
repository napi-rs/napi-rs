//! `#[napi(extends = ...)]` cannot be combined with `#[napi(iterator)]` (or
//! `#[napi(async_iterator)]`): both wire the prototype's single `[[Prototype]]`
//! slot (see `setup_iterator_class`), so one would silently clobber the other.

use napi_derive::napi;

#[napi]
pub struct Parent {
  pub a: i32,
}

#[napi(extends = Parent, iterator)]
#[repr(C)]
pub struct Child {
  parent: Parent,
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
