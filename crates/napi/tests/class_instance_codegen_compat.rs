use napi::bindgen_prelude::ClassInstance;

struct GeneratedClass;

fn old_generated_into_instance<'scope>(
  value: napi::sys::napi_value,
  env: napi::sys::napi_env,
  inner: *mut GeneratedClass,
) -> napi::Result<ClassInstance<'scope, GeneratedClass>> {
  unsafe { Ok(ClassInstance::new(value, env, inner)) }
}

fn current_generated_into_instance<'scope>(
  value: napi::sys::napi_value,
  env: napi::sys::napi_env,
  inner: *mut GeneratedClass,
) -> napi::Result<ClassInstance<'scope, GeneratedClass>> {
  unsafe { ClassInstance::try_new(value, env, inner) }
}

#[test]
fn released_and_current_generated_constructor_contracts_compile() {
  let _ = old_generated_into_instance;
  let _ = current_generated_into_instance;
}
