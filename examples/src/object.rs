use napi::bindgen_prelude::*;

#[napi]
fn log_keys(obj: Object) {
  Object::keys(obj).unwrap().iter().for_each(|key| {
    println!("key: {}", key);
  });
}

#[napi]
fn create_empty_obj(env: Env) -> Object {
  env.create_object().unwrap()
}
