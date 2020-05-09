#[macro_use]
extern crate napi_rs as napi;
#[macro_use]
extern crate napi_rs_derive;

extern crate futures;

use napi::{Any, CallContext, Env, Error, Object, Result, Status, Value};

register_module!(test_module, init);

fn init(env: &Env, exports: &mut Value<Object>) -> Result<Option<Value<Object>>> {
  exports.set_named_property("testSpawn", env.create_function("testSpawn", test_spawn)?)?;
  exports.set_named_property("testThrow", env.create_function("testThrow", test_throw)?)?;
  Ok(None)
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

  env.perform_async_operation(fut_values, |&mut env, len| env.create_uint32(len))
}

#[js_function]
fn test_throw(_ctx: CallContext) -> Result<Value<Any>> {
  Err(Error::from_status(Status::GenericFailure))
}
