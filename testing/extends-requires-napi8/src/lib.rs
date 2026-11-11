//! `#[napi(extends)]` must not compile against `napi`'s default features
//! (napi4) on native targets, and must compile once `napi8` is enabled.
//! Run by `check.sh`.

use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(extends = Parent)]
#[repr(C)]
pub struct Child {
  parent: Parent,
}
