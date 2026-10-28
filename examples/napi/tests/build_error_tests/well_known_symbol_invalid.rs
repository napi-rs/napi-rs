use napi_derive::napi;

#[napi(well_known_symbol = "iterator")]
pub fn free_function() {}

#[napi]
pub struct Example {}

#[napi]
impl Example {
  #[napi(well_known_symbol = "toStringtag")]
  pub fn unknown_name(&self) {}
}

#[napi]
impl Example {
  #[napi(well_known_symbol = "Symbol.iterator")]
  pub fn qualified_name(&self) {}
}

#[napi]
impl Example {
  #[napi(js_name = "name", well_known_symbol = "iterator")]
  pub fn with_js_name(&self) {}
}

#[napi]
impl Example {
  #[napi(symbol_for = "iterator", well_known_symbol = "iterator")]
  pub fn with_symbol_for(&self) {}
}

#[napi]
impl Example {
  #[napi(constructor, well_known_symbol = "species")]
  pub fn new() -> Self {
    Self {}
  }
}

#[napi]
impl Example {
  #[napi(well_known_symbol = "hasInstance")]
  pub fn static_has_instance(_value: u32) -> bool {
    true
  }
}

#[napi]
impl Example {
  #[napi(factory, well_known_symbol = "hasInstance")]
  pub fn factory_has_instance() -> Self {
    Self {}
  }
}

// An instance method keyed by `hasInstance` does not change `instanceof` for
// the class, so it compiles.
#[napi]
impl Example {
  #[napi(well_known_symbol = "hasInstance")]
  pub fn instance_has_instance(&self, _value: u32) -> bool {
    true
  }
}

#[napi(object)]
pub struct ObjectField {
  #[napi(well_known_symbol = "toStringTag")]
  pub tag: String,
}

fn main() {}
