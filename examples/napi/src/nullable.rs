use napi::bindgen_prelude::*;

#[napi]
fn map_option(val: Option<u32>) -> Option<u32> {
  val.map(|v| v + 1)
}

#[napi]
fn return_null() -> Null {
  Null
}

#[napi]
fn return_undefined() -> Undefined {}

#[napi(object, use_nullable = true)]
struct UseNullableStruct {
  pub required_number_field: u32,
  pub required_string_field: String,
  pub nullable_number_field: Option<u32>,
  pub nullable_string_field: Option<String>,
}

#[napi(object, use_nullable = false)]
struct NotUseNullableStruct {
  pub required_number_field: u32,
  pub required_string_field: String,
  pub optional_number_field: Option<u32>,
  pub optional_string_field: Option<String>,
}

#[napi(object)]
struct DefaultUseNullableStruct {
  pub required_number_field: u32,
  pub required_string_field: String,
  pub optional_number_field: Option<u32>,
  pub optional_string_field: Option<String>,
}

#[napi(constructor, use_nullable = true)]
struct UseNullableClass {
  pub required_number_field: u32,
  pub required_string_field: String,
  pub nullable_number_field: Option<u32>,
  pub nullable_string_field: Option<String>,
}

#[napi(constructor, use_nullable = false)]
struct NotUseNullableClass {
  pub required_number_field: u32,
  pub required_string_field: String,
  pub optional_number_field: Option<u32>,
  pub optional_string_field: Option<String>,
}

#[napi(constructor)]
struct DefaultUseNullableClass {
  pub required_number_field: u32,
  pub required_string_field: String,
  pub optional_number_field: Option<u32>,
  pub optional_string_field: Option<String>,
}
