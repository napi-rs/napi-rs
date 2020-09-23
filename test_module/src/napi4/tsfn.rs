use std::path::Path;
use std::thread;

use napi::{
  CallContext, Env, Error, JsFunction, JsString, JsUndefined, JsUnknown, Result, Status,
  ThreadSafeCallContext, ThreadsafeFunctionCallMode, ThreadsafeFunctionReleaseMode,
};
use tokio;

#[js_function(1)]
pub fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<JsFunction>(0)?;

  let tsfn = ctx
    .env
    .create_threadsafe_function(func, 0, |ctx| Ok(vec![ctx.env.get_undefined().unwrap()]))?;

  thread::spawn(move || {
    let output: Vec<u8> = vec![42, 1, 2, 3];
    // It's okay to call a threadsafe function multiple times.
    tsfn.call(Ok(output.clone()), ThreadsafeFunctionCallMode::Blocking);
    tsfn.call(Ok(output.clone()), ThreadsafeFunctionCallMode::Blocking);
    tsfn.release(ThreadsafeFunctionReleaseMode::Release);
  });

  ctx.env.get_undefined()
}

// #[js_function(1)]
// pub fn test_tsfn_error(ctx: CallContext) -> Result<JsUndefined> {
//   let func = ctx.get::<JsFunction>(0)?;
//   let tsfn = ctx
//     .env
//     .create_threadsafe_function(func, 0, |env, value| env.get_undefined())?;

//   thread::spawn(move || {
//     tsfn.call(
//       Err(Error::new(Status::Unknown, "invalid".to_owned())),
//       ThreadsafeFunctionCallMode::Blocking,
//     );
//     tsfn.release(ThreadsafeFunctionReleaseMode::Release);
//   });

//   ctx.env.get_undefined()
// }

// async fn read_file_content(filepath: &Path) -> Result<Vec<u8>> {
//   tokio::fs::read(filepath)
//     .await
//     .map_err(|_| Error::new(Status::Unknown, "failed to read file".to_owned()))
// }

// #[js_function(2)]
// pub fn test_tokio_readfile(ctx: CallContext) -> Result<JsUndefined> {
//   let js_filepath = ctx.get::<JsString>(0)?;
//   let js_func = ctx.get::<JsFunction>(1)?;
//   let path_str = js_filepath.as_str()?;

//   let tsfn = ThreadsafeFunction::create(ctx.env, js_func, to_js, 0)?;
//   let mut rt = tokio::runtime::Runtime::new().unwrap();

//   rt.block_on(async move {
//     let mut filepath = Path::new(path_str);
//     let ret = read_file_content(&mut filepath).await;
//     let _ = tsfn.call(ret, ThreadsafeFunctionCallMode::Blocking);
//     tsfn.release(ThreadsafeFunctionReleaseMode::Release);
//   });

//   ctx.env.get_undefined()
// }
