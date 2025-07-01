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
