use napi::bindgen_prelude::*;

#[napi]
pub async fn async_plus_100(p: Promise<u32>) -> Result<u32> {
  let v = p.await?;
  Ok(v + 100)
}

#[napi]
pub fn call_then_on_promise(mut input: PromiseRaw<u32>) -> Result<PromiseRaw<String>> {
  input.then(|v| Ok(format!("{}", v)))
}

#[napi]
pub fn call_catch_on_promise(mut input: PromiseRaw<u32>) -> Result<PromiseRaw<String>> {
  input.catch(|e: String| Ok(format!("{}", e)))
}
