use std::path::Path;
use std::sync::Arc;
use std::thread;

use napi::{
  bindgen_prelude::{BufferSlice, Function, Object},
  threadsafe_function::ThreadsafeFunctionCallMode,
  CallContext, Error, JsString, Ref, Result, Status,
};

#[js_function(1)]
pub fn test_threadsafe_function(ctx: CallContext) -> Result<()> {
  let func = ctx.get::<Function<Vec<u32>>>(0)?;

  let tsfn = Arc::new(
    func
      .build_threadsafe_function()
      .callee_handled::<true>()
      .build()?,
  );

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

  Ok(())
}

#[js_function(1)]
pub fn test_tsfn_error(ctx: CallContext) -> Result<()> {
  let func = ctx.get::<Function<Option<Error>>>(0)?;
  let tsfn = Arc::new(
    func
      .build_threadsafe_function()
      .callee_handled::<true>()
      .build()?,
  );
  thread::spawn(move || {
    tsfn.call(
      Err(Error::new(Status::GenericFailure, "invalid".to_owned())),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });

  Ok(())
}

async fn read_file_content(filepath: &Path) -> Result<Vec<u8>> {
  tokio::fs::read(filepath)
    .await
    .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))
}

#[js_function(2)]
pub fn test_tokio_readfile(ctx: CallContext) -> Result<()> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let js_func = ctx.get::<Function<Vec<u8>>>(1)?;
  let path_str = js_filepath.into_utf8()?.into_owned()?;

  let tsfn = js_func
    .build_threadsafe_function()
    .callee_handled::<true>()
    .build_callback(move |ctx| BufferSlice::from_data(&ctx.env, ctx.value))?;
  let rt = tokio::runtime::Runtime::new()
    .map_err(|e| Error::from_reason(format!("Create tokio runtime failed {}", e)))?;

  rt.block_on(async move {
    let ret = read_file_content(Path::new(&path_str)).await;
    tsfn.call(ret, ThreadsafeFunctionCallMode::Blocking);
  });

  Ok(())
}

#[js_function(3)]
pub fn test_tsfn_with_ref(ctx: CallContext) -> Result<()> {
  let callback: Function<Ref<Object>, napi::Unknown> = ctx.get(0)?;
  let options = ctx.get::<Object>(1)?;
  let option_ref = Ref::new(ctx.env, &options);
  let tsfn = callback
    .build_threadsafe_function::<Ref<Object>>()
    .callee_handled::<true>()
    .build_callback(move |mut ctx| {
      ctx
        .env
        .get_reference_value_unchecked::<Object>(&ctx.value)
        .and_then(|obj| ctx.value.unref(&ctx.env).map(|_| obj))
    })?;

  thread::spawn(move || {
    tsfn.call(option_ref, ThreadsafeFunctionCallMode::Blocking);
  });

  Ok(())
}
