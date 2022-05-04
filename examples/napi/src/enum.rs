#[cfg(not(target_arch = "wasm32"))]
use napi::bindgen_prelude::*;

/// default enum values are continuos i32s start from 0
#[napi]
pub enum Kind {
  /// Barks
  Dog,
  /// Kills birds
  Cat,
  /// Tasty
  Duck,
}

#[cfg(not(target_arch = "wasm32"))]
#[napi]
pub enum Empty {}

/// You could break the step and for an new continuous value.
#[cfg(not(target_arch = "wasm32"))]
#[napi]
pub enum CustomNumEnum {
  One = 1,
  Two,
  Three = 3,
  Four,
  Six = 6,
  Eight = 8,
  Nine, // would be 9
  Ten,  // 10
}

#[cfg(not(target_arch = "wasm32"))]
#[napi]
pub fn enum_to_i32(e: CustomNumEnum) -> i32 {
  e as i32
}

#[cfg(not(target_arch = "wasm32"))]
#[napi(skip_typescript)]
pub enum SkippedEnums {
  One = 1,
  Two,
  Tree,
}
