#[macro_use]
extern crate napi_rs as napi;

use napi::{futures, Any, Env, Error, Object, Result, Status, Value};

register_module!(test_module, init);

fn init<'env>(
  env: &'env Env,
  exports: &'env mut Value<'env, Object>,
) -> Result<Option<Value<'env, Object>>> {
  exports.set_named_property(
    "testSpawn",
    env.create_function("testSpawn", callback!(test_spawn)),
  )?;
  exports.set_named_property(
    "testThrow",
    env.create_function("testThrow", callback!(test_throw)),
  )?;
  Ok(None)
}

fn test_spawn<'a>(
  env: &'a Env,
  _this: Value<'a, Any>,
  _args: &[Value<'a, Any>],
) -> Result<Option<Value<'a, Any>>> {
  use futures::executor::ThreadPool;
  use futures::StreamExt;

  let async_context = env.async_init(None, "test_spawn")?;
  let pool = ThreadPool::new().expect("Failed to build pool");
  let (promise, deferred) = env.create_promise()?;
  let (tx, rx) = futures::channel::mpsc::unbounded::<i32>();
  let fut_values = async move {
    let fut_tx_result = async move {
      (0..100).for_each(|v| {
        tx.unbounded_send(v).expect("Failed to send");
      })
    };
    pool.spawn_ok(fut_tx_result);
    let fut_values = rx.map(|v| v * 2).collect::<Vec<i32>>();
    let results = fut_values.await;
    if !cfg!(windows) {
      println!("Collected result lenght {}", results.len());
    };
    async_context.enter(|env| {
      env
        .resolve_deferred(deferred, env.get_undefined().unwrap())
        .unwrap();
    });
  };

  env.create_executor().execute(fut_values);

  Ok(Some(promise.try_into().unwrap()))
}

fn test_throw<'a>(
  _env: &'a Env,
  _this: Value<'a, Any>,
  _args: &[Value<'a, Any>],
) -> Result<Option<Value<'a, Any>>> {
  Err(Error::new(Status::GenericFailure))
}
