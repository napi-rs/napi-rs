use std::thread;

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode},
  JsBoolean,
};

#[napi]
pub fn call_threadsafe_function(callback: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<u32, ErrorStrategy::CalleeHandled> = callback
    .create_threadsafe_function(0, |ctx| {
      ctx.env.create_uint32(ctx.value + 1).map(|v| vec![v])
    })?;
  for n in 0..100 {
    let tsfn = tsfn.clone();
    thread::spawn(move || {
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::Blocking);
    });
  }
  Ok(())
}

#[napi]
pub fn threadsafe_function_throw_error(cb: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<bool, ErrorStrategy::CalleeHandled> =
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
  let tsfn: ThreadsafeFunction<bool, ErrorStrategy::Fatal> =
    cb.create_threadsafe_function(0, |ctx| ctx.env.get_boolean(ctx.value).map(|v| vec![v]))?;
  thread::spawn(move || {
    tsfn.call(true, ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode_error(cb: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<bool, ErrorStrategy::Fatal> =
    cb.create_threadsafe_function(0, |_ctx| {
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
