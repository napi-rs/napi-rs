use napi::threadsafe_function::*;
use napi::*;

struct BufferLength(Ref<JsBufferValue>);

impl Task for BufferLength {
  type Output = usize;
  type JsValue = JsNumber;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(self.0.len() + 1)
  }

  fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
    env.create_uint32(output as u32)
  }

  fn finally(&mut self, env: Env) -> Result<()> {
    self.0.unref(env)?;
    Ok(())
  }
}

#[js_function(1)]
fn bench_async_task(ctx: CallContext) -> Result<JsObject> {
  let n = ctx.get::<JsBuffer>(0)?;
  let task = BufferLength(n.into_ref()?);
  let async_promise = ctx.env.spawn(task)?;
  Ok(async_promise.promise_object())
}

#[js_function(2)]
fn bench_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
  let buffer_ref = ctx.get::<JsBuffer>(0)?.into_ref()?;
  let callback = ctx.get::<JsFunction>(1)?;

  let tsfn = ctx.env.create_threadsafe_function(
    &callback,
    0,
    |mut ctx: ThreadSafeCallContext<(usize, Ref<JsBufferValue>)>| {
      ctx
        .env
        .create_uint32(ctx.value.0 as u32)
        .and_then(|v| ctx.value.1.unref(ctx.env).map(|_| vec![v]))
    },
  )?;

  std::thread::spawn(move || {
    tsfn.call(
      Ok((buffer_ref.len() + 1, buffer_ref)),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });

  ctx.env.get_undefined()
}

#[js_function(1)]
fn bench_tokio_future(ctx: CallContext) -> Result<JsObject> {
  let buffer_ref = ctx.get::<JsBuffer>(0)?.into_ref()?;
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
