use napi::{ContextlessResult, Env, JsObject, JsString, JsUnknown, Result};
use serde_json::to_string;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("createArrayJson", create_array_json)?;
  exports.create_named_method("createArray", create_array)?;
  exports.create_named_method("createArrayWithSerdeTrait", create_array_with_serde_trait)?;
  Ok(())
}

#[contextless_function]
pub fn create_array_json(env: Env) -> ContextlessResult<JsString> {
  let a: Vec<u32> = vec![42; 1000];
  let arr_string = to_string(&a)?;
  env.create_string(arr_string.as_str()).map(Some)
}

#[contextless_function]
pub fn create_array(env: Env) -> ContextlessResult<JsObject> {
  let a: Vec<u32> = vec![42; 1000];
  let mut ret = env.create_array_with_length(a.len())?;
  for (index, item) in a.iter().enumerate() {
    ret.set_element(index as u32, env.create_uint32(*item)?)?;
  }
  Ok(Some(ret))
}

#[contextless_function]
pub fn create_array_with_serde_trait(env: Env) -> ContextlessResult<JsUnknown> {
  let a: Vec<u32> = vec![42; 1000];
  env.to_js_value(&a).map(Some)
}
