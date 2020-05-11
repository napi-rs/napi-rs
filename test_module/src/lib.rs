#[macro_use]
extern crate napi_rs as napi;
#[macro_use]
extern crate napi_rs_derive;

extern crate futures;

use napi::{Any, CallContext, Env, Error, Number, Object, Result, Status, Task, Value};
use std::convert::TryInto;

register_module!(test_module, init);

fn init(env: &Env, exports: &mut Value<Object>) -> Result<()> {
  exports.set_named_property("testSpawn", env.create_function("testSpawn", test_spawn)?)?;
  exports.set_named_property("testThrow", env.create_function("testThrow", test_throw)?)?;
  exports.set_named_property(
    "testSpawnThread",
    env.create_function("testSpawnThread", test_spawn_thread)?,
  )?;
  Ok(())
}

#[js_function]
fn test_spawn(ctx: CallContext) -> Result<Value<Object>> {
  use futures::executor::ThreadPool;
  use futures::StreamExt;
  let env = ctx.env;
  let pool = ThreadPool::new().expect("Failed to build pool");
  let (tx, rx) = futures::channel::mpsc::unbounded::<i32>();
  let fut_values = async move {
    let fut_tx_result = async move {
      (0..200).for_each(|v| {
        tx.unbounded_send(v).expect("Failed to send");
      })
    };
    pool.spawn_ok(fut_tx_result);
    let fut = rx.map(|v| v * 2).collect::<Vec<i32>>();
    let results = fut.await;
    println!("Collected result lenght {}", results.len());
    Ok(results.len() as u32)
  };

  env.execute(fut_values, |&mut env, len| env.create_uint32(len))
}

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
  type JsValue = Number;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(fibonacci_native(self.n))
  }

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<Value<Self::JsValue>> {
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
fn test_spawn_thread(ctx: CallContext) -> Result<Value<Object>> {
  let n = ctx.get::<Number>(0)?;
  let task = ComputeFib::new(n.try_into()?);
  ctx.env.spawn(task)
}

#[js_function]
fn test_throw(_ctx: CallContext) -> Result<Value<Any>> {
  Err(Error::from_status(Status::GenericFailure))
}
