use napi::{
  bindgen_prelude::{ClassInstance, Function, FunctionRef},
  Env, JsFunction, JsObject, Result,
};

use crate::class::Animal;

#[napi]
pub fn call0(callback: JsFunction) -> Result<u32> {
  callback.call0()
}

#[napi]
pub fn call1(callback: JsFunction, arg: u32) -> Result<u32> {
  callback.call1(arg)
}

#[napi]
pub fn call2(callback: JsFunction, arg1: u32, arg2: u32) -> Result<u32> {
  callback.call2(arg1, arg2)
}

#[napi]
pub fn apply0(ctx: ClassInstance<Animal>, callback: JsFunction) -> Result<()> {
  callback.apply0(ctx)
}

#[napi]
pub fn apply1(ctx: ClassInstance<Animal>, callback: JsFunction, name: String) -> Result<()> {
  callback.apply1(ctx, name)
}

#[napi]
pub fn call_function(cb: Function<(), u32>) -> Result<u32> {
  cb.call(())
}

#[napi]
pub fn call_function_with_arg(cb: Function<(u32, u32), u32>, arg0: u32, arg1: u32) -> Result<u32> {
  cb.call((arg0, arg1))
}

#[napi]
pub fn create_reference_on_function(env: Env, cb: Function<(), ()>) -> Result<JsObject> {
  let reference = cb.create_ref()?;
  env.execute_tokio_future(
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
  callback: FunctionRef<(u32, u32), u32>,
  arg0: u32,
  arg1: u32,
) -> Result<u32> {
  callback.borrow_back(&env)?.call((arg0, arg1))
}
