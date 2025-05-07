use napi::*;

struct NativeObject {
  count: i64,
}

#[contextless_function]
pub fn set_instance_data(env: Env) -> ContextlessResult<()> {
  env.set_instance_data(NativeObject { count: 1024 }, 0, |_ctx| {})?;
  Ok(Some(()))
}

#[contextless_function]
pub fn get_instance_data(env: Env) -> ContextlessResult<i64> {
  if let Some(obj) = env.get_instance_data::<NativeObject>()? {
    Ok(Some(obj.count))
  } else {
    Ok(None)
  }
}

#[contextless_function]
pub fn get_wrong_type_instance_data(env: Env) -> ContextlessResult<i64> {
  if let Some(count) = env.get_instance_data::<i32>()? {
    Ok(Some(*count as i64))
  } else {
    Ok(None)
  }
}
