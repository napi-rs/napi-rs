use std::path::Path;
use std::thread;

use napi::sys::{
  napi_threadsafe_function_call_mode::napi_tsfn_blocking,
  napi_threadsafe_function_release_mode::napi_tsfn_release,
};
use napi::threadsafe_function::{ThreadsafeFunction, ToJs};
use napi::{
  CallContext, Env, Error, JsBuffer, JsFunction, JsNumber, JsString, JsUndefined, Result, Status,
};
use tokio;

#[derive(Clone, Copy)]
struct HandleNumber;

impl ToJs for HandleNumber {
  type Output = u8;
  type JsValue = JsNumber;

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<(u64, Self::JsValue)> {
    let argv: u64 = 1;

    let value = env.create_uint32(output as u32)?;

    Ok((argv, value))
  }
}

#[js_function(1)]
pub fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<JsFunction>(0)?;

  let to_js = HandleNumber;
  let tsfn = ThreadsafeFunction::create(ctx.env, func, to_js, 0)?;

  thread::spawn(move || {
    let output: u8 = 42;
    // It's okay to call a threadsafe function multiple times.
    tsfn.call(Ok(output), napi_tsfn_blocking).unwrap();
    tsfn.call(Ok(output), napi_tsfn_blocking).unwrap();
    tsfn.release(napi_tsfn_release).unwrap();
  });

  ctx.env.get_undefined()
}

#[js_function(1)]
pub fn test_tsfn_error(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<JsFunction>(0)?;
  let to_js = HandleNumber;
  let tsfn = ThreadsafeFunction::create(ctx.env, func, to_js, 0)?;

  thread::spawn(move || {
    tsfn
      .call(
        Err(Error::new(Status::Unknown, "invalid".to_owned())),
        napi_tsfn_blocking,
      )
      .unwrap();
    tsfn.release(napi_tsfn_release).unwrap();
  });

  ctx.env.get_undefined()
}

#[derive(Copy, Clone)]
struct HandleBuffer;

impl ToJs for HandleBuffer {
  type Output = Vec<u8>;
  type JsValue = JsBuffer;

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<(u64, JsBuffer)> {
    let value = env.create_buffer_with_data(output.to_vec())?;
    Ok((1u64, value))
  }
}

async fn read_file_content(filepath: &Path) -> Result<Vec<u8>> {
  tokio::fs::read(filepath)
    .await
    .map_err(|_| Error::new(Status::Unknown, "failed to read file".to_owned()))
}

#[js_function(2)]
pub fn test_tokio_readfile(ctx: CallContext) -> Result<JsUndefined> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let js_func = ctx.get::<JsFunction>(1)?;
  let path_str = js_filepath.as_str()?;

  let to_js = HandleBuffer;
  let tsfn = ThreadsafeFunction::create(ctx.env, js_func, to_js, 0)?;
  let mut rt = tokio::runtime::Runtime::new().unwrap();

  rt.block_on(async move {
    let mut filepath = Path::new(path_str);
    let ret = read_file_content(&mut filepath).await;
    let _ = tsfn.call(ret, napi_tsfn_blocking);
    tsfn.release(napi_tsfn_release).unwrap();
  });

  ctx.env.get_undefined()
}
