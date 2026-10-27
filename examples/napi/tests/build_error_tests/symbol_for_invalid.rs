use napi_derive::napi;

#[napi(symbol_for = "function")]
pub fn free_function() {}

#[napi]
pub struct Example {}

#[napi]
impl Example {
  #[napi(js_name = "name", symbol_for = "name")]
  pub fn conflicting(&self) {}
}

#[napi]
impl Example {
  #[napi(constructor, symbol_for = "constructor")]
  pub fn new() -> Self {
    Self {}
  }
}

#[napi]
pub struct ConflictingField {
  #[napi(js_name = "value", symbol_for = "value")]
  pub value: u32,
}

#[napi(object)]
pub struct ObjectField {
  #[napi(symbol_for = "value")]
  pub value: u32,
}

#[napi(array)]
pub struct ArrayField(#[napi(symbol_for = "value")] pub u32);

#[napi(transparent)]
pub struct TransparentField(#[napi(symbol_for = "value")] pub u32);

#[napi(symbol_for = "Class")]
pub struct UnsupportedClass {}

#[napi(symbol_for = "module")]
pub mod unsupported_module {}

#[napi]
impl Example {
  #[napi(getter = name, symbol_for = "name")]
  pub fn named_getter(&self) -> u32 {
    0
  }
}

#[napi]
pub struct SkippedField {
  #[napi(skip, symbol_for = "value")]
  pub value: u32,
}

fn main() {}
