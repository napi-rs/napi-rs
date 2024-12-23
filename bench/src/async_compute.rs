use napi::threadsafe_function::*;
use napi::{bindgen_prelude::*, *};

struct BufferLength(Buffer);

impl Task for BufferLength {
  type Output = usize;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(self.0.len() + 1)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output as u32)
  }
}

#[js_function(1)]
fn bench_async_task(ctx: CallContext) -> Result<Unknown> {
  let n = ctx.get::<Buffer>(0)?;
  let task = BufferLength(n);
  let async_promise = ctx.env.spawn(task)?;
  Ok(async_promise.promise_object().into_unknown())
}

#[js_function(2)]
fn bench_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let buffer_ref = ctx.get::<Buffer>(0)?;
  let callback = ctx.get::<ThreadsafeFunction<u32, (), u32>>(1)?;

  std::thread::spawn(move || {
    callback.call(
      Ok((buffer_ref.len() + 1) as u32),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });

  ctx.env.get_undefined()
}

#[js_function(1)]
fn bench_tokio_future(ctx: CallContext) -> Result<JsObject> {
  let buffer_ref = ctx.get::<Buffer>(0)?;
  ctx
    .env
    .execute_tokio_future(async move { Ok(buffer_ref.len()) }, |env, v: usize| {
      env.create_uint32(v as u32 + 1)
    })
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("benchAsyncTask", bench_async_task)?;
  exports.create_named_method("benchThreadsafeFunction", bench_threadsafe_function)?;
  exports.create_named_method("benchTokioFuture", bench_tokio_future)?;
  Ok(())
}
