use napi::{bindgen_prelude::*, JsString};

#[napi]
pub async fn async_plus_100(p: Promise<u32>) -> Result<u32> {
  let v = p.await?;
  Ok(v + 100)
}

#[napi]
pub fn call_then_on_promise(input: PromiseRaw<u32>) -> Result<PromiseRaw<String>> {
  input.then(|v| Ok(format!("{}", v.value)))
}

#[napi]
pub fn call_catch_on_promise(input: PromiseRaw<'_, u32>) -> Result<PromiseRaw<'_, String>> {
  input.catch(|e: CallbackContext<String>| Ok(e.value))
}

#[napi]
pub fn call_finally_on_promise(
  mut input: PromiseRaw<u32>,
  on_finally: FunctionRef<(), ()>,
) -> Result<PromiseRaw<u32>> {
  input.finally(move |env| {
    on_finally.borrow_back(&env)?.call(())?;
    Ok(())
  })
}

#[napi]
pub fn esm_resolve<'env>(
  _: &'env Env,
  next: Function<'env, (), PromiseRaw<'env, ()>>,
) -> Result<PromiseRaw<'env, ()>> {
  next.call(())
}

#[napi]
pub fn spawn_future_lifetime(env: &Env, input: u32) -> Result<PromiseRaw<JsString>> {
  env.spawn_future_with_callback(async move { Ok(input) }, |env, val| {
    env.create_string(format!("{}", val))
  })
}

#[napi]
pub struct ClassReturnInPromise {}

#[napi]
pub fn promise_raw_return_class_instance(env: &Env) -> Result<PromiseRaw<ClassReturnInPromise>> {
  env.spawn_future_with_callback(async move { Ok(ClassReturnInPromise {}) }, |_env, _val| {
    Ok(ClassReturnInPromise {})
  })
}
