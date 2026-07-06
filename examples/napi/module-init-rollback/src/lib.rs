use napi::bindgen_prelude::*;
use napi_derive::napi;

const FAIL_MODULE_INIT_GLOBAL: &str = "__NAPI_RS_FAIL_MODULE_INIT__";

#[napi]
pub fn module_init_rollback_probe() -> &'static str {
  "ready"
}

#[napi(module_exports)]
pub fn module_exports(env: Env) -> Result<()> {
  let global = env.get_global()?;
  if global.has_named_property(FAIL_MODULE_INIT_GLOBAL)?
    && global.get_named_property::<bool>(FAIL_MODULE_INIT_GLOBAL)?
  {
    return Err(Error::new(
      Status::GenericFailure,
      "intentional module initialization failure",
    ));
  }
  Ok(())
}
