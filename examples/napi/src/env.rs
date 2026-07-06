use napi::bindgen_prelude::*;

#[cfg(not(feature = "noop"))]
pub(crate) fn record_runtime_transition_probe(result_path: &str) {
  let mut result = 0;
  if try_start_async_runtime().is_ok() {
    result |= 1;
  }
  if try_shutdown_async_runtime().is_ok() {
    result |= 2;
  }
  let _ = std::fs::write(result_path, result.to_string());
}

#[cfg(not(feature = "noop"))]
#[napi(no_export)]
pub fn register_env_cleanup_runtime_lifecycle_probes(
  env: &Env,
  cleanup_result_path: String,
  async_cleanup_result_path: String,
) -> Result<()> {
  env.add_env_cleanup_hook(cleanup_result_path, |result_path| {
    record_runtime_transition_probe(&result_path);
  })?;
  env.add_async_cleanup_hook(async_cleanup_result_path, |result_path| {
    record_runtime_transition_probe(&result_path);
  })
}

#[cfg(not(feature = "noop"))]
#[napi(no_export)]
pub fn set_instance_data_runtime_lifecycle_probe(env: &Env, result_path: String) -> Result<()> {
  env.set_instance_data((), result_path, |context| {
    record_runtime_transition_probe(&context.hint);
  })
}

#[cfg(not(feature = "noop"))]
pub(crate) fn install_lifecycle_fixture(fixture: &mut Object) -> Result<()> {
  fixture.create_named_method(
    "registerEnvCleanupRuntimeLifecycleProbes",
    register_env_cleanup_runtime_lifecycle_probes_c_callback,
  )?;
  fixture.create_named_method(
    "setInstanceDataRuntimeLifecycleProbe",
    set_instance_data_runtime_lifecycle_probe_c_callback,
  )
}

#[cfg(feature = "noop")]
pub(crate) fn install_lifecycle_fixture(_fixture: &mut Object) -> Result<()> {
  Ok(())
}

#[napi]
pub fn run_script(env: &Env, script: String) -> Result<Unknown<'_>> {
  env.run_script(script)
}

#[napi]
pub fn get_module_file_name(env: Env) -> Result<String> {
  env.get_module_file_name()
}

#[napi]
pub fn throw_syntax_error(env: Env, error: String, code: Option<String>) {
  env.throw_syntax_error(error, code);
}
