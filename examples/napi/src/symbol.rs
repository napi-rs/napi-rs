use napi::{bindgen_prelude::*, Env, JsObject, JsSymbol};

#[napi]
pub fn set_symbol_in_obj(env: Env, symbol: JsSymbol) -> Result<JsObject> {
  let mut obj = env.create_object()?;
  obj.set_property(symbol, env.create_string("a symbol")?)?;
  Ok(obj)
}

#[napi]
pub fn create_symbol() -> Symbol {
  Symbol::new("a symbol".to_owned())
}
