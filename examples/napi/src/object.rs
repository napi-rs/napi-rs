use napi::{bindgen_prelude::*, JsGlobal, JsNull, JsUndefined};

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
