//! Fixtures for the reflection helpers: `to_serde_json_value`,
//! `constructor_name`, and `has_type_tag`. Each `#[napi]` function below is a
//! thin wrapper that the `reflection.spec.ts` suite drives from JavaScript.

use napi::bindgen_prelude::*;

#[cfg(not(target_family = "wasm"))]
use crate::type_tag::{TypeTagA, TypeTagB};

/// Round-trips an object through `Object::to_serde_json_value`.
#[napi]
pub fn reflect_object_to_json(obj: Object) -> Result<serde_json::Value> {
  obj.to_serde_json_value()
}

/// Round-trips any JS value through `Unknown::to_serde_json_value` — this covers
/// the non-object inputs (undefined, functions, symbols, bigint) an `Object`
/// parameter would reject before the conversion could run.
#[napi]
pub fn reflect_unknown_to_json(value: Unknown) -> Result<serde_json::Value> {
  value.to_serde_json_value()
}

/// This object's `constructor.name`, or `null`.
#[napi]
pub fn reflect_constructor_name(obj: Object) -> Result<Option<String>> {
  obj.constructor_name()
}

/// Type-tag check against `TypeTagA`. Native-only: the tag check does real work
/// only under napi8 on a non-wasm target, so the method does not exist elsewhere.
#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn reflect_has_type_tag_a(obj: Object) -> Result<bool> {
  obj.has_type_tag::<TypeTagA>()
}

/// Type-tag check against `TypeTagB`.
#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn reflect_has_type_tag_b(obj: Object) -> Result<bool> {
  obj.has_type_tag::<TypeTagB>()
}
