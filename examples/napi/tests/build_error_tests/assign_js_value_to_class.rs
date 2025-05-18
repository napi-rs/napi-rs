//! This is testing that JsValue types with lifetime can't be assigned to a field of napi class struct

use napi_derive::napi;

#[napi]
pub struct JsValueWithOuterLifetime<'a> {
  pub value: napi::bindgen_prelude::Object<'a>,
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
