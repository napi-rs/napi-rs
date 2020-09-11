use std::convert::TryInto;

use napi::{CallContext, Env, JsNumber, JsObject, Module, Result, Task};

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

  fn resolve(self, env: &mut Env, output: Self::Output) -> Result<Self::JsValue> {
    env.create_uint32(output)
  }
}

#[inline]
fn fibonacci_native(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}

#[js_function(1)]
fn test_spawn_thread(ctx: CallContext) -> Result<JsObject> {
  let n = ctx.get::<JsNumber>(0)?;
  let task = ComputeFib::new(n.try_into()?);
  ctx.env.spawn(task)
}

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("testSpawnThread", test_spawn_thread)?;
  Ok(())
}
