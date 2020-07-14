use futures::prelude::*;
use napi::{CallContext, Error, JsObject, JsString, Result, Status};
use tokio;

#[js_function(1)]
pub fn test_execute_tokio_readfile(ctx: CallContext) -> Result<JsObject> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let path_str = js_filepath.as_str()?;
  ctx.env.execute_tokio_future(
    tokio::fs::read(path_str.to_owned())
      .map(|v| v.map_err(|e| Error::new(Status::Unknown, format!("failed to read file, {}", e)))),
    |&mut env, data| env.create_buffer_with_data(data),
  )
}

#[js_function(1)]
pub fn error_from_tokio_future(ctx: CallContext) -> Result<JsObject> {
  let js_filepath = ctx.get::<JsString>(0)?;
  let path_str = js_filepath.as_str()?;
  ctx.env.execute_tokio_future(
    tokio::fs::read(path_str.to_owned())
      .map_err(Error::from)
      .and_then(|_| async move {
        Err::<Vec<u8>, Error>(Error::new(
          Status::Unknown,
          "Error from tokio future".to_owned(),
        ))
      }),
    |&mut env, data| env.create_buffer_with_data(data),
  )
}
