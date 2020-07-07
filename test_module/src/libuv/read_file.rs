use std::thread;
use std::fs;

use futures::prelude::*;
use futures::channel::oneshot;
use napi::{CallContext, Result, JsString, JsObject, Status, Error};

#[js_function(1)]
pub fn uv_read_file(ctx: CallContext) -> Result<JsObject> {
  let path = ctx.get::<JsString>(0)?;
  let (sender, receiver) = oneshot::channel();
  let p = path.as_str()?.to_owned();
  thread::spawn(|| {
    let res = fs::read(p).map_err(|e| Error::new(Status::Unknown, format!("{}", e)));
    sender.send(res).expect("Send data failed");
  });
  ctx.env.execute(receiver.map_err(|e| Error::new(Status::Unknown, format!("{}", e))).map(|x| x.and_then(|x| x)), |&mut env, data| {
    env.create_buffer_with_data(data)
  })
}
