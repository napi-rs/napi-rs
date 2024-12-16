#![allow(deprecated)]

use napi::{
  bindgen_prelude::{ClassInstance, FnArgs, Function, FunctionRef, PromiseRaw},
  threadsafe_function::ThreadsafeFunctionCallMode,
  Env, Error, Result, Status,
};

use crate::class::Animal;

#[napi]
pub fn call0(callback: Function<(), u32>) -> Result<u32> {
  callback.call(())
}

#[napi]
pub fn call1(callback: Function<u32, u32>, arg: u32) -> Result<u32> {
  callback.call(arg)
}

#[napi]
pub fn call2(callback: Function<FnArgs<(u32, u32)>, u32>, arg1: u32, arg2: u32) -> Result<u32> {
  callback.call((arg1, arg2).into())
}

#[napi]
pub fn apply0(ctx: ClassInstance<Animal>, callback: Function<(), ()>) -> Result<()> {
  callback.apply(ctx, ())
}

#[napi]
pub fn apply1(
  ctx: ClassInstance<Animal>,
  callback: Function<String, ()>,
  name: String,
) -> Result<()> {
  callback.apply(ctx, name)
}

#[napi]
pub fn call_function(cb: Function<(), u32>) -> Result<u32> {
  cb.call(())
}

#[napi]
pub fn call_function_with_arg(
  cb: Function<FnArgs<(u32, u32)>, u32>,
  arg0: u32,
  arg1: u32,
) -> Result<u32> {
  cb.call((arg0, arg1).into())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn create_reference_on_function(env: Env, cb: Function<(), ()>) -> Result<PromiseRaw<()>> {
  let reference = cb.create_ref()?;
  env.spawn_future_with_callback(
    async {
      tokio::time::sleep(std::time::Duration::from_millis(100)).await;
      Ok(())
    },
    move |env, _| {
      let cb = reference.borrow_back(env)?;
      cb.call(())?;
      Ok(())
    },
  )
}

#[napi]
pub fn call_function_with_arg_and_ctx(
  ctx: ClassInstance<Animal>,
  cb: Function<String, ()>,
  name: String,
) -> Result<()> {
  cb.apply(ctx, name)
}

#[napi]
pub fn reference_as_callback(
  env: Env,
  callback: FunctionRef<FnArgs<(u32, u32)>, u32>,
  arg0: u32,
  arg1: u32,
) -> Result<u32> {
  callback.borrow_back(&env)?.call((arg0, arg1).into())
}

#[napi]
pub fn build_threadsafe_function_from_function(
  callback: Function<FnArgs<(u32, u32)>, u32>,
) -> Result<()> {
  let tsfn = callback.build_threadsafe_function().build()?;
  std::thread::spawn(move || {
    tsfn.call((1, 2).into(), ThreadsafeFunctionCallMode::NonBlocking);
  });
  let tsfn_max_queue_size_1 = callback
    .build_threadsafe_function()
    .max_queue_size::<1>()
    .build()?;

  std::thread::spawn(move || {
    tsfn_max_queue_size_1.call((1, 2).into(), ThreadsafeFunctionCallMode::NonBlocking);
  });

  let tsfn_weak = callback
    .build_threadsafe_function()
    .weak::<true>()
    .build()?;

  std::thread::spawn(move || {
    tsfn_weak.call((1, 2).into(), ThreadsafeFunctionCallMode::NonBlocking);
  });

  Ok(())
}

#[napi]
pub fn build_threadsafe_function_from_function_callee_handle(
  callback: Function<(), ()>,
) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function()
    .callee_handled::<true>()
    .build()?;

  std::thread::spawn(move || {
    tsfn.call(
      Err(Error::new(Status::GenericFailure, "run tsfn failed")),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });

  Ok(())
}
