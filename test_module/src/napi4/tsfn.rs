use std::path::Path;
use std::thread;

use napi::{
  threadsafe_function::{
    ThreadSafeCallContext, ThreadsafeFunctionCallMode, ThreadsafeFunctionReleaseMode,
  },
  CallContext, Error, JsFunction, JsNumber, JsString, JsUndefined, Result, Status,
};
use tokio;

#[js_function(1)]
pub fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<JsFunction>(0)?;

  let tsfn =
    ctx
      .env
      .create_threadsafe_function(func, 0, |ctx: ThreadSafeCallContext<Vec<u32>>| {
        ctx
          .value
          .iter()
          .map(|v| ctx.env.create_uint32(*v))
          .collect::<Result<Vec<JsNumber>>>()
      })?;

  thread::spawn(move || {
    let output: Vec<u32> = vec![42, 1, 2, 3];
    // It's okay to call a threadsafe function multiple times.
    tsfn.call(Ok(output.clone()), ThreadsafeFunctionCallMode::Blocking);
    tsfn.call(Ok(output.clone()), ThreadsafeFunctionCallMode::NonBlocking);
    tsfn.release(ThreadsafeFunctionReleaseMode::Release);
  });

  ctx.env.get_undefined()
}

#[js_function(1)]
pub fn test_tsfn_error(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<JsFunction>(0)?;
  let tsfn = ctx
    .env
    .create_threadsafe_function(func, 0, |ctx: ThreadSafeCallContext<()>| {
      ctx.env.get_undefined().map(|v| vec![v])
    })?;
  thread::spawn(move || {
    tsfn.call(
      Err(Error::new(Status::Unknown, "invalid".to_owned())),
      ThreadsafeFunctionCallMode::Blocking,
    );
    tsfn.release(ThreadsafeFunctionReleaseMode::Release);
  });

  ctx.env.get_undefined()
}

async fn read_file_content(filepath: &Path) -> Result<Vec<u8>> {
  tokio::fs::read(filepath)
    .await
    .map_err(|e| Error::new(Status::Unknown, format!("{}", e)))
}

#[js_function(2)]
pub fn test_tokio_readfile(ctx: CallContext) -> Result<JsUndefined> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let js_func = ctx.get::<JsFunction>(1)?;
  let path_str = js_filepath.into_utf8()?.to_owned()?;

  let tsfn =
    ctx
      .env
      .create_threadsafe_function(js_func, 0, |ctx: ThreadSafeCallContext<Vec<u8>>| {
        ctx
          .env
          .create_buffer_with_data(ctx.value)
          .map(|v| vec![v.into_raw()])
      })?;
  let rt = tokio::runtime::Runtime::new()
    .map_err(|e| Error::from_reason(format!("Create tokio runtime failed {}", e)))?;

  rt.block_on(async move {
    let ret = read_file_content(&Path::new(&path_str)).await;
    tsfn.call(ret, ThreadsafeFunctionCallMode::Blocking);
    tsfn.release(ThreadsafeFunctionReleaseMode::Release);
  });

  ctx.env.get_undefined()
}
