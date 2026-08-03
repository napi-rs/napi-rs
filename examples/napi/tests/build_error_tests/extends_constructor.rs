//! `#[napi(extends = ...)]` cannot be combined with `#[napi(constructor)]` in
//! this version: a generated constructor takes every field as an argument,
//! including the embedded parent (a `#[napi]`-class value, not a marshalable
//! type). Extended classes are built with a `#[napi(factory)]` instead. The
//! parent field is `pub` so the fixture emits exactly the one combo diagnostic
//! (no "field must be public" noise from the constructor path).

use napi_derive::napi;

#[napi]
pub struct Parent {
  pub a: i32,
}

#[napi(extends = Parent, constructor)]
#[repr(C)]
pub struct Child {
  pub parent: Parent,
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
