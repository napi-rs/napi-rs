use std::{thread, time::Duration};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode},
  JsBoolean, JsString,
};

#[napi]
pub fn call_threadsafe_function(callback: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<u32, Unknown, ErrorStrategy::CalleeHandled> =
    callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value + 1]))?;
  for n in 0..100 {
    let tsfn = tsfn.clone();
    thread::spawn(move || {
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    });
  }
  Ok(())
}

#[napi]
pub fn call_long_threadsafe_function(callback: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<u32, Unknown, ErrorStrategy::CalleeHandled> =
    callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value + 1]))?;
  thread::spawn(move || {
    for n in 0..10 {
      thread::sleep(Duration::from_millis(100));
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    }
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_throw_error(cb: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<bool, Unknown, ErrorStrategy::CalleeHandled> =
    cb.create_threadsafe_function(0, |ctx| ctx.env.get_boolean(ctx.value).map(|v| vec![v]))?;
  thread::spawn(move || {
    tsfn.call(
      Err(Error::new(
        Status::GenericFailure,
        "ThrowFromNative".to_owned(),
      )),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode(cb: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<bool, Unknown, ErrorStrategy::Fatal> =
    cb.create_threadsafe_function(0, |ctx| ctx.env.get_boolean(ctx.value).map(|v| vec![v]))?;
  thread::spawn(move || {
    tsfn.call(true, ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode_error(cb: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<bool, Unknown, ErrorStrategy::Fatal> = cb
    .create_threadsafe_function(0, |_ctx| {
      Err::<Vec<JsBoolean>, Error>(Error::new(
        Status::GenericFailure,
        "Generic tsfn error".to_owned(),
      ))
    })?;
  thread::spawn(move || {
    tsfn.call(true, ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
fn threadsafe_function_closure_capture(func: JsFunction) -> napi::Result<()> {
  let str = "test";
  let tsfn: ThreadsafeFunction<()> = func
    .create_threadsafe_function(0, move |_| {
      println!("{}", str); // str is NULL at this point
      Ok(Vec::<JsString>::new())
    })
    .unwrap();

  tsfn.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);

  Ok(())
}

#[napi]
pub fn tsfn_call_with_callback(func: JsFunction) -> napi::Result<()> {
  let tsfn: ThreadsafeFunction<(), String> =
    func.create_threadsafe_function(0, move |_| Ok(Vec::<JsString>::new()))?;
  tsfn.call_with_return_value(
    Ok(()),
    ThreadsafeFunctionCallMode::NonBlocking,
    |value: String| {
      println!("{}", value);
      assert_eq!(value, "ReturnFromJavaScriptRawCallback".to_owned());
      Ok(())
    },
  );
  Ok(())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn tsfn_async_call(env: Env, func: JsFunction) -> napi::Result<Object> {
  let tsfn: ThreadsafeFunction<(), String> =
    func.create_threadsafe_function(0, move |_| Ok(vec![0u32, 1u32, 2u32]))?;

  env.spawn_future(async move {
    let msg = tsfn.call_async(Ok(())).await?;
    assert_eq!(msg, "ReturnFromJavaScriptRawCallback".to_owned());
    Ok(())
  })
}

#[napi]
pub fn accept_threadsafe_function(func: ThreadsafeFunction<u32>) {
  thread::spawn(move || {
    func.call(Ok(1), ThreadsafeFunctionCallMode::NonBlocking);
  });
}

#[napi]
pub fn accept_threadsafe_function_fatal(
  func: ThreadsafeFunction<u32, Unknown, ErrorStrategy::Fatal>,
) {
  thread::spawn(move || {
    func.call(1, ThreadsafeFunctionCallMode::NonBlocking);
  });
}

#[napi]
pub fn accept_threadsafe_function_tuple_args(func: ThreadsafeFunction<(u32, bool, String)>) {
  thread::spawn(move || {
    func.call(
      Ok((1, false, "NAPI-RS".into())),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });
}

#[napi]
pub async fn tsfn_return_promise(func: ThreadsafeFunction<u32, Promise<u32>>) -> Result<u32> {
  let val = func.call_async(Ok(1)).await?.await?;
  Ok(val + 2)
}

#[napi]
pub async fn tsfn_return_promise_timeout(
  func: ThreadsafeFunction<u32, Promise<u32>>,
) -> Result<u32> {
  use tokio::time::{self, Duration};
  let promise = func.call_async(Ok(1)).await?;
  let sleep = time::sleep(Duration::from_nanos(1));
  tokio::select! {
    _ = sleep => {
      Err(Error::new(Status::GenericFailure, "Timeout".to_owned()))
    }
    value = promise => {
      Ok(value? + 2)
    }
  }
}

#[napi]
pub async fn tsfn_throw_from_js(tsfn: ThreadsafeFunction<u32, Promise<u32>>) -> napi::Result<u32> {
  tsfn.call_async(Ok(42)).await?.await
}
