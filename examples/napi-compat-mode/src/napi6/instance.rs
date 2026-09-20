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

unsafe extern "C" fn finalize_foreign_instance_data(
  _env: napi::sys::napi_env,
  data: *mut std::ffi::c_void,
  _hint: *mut std::ffi::c_void,
) {
  drop(unsafe { Box::from_raw(data as *mut u8) });
}

/// Overwrite the instance-data slot with a payload this binary never
/// registered; `get_instance_data` must reject it instead of dereferencing it.
#[contextless_function]
pub fn set_foreign_instance_data(env: Env) -> ContextlessResult<()> {
  let payload = Box::into_raw(Box::new(0xABu8));
  let status = unsafe {
    napi::sys::napi_set_instance_data(
      env.raw(),
      payload.cast(),
      Some(finalize_foreign_instance_data),
      std::ptr::null_mut(),
    )
  };
  if status != napi::sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(payload) });
    return Err(napi::Error::new(
      napi::Status::GenericFailure,
      "napi_set_instance_data failed".to_owned(),
    ));
  }
  Ok(Some(()))
}
