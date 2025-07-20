use std::sync::Arc;

use napi::{
  bindgen_prelude::{Function, JsObjectValue, Object},
  threadsafe_function::ThreadsafeFunction,
  CallContext, Status,
};
use napi_derive::js_function;

#[derive(Clone)]
pub struct A {
  pub cb: Arc<ThreadsafeFunction<String, napi::Unknown<'static>, String, Status, false, true>>,
}

#[js_function(1)]
pub fn constructor(ctx: CallContext) -> napi::Result<()> {
  let callback = ctx.get::<Function<String>>(0)?;

  let cb: Arc<ThreadsafeFunction<String, napi::Unknown, String, Status, false, true>> = Arc::new(
    callback
      .build_threadsafe_function()
      .weak::<true>()
      .build()?,
  );

  let mut this = ctx.this_unchecked::<Object<'_>>();
  let obj = A { cb };

  this.wrap(obj, None)?;
  Ok(())
}

#[js_function]
pub fn call(ctx: CallContext) -> napi::Result<()> {
  let this = ctx.this_unchecked::<Object<'_>>();
  let obj = this.unwrap::<A>()?;
  obj.cb.call(
    "ThreadsafeFunction NonBlocking Call".to_owned(),
    napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
  );
  Ok(())
}
