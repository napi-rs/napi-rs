use napi::*;

struct NativeObject {
  count: i64,
}

#[contextless_function]
pub fn set_instance_data(env: Env) -> ContextlessResult<JsUndefined> {
  env.set_instance_data(NativeObject { count: 1024 }, 0, |_ctx| {})?;
  env.get_undefined().map(Some)
}

#[contextless_function]
pub fn get_instance_data(env: Env) -> ContextlessResult<JsNumber> {
  if let Some(obj) = env.get_instance_data::<NativeObject>()? {
    env.create_int64(obj.count).map(Some)
  } else {
    Ok(None)
  }
}

#[contextless_function]
pub fn get_wrong_type_instance_data(env: Env) -> ContextlessResult<JsNumber> {
  if let Some(count) = env.get_instance_data::<i32>()? {
    env.create_int64(*count as i64).map(Some)
  } else {
    Ok(None)
  }
}
