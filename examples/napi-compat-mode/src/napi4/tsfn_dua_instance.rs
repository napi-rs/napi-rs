use napi::{
  threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction},
  CallContext, JsFunction, JsObject, JsUndefined,
};
use napi_derive::js_function;

#[derive(Clone)]
pub struct A {
  pub cb: ThreadsafeFunction<String>,
}

#[js_function(1)]
pub fn constructor(ctx: CallContext) -> napi::Result<JsUndefined> {
  let callback = ctx.get::<JsFunction>(0)?;

  let cb =
    ctx
      .env
      .create_threadsafe_function(&callback, 0, |ctx: ThreadSafeCallContext<String>| {
        ctx
          .env
          .create_string_from_std(ctx.value)
          .map(|js_string| vec![js_string])
      })?;

  let mut this: JsObject = ctx.this_unchecked();
  let obj = A { cb };

  ctx.env.wrap(&mut this, obj)?;
  ctx.env.get_undefined()
}

#[js_function]
pub fn call(ctx: CallContext) -> napi::Result<JsUndefined> {
  let this = ctx.this_unchecked();
  let obj = ctx.env.unwrap::<A>(&this)?;
  obj.cb.call(
    Ok("ThreadsafeFunction NonBlocking Call".to_owned()),
    napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
  );
  ctx.env.get_undefined()
}

#[js_function]
pub fn unref(ctx: CallContext) -> napi::Result<JsUndefined> {
  let this = ctx.this_unchecked();
  let obj = ctx.env.unwrap::<A>(&this)?;
  obj.cb.unref(&ctx.env)?;
  ctx.env.get_undefined()
}
