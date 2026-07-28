use napi::{bindgen_prelude::*, Error, JsString};

#[napi]
pub async fn async_plus_100(p: Promise<u32>) -> Result<u32> {
  let v = p.await?;
  Ok(v + 100)
}

/// Awaits `p` and reports how Rust saw the rejection, as
/// `"<status>|<reason>|<cause chain>"`, where the cause chain is `-` when there
/// is none and otherwise the `reason` of each link joined by `<`.
///
/// JavaScript lets a promise reject with any value, including primitives that
/// `napi_create_reference` refuses. This exists to pin down that such a
/// rejection still arrives as itself instead of as a reference-creation
/// failure, and that its `cause` chain survives the capture.
#[napi]
pub async fn describe_promise_rejection(p: Promise<()>) -> Result<String> {
  match p.await {
    Ok(()) => Ok("resolved||-".to_owned()),
    Err(error) => {
      let mut causes = Vec::new();
      let mut cause = error.cause.as_deref();
      while let Some(link) = cause {
        causes.push(link.reason.clone());
        cause = link.cause.as_deref();
      }
      Ok(format!(
        "{}|{}|{}",
        error.status.as_ref(),
        error.reason,
        if causes.is_empty() {
          "-".to_owned()
        } else {
          causes.join("<")
        }
      ))
    }
  }
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
pub fn spawn_future_lifetime<'env>(
  env: &'env Env,
  input: u32,
) -> Result<PromiseRaw<'env, JsString<'env>>> {
  env.spawn_future_with_callback(async move { Ok(input) }, |env, val| {
    env.create_string(format!("{}", val))
  })
}

#[napi]
pub struct ClassReturnInPromise {}

#[napi]
pub fn promise_raw_return_class_instance<'env>(
  env: &'env Env,
) -> Result<PromiseRaw<'env, ClassReturnInPromise>> {
  env.spawn_future_with_callback(async move { Ok(ClassReturnInPromise {}) }, |_env, _val| {
    Ok(ClassReturnInPromise {})
  })
}

#[napi]
pub fn create_resolved_promise<'env>(env: &'env Env, value: u32) -> Result<PromiseRaw<'env, u32>> {
  PromiseRaw::resolve(env, value)
}

#[napi]
pub fn create_rejected_promise<'env>(
  env: &'env Env,
  message: String,
) -> Result<PromiseRaw<'env, u32>> {
  PromiseRaw::reject(env, Error::from_reason(message))
}
