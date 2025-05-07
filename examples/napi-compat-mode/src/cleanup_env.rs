use napi::{
  bindgen_prelude::External, CallContext, CleanupEnvHook, ContextlessResult, Env, JsObject, Result,
};

#[contextless_function]
fn add_cleanup_hook(env: Env) -> ContextlessResult<External<CleanupEnvHook<()>>> {
  let hook = env.add_env_cleanup_hook((), |_| {
    println!("cleanup hook executed");
  })?;
  Ok(Some(External::new(hook)))
}

#[js_function(1)]
fn remove_cleanup_hook(ctx: CallContext) -> Result<()> {
  let hook = ctx.get::<&External<CleanupEnvHook<()>>>(0)?;
  ctx.env.remove_env_cleanup_hook(**hook)?;
  Ok(())
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("addCleanupHook", add_cleanup_hook)?;
  exports.create_named_method("removeCleanupHook", remove_cleanup_hook)?;
  Ok(())
}
