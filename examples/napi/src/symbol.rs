use napi::{bindgen_prelude::*, JsSymbol, SymbolRef};

#[napi]
pub fn set_symbol_in_obj<'scope>(env: &'scope Env, symbol: JsSymbol) -> Result<Object<'scope>> {
  let mut obj = Object::new(env)?;
  obj.set_property(symbol, env.create_string("a symbol")?)?;
  Ok(obj)
}

#[napi]
pub fn create_symbol() -> Symbol {
  Symbol::new("a symbol".to_owned())
}

#[napi]
pub fn create_symbol_for(desc: String) -> Symbol {
  Symbol::for_desc(desc)
}

#[napi]
pub fn create_symbol_ref(env: &Env, desc: String) -> Result<SymbolRef> {
  let symbol = Symbol::for_desc(desc);
  let js_symbol = symbol.into_js_symbol(env)?;
  js_symbol.create_ref()
}

/// Class members exposed through the global symbol registry.
#[napi]
pub struct SymbolNamedClass {
  #[napi(symbol_name = "napi.test.field")]
  pub field: u32,
  #[napi(symbol_name = "napi.test.readonly", readonly)]
  pub readonly_field: u32,
  value: u32,
}

#[napi]
impl SymbolNamedClass {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self {
      field: value,
      readonly_field: value,
      value,
    }
  }

  #[napi(
    getter,
    symbol_name = "_value",
    ts_return_type = "number",
    enumerable = false
  )]
  pub fn get_value(&self) -> u32 {
    self.value
  }

  #[napi(setter, symbol_name = "_value", enumerable = false)]
  pub fn set_value(&mut self, value: u32) {
    self.value = value;
  }

  // String-key controls for the collision test are internal too.
  #[napi(getter, js_name = "_value", skip_typescript)]
  pub fn get_string_value(&self) -> u32 {
    self.value + 100
  }

  #[napi(setter, js_name = "_value", skip_typescript)]
  pub fn set_string_value(&mut self, value: u32) {
    self.value = value + 100;
  }

  #[napi(symbol_name = "_method", writable = false, configurable = false)]
  pub fn increment(&mut self) -> u32 {
    self.value += 1;
    self.value
  }

  #[napi(js_name = "_method", skip_typescript)]
  pub fn string_method(&self) -> u32 {
    self.value + 200
  }

  #[napi(symbol_name = "_method")]
  pub fn static_method(value: u32) -> u32 {
    value + 1
  }

  #[napi(factory, symbol_name = "napi.test.factory")]
  pub fn factory(value: u32) -> Self {
    Self::new(value)
  }

  #[napi(symbol_name = "")]
  pub fn empty_name(&self) -> u32 {
    self.value
  }

  #[napi(getter, symbol_name = "内部\0属性")]
  pub fn unusual_name(&self) -> u32 {
    self.value
  }
}

/// Symbol fields still accept positional constructor arguments.
#[napi(constructor)]
pub struct SymbolNamedFields {
  #[napi(symbol_name = "napi.test.autoField")]
  pub value: u32,
  pub label: String,
}
