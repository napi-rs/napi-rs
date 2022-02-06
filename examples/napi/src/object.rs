use napi::{bindgen_prelude::*, JsGlobal, JsNull, JsObject, JsUndefined, Property};

#[napi]
fn list_obj_keys(obj: Object) -> Vec<String> {
  Object::keys(&obj).unwrap()
}

#[napi]
fn create_obj(env: Env) -> Object {
  let mut obj = env.create_object().unwrap();
  obj.set("test", 1).unwrap();

  obj
}

#[napi]
fn get_global(env: Env) -> Result<JsGlobal> {
  env.get_global()
}

#[napi]
fn get_undefined(env: Env) -> Result<JsUndefined> {
  env.get_undefined()
}

#[napi]
fn get_null(env: Env) -> Result<JsNull> {
  env.get_null()
}

#[napi(object)]
struct AllOptionalObject {
  pub name: Option<String>,
  pub age: Option<u32>,
}

#[napi]
fn receive_all_optional_object(obj: Option<AllOptionalObject>) -> Result<()> {
  if obj.is_some() {
    assert!(obj.as_ref().unwrap().name.is_none());
    assert!(obj.as_ref().unwrap().age.is_none());
  }
  Ok(())
}

#[napi(js_name = "ALIAS")]
pub enum AliasedEnum {
  A,
  B,
}

#[napi(object, js_name = "AliasedStruct")]
pub struct StructContainsAliasedEnum {
  pub a: AliasedEnum,
  pub b: u32,
}

#[napi]
fn fn_received_aliased(mut s: StructContainsAliasedEnum, e: AliasedEnum) {
  s.a = e;
}

#[napi(object)]
pub struct StrictObject {
  pub name: String,
}

#[napi]
pub fn receive_strict_object(strict_object: StrictObject) {
  assert_eq!(strict_object.name, "strict");
}

#[napi]
pub fn get_str_from_object(env: Env) {
  let mut obj = env.create_object().unwrap();
  obj.set("name", "value").unwrap();
  assert_eq!(obj.get("name").unwrap(), Some("value"));
}

#[napi(object)]
pub struct TsTypeChanged {
  #[napi(ts_type = "object")]
  pub type_override: String,

  #[napi(ts_type = "object")]
  pub type_override_optional: Option<String>,
}

#[napi(ts_return_type = "{ value: ArrayBuffer, get getter(): number }")]
pub fn create_obj_with_property(env: Env) -> Result<JsObject> {
  let mut obj = env.create_object()?;
  let arraybuffer = env.create_arraybuffer(10)?.into_raw();
  obj.define_properties(&[
    Property::new("value")?.with_value(&arraybuffer),
    Property::new("getter")?.with_getter(get_c_callback(getter_from_obj_js_function)?),
  ])?;
  Ok(obj)
}

#[napi]
fn getter_from_obj() -> u32 {
  42
}
