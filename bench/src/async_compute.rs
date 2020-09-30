use napi::{
  CallContext, Env, JsBuffer, JsBufferValue, JsNumber, JsObject, Module, Ref, Result, Task,
};

#[repr(transparent)]
struct BufferLength(Ref<JsBufferValue>);

impl Task for BufferLength {
  type Output = usize;
  type JsValue = JsNumber;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok((&self.0).len())
  }

  fn resolve(self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
    self.0.unref(env)?;
    env.create_uint32(output as u32)
  }
}

#[js_function(1)]
fn bench_async_task(ctx: CallContext) -> Result<JsObject> {
  let n = ctx.get::<JsBuffer>(0)?;
  let task = BufferLength(n.into_ref()?);
  let async_promise = ctx.env.spawn(task)?;
  Ok(async_promise.promise_object())
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("benchAsyncTask", bench_async_task)?;
  Ok(())
}
