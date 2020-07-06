use napi::{CallContext, Env, JsBuffer, JsObject, NativeBuffer, Result, Task};

struct JsTaskResolveVec;

impl Task for JsTaskResolveVec {
  type Output = Vec<u8>;
  type JsValue = JsBuffer;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(Vec::with_capacity(1024 * 1024 * 100))
  }

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<Self::JsValue> {
    env.create_buffer_with_data(output)
  }
}

struct JsTaskResolveNativeBuffer;

impl Task for JsTaskResolveNativeBuffer {
  type Output = NativeBuffer;
  type JsValue = JsBuffer;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(NativeBuffer::with_capacity(1024 * 1024 * 100))
  }

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<Self::JsValue> {
    output.into_js_buffer(&env)
  }
}

#[js_function]
pub fn get_vec_from_async_task(ctx: CallContext) -> Result<JsObject> {
  let task = JsTaskResolveVec;
  ctx.env.spawn(task)
}

#[js_function]
pub fn get_native_buffer_from_async_task(ctx: CallContext) -> Result<JsObject> {
  let task = JsTaskResolveNativeBuffer;
  ctx.env.spawn(task)
}
