use futures::prelude::*;
use napi::{CallContext, Error, JsObject, JsString, Result, Status};

#[js_function(1)]
pub fn test_execute_tokio_readfile(ctx: CallContext) -> Result<JsObject> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let path_str = js_filepath.into_utf8()?.into_owned()?;
  ctx.env.execute_tokio_future(
    tokio::fs::read(path_str).map(|v| {
      v.map_err(|e| {
        Error::new(
          Status::GenericFailure,
          format!("failed to read file, {}", e),
        )
      })
    }),
    |&mut env, data| env.create_buffer_with_data(data).map(|v| v.into_raw()),
  )
}

#[js_function(1)]
pub fn error_from_tokio_future(ctx: CallContext) -> Result<JsObject> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let path_str = js_filepath.into_utf8()?.into_owned()?;
  ctx.env.execute_tokio_future(
    tokio::fs::read(path_str)
      .map_err(Error::from)
      .and_then(|_| async move {
        Err::<Vec<u8>, Error>(Error::new(
          Status::GenericFailure,
          "Error from tokio future".to_owned(),
        ))
      }),
    |&mut env, data| env.create_buffer_with_data(data).map(|v| v.into_raw()),
  )
}
