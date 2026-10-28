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
  #[napi(symbol_for = "napi.test.field")]
  pub field: u32,
  #[napi(symbol_for = "napi.test.readonly", readonly)]
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
    symbol_for = "_value",
    ts_return_type = "number",
    enumerable = false
  )]
  pub fn get_value(&self) -> u32 {
    self.value
  }

  #[napi(setter, symbol_for = "_value", enumerable = false)]
  pub fn set_value(&mut self, value: u32) {
    self.value = value;
  }

  #[napi(getter, js_name = "_value")]
  pub fn get_string_value(&self) -> u32 {
    self.value + 100
  }

  #[napi(setter, js_name = "_value")]
  pub fn set_string_value(&mut self, value: u32) {
    self.value = value + 100;
  }

  #[napi(symbol_for = "_method", writable = false, configurable = false)]
  pub fn increment(&mut self) -> u32 {
    self.value += 1;
    self.value
  }

  #[napi(js_name = "_method")]
  pub fn string_method(&self) -> u32 {
    self.value + 200
  }

  #[napi(symbol_for = "_method")]
  pub fn static_method(value: u32) -> u32 {
    value + 1
  }

  // A static and an instance member with the same string key stay separate.
  #[napi(js_name = "shared")]
  pub fn shared_instance(&self) -> u32 {
    self.value + 300
  }

  #[napi(js_name = "shared")]
  pub fn shared_static(value: u32) -> u32 {
    value + 400
  }

  #[napi(factory, symbol_for = "napi.test.factory")]
  pub fn factory(value: u32) -> Self {
    Self::new(value)
  }

  #[napi(symbol_for = "")]
  pub fn empty_name(&self) -> u32 {
    self.value
  }

  #[napi(getter, symbol_for = "内部\0属性")]
  pub fn unusual_name(&self) -> u32 {
    self.value
  }
}

/// Symbol fields still accept positional constructor arguments.
#[napi(constructor)]
pub struct SymbolNamedFields {
  #[napi(symbol_for = "napi.test.autoField")]
  pub value: u32,
  pub label: String,
}

/// Class members keyed by well-known symbols.
#[napi]
pub struct WellKnownSymbolClass {
  #[napi(well_known_symbol = "isConcatSpreadable")]
  pub spreadable: bool,
  tag: String,
  value: u32,
  disposed: bool,
}

#[napi]
impl WellKnownSymbolClass {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self {
      spreadable: false,
      tag: "WellKnownSymbolClass".to_owned(),
      value,
      disposed: false,
    }
  }

  #[napi(getter, well_known_symbol = "toStringTag")]
  pub fn tag(&self) -> String {
    self.tag.clone()
  }

  #[napi(setter, well_known_symbol = "toStringTag")]
  pub fn set_tag(&mut self, tag: String) {
    self.tag = tag;
  }

  #[napi(well_known_symbol = "toPrimitive")]
  pub fn to_primitive(&self, hint: String) -> Either<u32, String> {
    if hint == "string" {
      Either::B(format!("value:{}", self.value))
    } else {
      Either::A(self.value)
    }
  }

  /// Converts the class itself, not its instances, to a primitive.
  #[napi(well_known_symbol = "toPrimitive")]
  pub fn class_to_primitive(hint: String) -> String {
    format!("WellKnownSymbolClass:{hint}")
  }

  #[napi(well_known_symbol = "dispose")]
  pub fn dispose(&mut self) {
    self.disposed = true;
  }

  #[napi(getter)]
  pub fn disposed(&self) -> bool {
    self.disposed
  }
}

#[napi]
pub fn define_symbol_object<'env>(env: &'env Env, name: String) -> Result<Object<'env>> {
  let mut object = Object::new(env)?;
  object.define_properties(&symbol_properties(env, &name)?)?;
  Ok(object)
}

#[napi(ts_return_type = "new () => object")]
pub fn define_symbol_class<'env>(env: &'env Env, name: String) -> Result<Function<'env>> {
  env.define_class(
    "SymbolPropertyClass",
    symbol_property_constructor_c_callback,
    &symbol_properties(env, &name)?,
  )
}

// Calls the macro-internal `with_symbol_name` on purpose to cover the shared
// descriptor path (`define_properties`, `Env::define_class`).
fn symbol_properties(env: &Env, name: &str) -> Result<[Property; 3]> {
  Ok([
    Property::new()
      .with_symbol_name(name)
      .with_getter(symbol_property_value_c_callback),
    Property::new()
      .with_utf8_name("stringValue")?
      .with_getter(symbol_property_value_c_callback),
    Property::new()
      .with_name(env, env.create_string("valueName")?)?
      .with_getter(symbol_property_value_c_callback),
  ])
}

#[napi(no_export)]
fn symbol_property_constructor() {}

#[napi(no_export)]
fn symbol_property_value() -> u32 {
  42
}
