use std::convert::TryInto;

use napi::{
  bindgen_prelude::Buffer, CallContext, Env, Error, JsNumber, JsObject, JsUnknown, Result, Task,
};

struct ComputeFib {
  n: u32,
}

impl ComputeFib {
  pub fn new(n: u32) -> ComputeFib {
    ComputeFib { n }
  }
}

impl Task for ComputeFib {
  type Output = u32;
  type JsValue = JsNumber;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(fibonacci_native(self.n))
  }

  fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
    env.create_uint32(output)
  }
}

fn fibonacci_native(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}

#[js_function(1)]
fn test_spawn_thread(ctx: CallContext) -> Result<JsUnknown> {
  let n = ctx.get::<JsNumber>(0)?;
  let task = ComputeFib::new(n.try_into()?);
  let async_promise = ctx.env.spawn(task)?;
  Ok(async_promise.promise_object().into_unknown())
}

struct CountBufferLength {
  data: Buffer,
}

impl CountBufferLength {
  pub fn new(data: Buffer) -> Self {
    Self { data }
  }
}

impl Task for CountBufferLength {
  type Output = usize;
  type JsValue = JsNumber;

  fn compute(&mut self) -> Result<Self::Output> {
    if self.data.len() == 10 {
      return Err(Error::from_reason("len can't be 5"));
    }
    Ok(self.data.len())
  }

  fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
    env.create_uint32(output as _)
  }

  fn reject(&mut self, _env: Env, err: Error) -> Result<Self::JsValue> {
    Err(err)
  }
}

#[js_function(1)]
fn test_spawn_thread_with_ref(ctx: CallContext) -> Result<JsUnknown> {
  let n = ctx.get::<Buffer>(0)?;
  let task = CountBufferLength::new(n);
  let async_work_promise = ctx.env.spawn(task)?;
  Ok(async_work_promise.promise_object().into_unknown())
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testSpawnThread", test_spawn_thread)?;
  exports.create_named_method("testSpawnThreadWithRef", test_spawn_thread_with_ref)?;
  Ok(())
}
