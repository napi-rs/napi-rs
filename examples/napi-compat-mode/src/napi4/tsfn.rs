use std::path::Path;
use std::thread;

use napi::{
  bindgen_prelude::Function, threadsafe_function::ThreadsafeFunctionCallMode, CallContext, Error,
  JsBoolean, JsNumber, JsObject, JsString, JsUndefined, Ref, Result, Status,
};

#[js_function(1)]
pub fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let func = ctx.get::<Function<Vec<u32>>>(0)?;

  let tsfn = func
    .build_threadsafe_function()
    .callee_handled::<true>()
    .build()?;

  let tsfn_cloned = tsfn.clone();

  thread::spawn(move || {
    let output: Vec<u32> = vec![0, 1, 2, 3];
    // It's okay to call a threadsafe function multiple times.
    tsfn.call(Ok(output), ThreadsafeFunctionCallMode::Blocking);
  });

  thread::spawn(move || {
    let output: Vec<u32> = vec![3, 2, 1, 0];
    // It's okay to call a threadsafe function multiple times.
    tsfn_cloned.call(Ok(output), ThreadsafeFunctionCallMode::NonBlocking);
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
  let tsfn = func
    .build_threadsafe_function()
    .callee_handled::<true>()
    .build()?;
  thread::spawn(move || {
    tsfn.call(
      Err(Error::new(Status::GenericFailure, "invalid".to_owned())),
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
  let js_func = ctx.get::<Function<Vec<u8>>>(1)?;
  let path_str = js_filepath.into_utf8()?.into_owned()?;

  let tsfn = js_func
    .build_threadsafe_function()
    .callee_handled::<true>()
    .build_callback(move |ctx| {
      ctx
        .env
        .create_buffer_with_data(ctx.value)
        .map(|v| v.into_raw())
    })?;
  let rt = tokio::runtime::Runtime::new()
    .map_err(|e| Error::from_reason(format!("Create tokio runtime failed {}", e)))?;

  rt.block_on(async move {
    let ret = read_file_content(Path::new(&path_str)).await;
    tsfn.call(ret, ThreadsafeFunctionCallMode::Blocking);
  });

  ctx.env.get_undefined()
}

#[js_function(3)]
pub fn test_tsfn_with_ref(ctx: CallContext) -> Result<JsUndefined> {
  let callback: Function<Ref<()>, napi::JsUnknown> = ctx.get::<Function<Ref<()>>>(0)?;
  let options = ctx.get::<JsObject>(1)?;
  let option_ref = ctx.env.create_reference(options);
  let tsfn = callback
    .build_threadsafe_function()
    .callee_handled::<true>()
    .build_callback(move |mut ctx| {
      ctx
        .env
        .get_reference_value_unchecked::<JsObject>(&ctx.value)
        .and_then(|obj| ctx.value.unref(ctx.env).map(|_| obj))
    })?;

  thread::spawn(move || {
    tsfn.call(option_ref, ThreadsafeFunctionCallMode::Blocking);
  });

  ctx.env.get_undefined()
}
