use std::fs;
use std::thread;

use futures::channel::oneshot;
use futures::prelude::*;
use napi::{CallContext, Error, JsObject, JsString, Module, Result, Status};

#[js_function(1)]
pub fn uv_read_file(ctx: CallContext) -> Result<JsObject> {
  let path = ctx.get::<JsString>(0)?;
  let (sender, receiver) = oneshot::channel();
  let p = path.as_str()?.to_owned();
  thread::spawn(|| {
    let res = fs::read(p).map_err(|e| Error::new(Status::Unknown, format!("{}", e)));
    sender.send(res).expect("Send data failed");
  });
  ctx.env.execute(
    receiver
      .map_err(|e| Error::new(Status::Unknown, format!("{}", e)))
      .map(|x| x.and_then(|x| x)),
    |env, data| env.create_buffer_with_data(data),
  )
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("uvReadFile", uv_read_file)?;
  Ok(())
}
