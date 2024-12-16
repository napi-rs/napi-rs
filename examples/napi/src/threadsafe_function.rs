use std::{sync::Arc, thread, time::Duration};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};

#[napi]
pub fn call_threadsafe_function(
  tsfn: Arc<ThreadsafeFunction<u32, UnknownReturnValue>>,
) -> Result<()> {
  for n in 0..100 {
    let tsfn = tsfn.clone();
    thread::spawn(move || {
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    });
  }
  Ok(())
}

#[napi]
pub fn call_long_threadsafe_function(
  tsfn: ThreadsafeFunction<u32, UnknownReturnValue>,
) -> Result<()> {
  thread::spawn(move || {
    for n in 0..10 {
      thread::sleep(Duration::from_millis(100));
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    }
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_throw_error(
  cb: ThreadsafeFunction<bool, UnknownReturnValue>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(
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
pub fn threadsafe_function_fatal_mode(
  cb: ThreadsafeFunction<bool, UnknownReturnValue, bool, false>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(true, ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode_error(
  cb: ThreadsafeFunction<bool, String, bool, false>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call_with_return_value(true, ThreadsafeFunctionCallMode::Blocking, |ret, _| {
      ret.map(|_| ())
    });
  });
  Ok(())
}

#[napi]
fn threadsafe_function_closure_capture(func: Function<String, ()>) -> napi::Result<()> {
  let str = "test";
  let tsfn = func
    .build_threadsafe_function::<()>()
    .build_callback(move |_| {
      println!("Captured in ThreadsafeFunction {}", str); // str is NULL at this point
      Ok(String::new())
    })?;

  tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);

  Ok(())
}

#[napi]
pub fn tsfn_call_with_callback(tsfn: ThreadsafeFunction<(), String>) -> napi::Result<()> {
  tsfn.call_with_return_value(
    Ok(()),
    ThreadsafeFunctionCallMode::NonBlocking,
    |value: Result<String>, _| {
      let value = value.expect("Failed to retrieve value from JS");
      println!("{}", value);
      assert_eq!(value, "ReturnFromJavaScriptRawCallback".to_owned());
      Ok(())
    },
  );
  Ok(())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn tsfn_async_call(
  env: Env,
  func: Function<FnArgs<(u32, u32, u32)>, String>,
) -> napi::Result<PromiseRaw<()>> {
  let tsfn = func.build_threadsafe_function().build()?;

  env.spawn_future(async move {
    let msg = tsfn.call_async((0, 1, 2).into()).await?;
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
pub fn accept_threadsafe_function_fatal(func: ThreadsafeFunction<u32, (), u32, false>) {
  thread::spawn(move || {
    func.call(1, ThreadsafeFunctionCallMode::NonBlocking);
  });
}

#[napi]
pub fn accept_threadsafe_function_tuple_args(
  func: ThreadsafeFunction<FnArgs<(u32, bool, String)>>,
) {
  thread::spawn(move || {
    func.call(
      Ok((1, false, "NAPI-RS".into()).into()),
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

#[napi]
pub fn spawn_thread_in_thread(tsfn: ThreadsafeFunction<u32, u32>) {
  std::thread::spawn(move || {
    std::thread::spawn(move || {
      tsfn.call(Ok(42), ThreadsafeFunctionCallMode::NonBlocking);
    });
  });
}

#[napi(object, object_to_js = false)]
pub struct Pet {
  pub name: String,
  pub kind: u32,
  pub either_tsfn: Either<String, ThreadsafeFunction<i32, i32>>,
}

#[napi]
pub fn tsfn_in_either(pet: Pet) {
  if let Either::B(tsfn) = pet.either_tsfn {
    thread::spawn(move || {
      tsfn.call(Ok(42), ThreadsafeFunctionCallMode::NonBlocking);
    });
  }
}
