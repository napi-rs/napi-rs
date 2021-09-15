use napi::bindgen_prelude::*;

#[napi]
fn list_obj_keys(obj: Object) -> Vec<String> {
  Object::keys(&obj).unwrap()
}

#[napi]
fn create_obj(env: Env) -> Object {
  let mut obj = env.create_object().unwrap();
  obj.set("test".to_owned(), 1).unwrap();

  obj
}
