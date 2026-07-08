use std::sync::{
  atomic::{AtomicUsize, Ordering},
  Mutex,
};

use napi::{bindgen_prelude::*, Error, JsString};

static PROMISE_RAW_CALLBACK_DROP_COUNT: AtomicUsize = AtomicUsize::new(0);

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
static LIFECYCLE_STASHED_PROMISE_REJECTION: Mutex<Option<Error>> = Mutex::new(None);

struct PromiseRawCallbackDropProbe;

impl Drop for PromiseRawCallbackDropProbe {
  fn drop(&mut self) {
    PROMISE_RAW_CALLBACK_DROP_COUNT.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
pub async fn async_plus_100(p: Promise<u32>) -> Result<u32> {
  let v = p.await?;
  Ok(v + 100)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashPromiseRejectionAcrossDuplicateLoad")]
pub async fn stash_promise_rejection_across_duplicate_load(promise: Promise<()>) -> Result<()> {
  let rejection = match promise.await {
    Ok(()) => return Err(Error::from_reason("expected Promise rejection")),
    Err(rejection) => rejection,
  };
  *LIFECYCLE_STASHED_PROMISE_REJECTION
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(rejection);
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "throwPromiseRejectionAcrossDuplicateLoad")]
pub fn throw_promise_rejection_across_duplicate_load() -> Result<()> {
  let rejection = LIFECYCLE_STASHED_PROMISE_REJECTION
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .take()
    .ok_or_else(|| Error::from_reason("no Promise rejection was stashed"))?;
  Err(rejection)
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
  input: PromiseRaw<u32>,
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

#[napi]
pub fn reset_promise_raw_callback_drop_count() {
  PROMISE_RAW_CALLBACK_DROP_COUNT.store(0, Ordering::SeqCst);
}

#[napi]
pub fn promise_raw_callback_drop_count() -> u32 {
  PROMISE_RAW_CALLBACK_DROP_COUNT.load(Ordering::SeqCst) as u32
}

#[napi]
pub fn promise_raw_then_callback_drop_probe(
  input: PromiseRaw<'_, ()>,
) -> Result<PromiseRaw<'_, ()>> {
  let probe = PromiseRawCallbackDropProbe;
  input.then(move |_| {
    drop(probe);
    Ok(())
  })
}

#[napi]
pub fn promise_raw_catch_callback_drop_probe(
  input: PromiseRaw<'_, ()>,
) -> Result<PromiseRaw<'_, ()>> {
  let probe = PromiseRawCallbackDropProbe;
  input.catch(move |_: CallbackContext<String>| {
    drop(probe);
    Ok(())
  })
}

#[napi]
pub fn promise_raw_finally_callback_drop_probe(
  input: PromiseRaw<'_, ()>,
) -> Result<PromiseRaw<'_, ()>> {
  let probe = PromiseRawCallbackDropProbe;
  input.finally(move |_| {
    drop(probe);
    Ok(())
  })
}

#[napi]
pub fn promise_raw_then_callback_panic(input: PromiseRaw<'_, ()>) -> Result<PromiseRaw<'_, ()>> {
  let probe = PromiseRawCallbackDropProbe;
  input.then(move |_| -> Result<()> {
    drop(probe);
    panic!("PromiseRaw then callback panic");
  })
}

#[napi]
pub fn promise_raw_catch_callback_panic(input: PromiseRaw<'_, ()>) -> Result<PromiseRaw<'_, ()>> {
  let probe = PromiseRawCallbackDropProbe;
  input.catch(move |_: CallbackContext<String>| -> Result<()> {
    drop(probe);
    panic!("PromiseRaw catch callback panic");
  })
}

#[napi]
pub fn promise_raw_finally_callback_panic(input: PromiseRaw<'_, ()>) -> Result<PromiseRaw<'_, ()>> {
  let probe = PromiseRawCallbackDropProbe;
  input.finally(move |_| -> Result<()> {
    drop(probe);
    panic!("PromiseRaw finally callback panic");
  })
}
