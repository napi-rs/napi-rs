use napi::bindgen_prelude::*;

#[cfg(not(feature = "noop"))]
struct RuntimeLifecycleExternalProbe {
  result_path: String,
}

#[cfg(not(feature = "noop"))]
impl Drop for RuntimeLifecycleExternalProbe {
  fn drop(&mut self) {
    crate::env::record_runtime_transition_probe(&self.result_path);
  }
}

#[cfg(not(feature = "noop"))]
#[napi(no_export)]
pub fn create_runtime_lifecycle_external_probe(
  env: &Env,
  result_path: String,
) -> Result<Unknown<'_>> {
  External::new(RuntimeLifecycleExternalProbe { result_path }).into_unknown(env)
}

#[cfg(not(feature = "noop"))]
pub(crate) fn install_lifecycle_fixture(fixture: &mut Object) -> Result<()> {
  fixture.create_named_method(
    "createRuntimeLifecycleExternalProbe",
    create_runtime_lifecycle_external_probe_c_callback,
  )
}

#[cfg(feature = "noop")]
pub(crate) fn install_lifecycle_fixture(_fixture: &mut Object) -> Result<()> {
  Ok(())
}

#[napi]
pub fn create_external(size: u32) -> External<u32> {
  External::new(size)
}

#[napi]
pub fn create_external_string(content: String) -> External<String> {
  External::new(content)
}

#[napi]
pub fn get_external(external: &External<u32>) -> u32 {
  **external
}

#[napi]
pub fn mutate_external(external: &mut External<u32>, new_val: u32) {
  **external = new_val;
}

#[napi]
pub fn create_optional_external(size: Option<u32>) -> Option<External<u32>> {
  size.map(External::new)
}

#[napi]
pub fn get_optional_external(external: Option<&External<u32>>) -> Option<u32> {
  external.map(|external| **external)
}

#[napi]
pub fn mutate_optional_external(external: Option<&mut External<u32>>, new_val: u32) {
  if let Some(external) = external {
    **external = new_val;
  }
}

#[napi]
pub fn create_external_ref(env: &Env, size: u32) -> Result<ExternalRef<u32>> {
  let external = External::new(size).into_js_external(env)?;
  external.create_ref()
}
