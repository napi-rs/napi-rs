use napi_derive::napi;

#[napi(symbol_name = "function")]
pub fn free_function() {}

#[napi]
pub struct Example {}

#[napi]
impl Example {
  #[napi(js_name = "name", symbol_name = "name")]
  pub fn conflicting(&self) {}
}

#[napi]
impl Example {
  #[napi(constructor, symbol_name = "constructor")]
  pub fn new() -> Self {
    Self {}
  }
}

#[napi]
pub struct ConflictingField {
  #[napi(js_name = "value", symbol_name = "value")]
  pub value: u32,
}

#[napi(object)]
pub struct ObjectField {
  #[napi(symbol_name = "value")]
  pub value: u32,
}

#[napi(array)]
pub struct ArrayField(#[napi(symbol_name = "value")] pub u32);

#[napi(transparent)]
pub struct TransparentField(#[napi(symbol_name = "value")] pub u32);

#[napi(symbol_name = "Class")]
pub struct UnsupportedClass {}

#[napi(symbol_name = "module")]
pub mod unsupported_module {}

#[napi]
impl Example {
  #[napi(getter = name, symbol_name = "name")]
  pub fn named_getter(&self) -> u32 {
    0
  }
}

#[napi]
pub struct SkippedField {
  #[napi(skip, symbol_name = "value")]
  pub value: u32,
}

fn main() {}
