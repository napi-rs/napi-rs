use napi::{
  bindgen_prelude::Function, threadsafe_function::ThreadsafeFunction, CallContext, JsObject,
  JsUndefined,
};
use napi_derive::js_function;

#[derive(Clone)]
pub struct A {
  pub cb: ThreadsafeFunction<String, napi::JsUnknown, String, false>,
}

#[js_function(1)]
pub fn constructor(ctx: CallContext) -> napi::Result<JsUndefined> {
  let callback = ctx.get::<Function<String>>(0)?;

  let cb: ThreadsafeFunction<String, napi::JsUnknown, String, false> =
    callback.build_threadsafe_function().build()?;

  let mut this: JsObject = ctx.this_unchecked();
  let obj = A { cb };

  ctx.env.wrap(&mut this, obj, None)?;
  ctx.env.get_undefined()
}

#[js_function]
pub fn call(ctx: CallContext) -> napi::Result<JsUndefined> {
  let this = ctx.this_unchecked();
  let obj = ctx.env.unwrap::<A>(&this)?;
  obj.cb.call(
    "ThreadsafeFunction NonBlocking Call".to_owned(),
    napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
  );
  ctx.env.get_undefined()
}

#[js_function]
pub fn unref(ctx: CallContext) -> napi::Result<JsUndefined> {
  let this = ctx.this_unchecked();
  let obj = ctx.env.unwrap::<A>(&this)?;
  obj.cb.unref(ctx.env)?;
  ctx.env.get_undefined()
}
