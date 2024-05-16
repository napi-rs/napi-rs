use std::{borrow::Borrow, path::Path};
use std::thread;

use napi::{
  bindgen_prelude::{Buffer, Function,Reference},
  threadsafe_function::{ ThreadsafeFunctionCallMode},
  CallContext, Error, JsBoolean, JsNumber, JsObject, JsString, JsUndefined, Ref, Result, Status,
};

#[js_function(1)]
pub fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<Function<Vec<u32>>>(0)?;

  let tsfn = func.build_threadsafe_function().build()?;

  let tsfn_cloned = tsfn.clone();

  thread::spawn(move || {
    let output: Vec<u32> = vec![0, 1, 2, 3];
    // It's okay to call a threadsafe function multiple times.
    tsfn.call(output, ThreadsafeFunctionCallMode::Blocking);
  });

  thread::spawn(move || {
    let output: Vec<u32> = vec![3, 2, 1, 0];
    // It's okay to call a threadsafe function multiple times.
    tsfn_cloned.call(output, ThreadsafeFunctionCallMode::NonBlocking);
  });

  ctx.env.get_undefined()
}

#[js_function(1)]
pub fn test_abort_threadsafe_function(ctx: CallContext) -> Result<JsBoolean> {
  let func = ctx.get::<Function<Vec<JsNumber>>>(0)?;

  let tsfn = func.build_threadsafe_function().build()?;

  let tsfn_cloned = tsfn.clone();

  tsfn_cloned.abort()?;
  ctx.env.get_boolean(tsfn.aborted())
}

#[js_function(1)]
pub fn test_abort_independent_threadsafe_function(ctx: CallContext) -> Result<JsBoolean> {
  let func = ctx.get::<Function>(0)?;

  let tsfn = func.build_threadsafe_function().build()?;

  let tsfn_other = func.build_threadsafe_function().build()?;

  tsfn_other.abort()?;
  ctx.env.get_boolean(tsfn.aborted())
}

#[js_function(1)]
pub fn test_call_aborted_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<Function<u32>>(0)?;

  let tsfn = func.build_threadsafe_function().build()?;

  let tsfn_clone = tsfn.clone();
  tsfn_clone.abort()?;

  let call_status = tsfn.call(1, ThreadsafeFunctionCallMode::NonBlocking);
  assert!(call_status != Status::Ok);
  ctx.env.get_undefined()
}

#[js_function(1)]
pub fn test_tsfn_error(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<Function<Option<Error>>>(0)?;
  let tsfn = func.build_threadsafe_function().build()?;
  thread::spawn(move || {
    tsfn.call(
      Some(Error::new(Status::GenericFailure, "invalid".to_owned())),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });

  ctx.env.get_undefined()
}

async fn read_file_content(filepath: &Path) -> Result<Vec<u8>> {
  tokio::fs::read(filepath)
    .await
    .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))
}

#[js_function(2)]
pub fn test_tokio_readfile(ctx: CallContext) -> Result<JsUndefined> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let js_func = ctx.get::<Function<Buffer>>(1)?;
  let path_str = js_filepath.into_utf8()?.into_owned()?;

  let tsfn = js_func.build_threadsafe_function().build()?;
  let rt = tokio::runtime::Runtime::new()
    .map_err(|e| Error::from_reason(format!("Create tokio runtime failed {}", e)))?;

  rt.block_on(async move {
    let ret = read_file_content(Path::new(&path_str)).await.unwrap();
    tsfn.call(ret.into(), ThreadsafeFunctionCallMode::Blocking);
  });

  ctx.env.get_undefined()
}

#[js_function(2)]
pub fn test_tsfn_with_ref(ctx: CallContext) -> Result<JsUndefined> {
  let callback = ctx.get::<Function<Reference<JsObject>>>(0)?;
  let options = ctx.get::<Reference<JsObject>>(1)?;
  let env = ctx.env;
  let tsfn = callback.build_threadsafe_function().build()?;

  thread::spawn(move || {
    tsfn.call(options.borrow().clone(*env).unwrap(), ThreadsafeFunctionCallMode::Blocking);
  });

  ctx.env.get_undefined()
}
