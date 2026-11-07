//! The promise of a `JsDeferred` dropped unsettled stays pending, but napi-rs must not keep it:
//! in deferred mode (the Node and Bun main thread) its `napi_deferred` used to pin the promise,
//! and everything that awaits it, until the process exited.

use napi::bindgen_prelude::*;

/// Makes `n` deferreds, hands their promises to `observe` (which attaches awaiters), then drops
/// every deferred unsettled, all on the JavaScript thread.
#[napi]
pub fn drop_deferred_after_observe(
  env: &Env,
  n: u32,
  #[napi(ts_arg_type = "(promise: Promise<number>) => void")] observe: Function<Object, ()>,
) -> Result<()> {
  let mut deferreds = Vec::with_capacity(n as usize);
  for _ in 0..n {
    let (deferred, promise) = env.create_deferred::<u32, fn(Env) -> Result<u32>>()?;
    deferreds.push(deferred);
    observe.call(promise)?;
  }
  drop(deferreds);
  Ok(())
}
