#[macro_use]
extern crate napi_rs as napi;
#[macro_use]
extern crate napi_rs_derive;

use napi::{
  Any, Boolean, CallContext, Env, Error, JsString, Number, Object, Result, Status, Task, Value,
  Undefined, Function, Buffer,
  threadsafe_function::{
    ToJs,
    ThreadsafeFunction,
  }
};
use napi::sys::{
  napi_threadsafe_function_call_mode:: {
    napi_tsfn_blocking,
  },
  napi_threadsafe_function_release_mode:: {
    napi_tsfn_release,
  }
};
use std::convert::TryInto;
use std::thread;
use std::path::Path;
use std::ops::Deref;
use tokio;

register_module!(test_module, init);

fn init(env: &Env, exports: &mut Value<Object>) -> Result<()> {
  exports.set_named_property("testThrow", env.create_function("testThrow", test_throw)?)?;
  exports.set_named_property(
    "testThrowWithReason",
    env.create_function("testThrowWithReason", test_throw_with_reason)?,
  )?;
  exports.set_named_property(
    "testSpawnThread",
    env.create_function("testSpawnThread", test_spawn_thread)?,
  )?;
  exports.set_named_property(
    "testObjectIsDate",
    env.create_function("testObjectIsDate", test_object_is_date)?,
  )?;
  exports.set_named_property(
    "createExternal",
    env.create_function("createExternal", create_external)?,
  )?;
  exports.set_named_property(
    "getExternalCount",
    env.create_function("getExternalCount", get_external_count)?,
  )?;
  exports.set_named_property(
    "testTsfnError",
    env.create_function("testTsfnError", test_tsfn_error)?,
  )?;
  exports.set_named_property(
    "testThreadsafeFunction",
    env.create_function("testThreadsafeFunction", test_threadsafe_function)?
  )?;
  exports.set_named_property(
    "testTokioReadfile",
    env.create_function("testTokioReadfile", test_tokio_readfile)?
  )?;
  Ok(())
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

#[js_function(1)]
fn test_throw_with_reason(ctx: CallContext) -> Result<Value<Any>> {
  let reason = ctx.get::<JsString>(0)?;
  Err(Error {
    status: Status::GenericFailure,
    reason: Some(reason.as_str()?.to_owned()),
  })
}

#[js_function(1)]
fn test_object_is_date(ctx: CallContext) -> Result<Value<Boolean>> {
  let obj: Value<Object> = ctx.get::<Object>(0)?;
  Ok(Env::get_boolean(ctx.env, obj.is_date()?)?)
}

struct NativeObject {
  count: i32,
}

#[js_function(1)]
fn create_external(ctx: CallContext) -> Result<Value<Object>> {
  let count = ctx.get::<Number>(0)?.try_into()?;
  let native = NativeObject { count };
  ctx.env.create_external(native)
}

#[js_function(1)]
fn get_external_count(ctx: CallContext) -> Result<Value<Number>> {
  let attached_obj = ctx.get::<Object>(0)?;
  let native_object = ctx.env.get_value_external::<NativeObject>(&attached_obj)?;
  ctx.env.create_int32(native_object.count)
}

#[derive(Clone, Copy)]
struct HandleNumber;

impl ToJs for HandleNumber {
  type Output = u8;
  type JsValue = Number;

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<(u64, Value<Self::JsValue>)> {
    let argv: u64 = 1;

    let value = env.create_uint32(output as u32)?;

    Ok((argv, value))
  }
}

#[js_function(1)]
fn test_threadsafe_function(ctx: CallContext) -> Result<Value<Undefined>> {
  let func: Value<Function> = ctx.get::<Function>(0)?;

  let to_js = HandleNumber;
  let tsfn = ThreadsafeFunction::create(ctx.env, func, to_js, 0)?;

  thread::spawn(move || {
    let output: u8 = 42;
    // It's okay to call a threadsafe function multiple times.
    tsfn.call(Ok(output), napi_tsfn_blocking).unwrap();
    tsfn.call(Ok(output), napi_tsfn_blocking).unwrap();
    tsfn.release(napi_tsfn_release).unwrap();
  });

  Ok(Env::get_undefined(ctx.env)?)
}

#[js_function(1)]
fn test_tsfn_error(ctx: CallContext) -> Result<Value<Undefined>> {
  let func = ctx.get::<Function>(0)?;
  let to_js = HandleNumber;
  let tsfn = ThreadsafeFunction::create(ctx.env, func, to_js, 0)?;

  thread::spawn(move || {
    tsfn.call(Err(Error {
      status: napi::sys::Status::Unknown,
      reason: Some(String::from("invalid")),
    }), napi_tsfn_blocking).unwrap();
    tsfn.release(napi_tsfn_release).unwrap();
  });

  Ok(Env::get_undefined(ctx.env)?)
}

#[derive(Copy, Clone)]
struct HandleBuffer;

impl ToJs for HandleBuffer {
  type Output = Vec<u8>;
  type JsValue = Buffer;

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<(u64, Value<Self::JsValue>)> {
    let value = env.create_buffer_with_data(output.to_vec())?;
    Ok((1u64, value))
  }
}

async fn read_file_content(filepath: &Path) -> Result<Vec<u8>> {
  tokio::fs::read(filepath).await.map_err(|_| Error {
    status: Status::Unknown,
    reason: Some(String::from("failed to read file")),
  })
}

#[js_function(2)]
fn test_tokio_readfile(ctx: CallContext) -> Result<Value<Undefined>> {
  let js_filepath: Value<JsString> = ctx.get::<JsString>(0)?;
  let js_func: Value<Function> = ctx.get::<Function>(1)?;
  let path_str = String::from(js_filepath.as_str()?);

  let to_js = HandleBuffer;
  let tsfn = ThreadsafeFunction::create(ctx.env, js_func, to_js, 0)?;
  let mut rt = tokio::runtime::Runtime::new().unwrap();

  rt.block_on(async move {
    let mut filepath = Path::new(path_str.deref());
    let ret = read_file_content(&mut filepath).await;
    let _ = tsfn.call(ret, napi_tsfn_blocking);
    tsfn.release(napi_tsfn_release).unwrap();
  });

  Ok(Env::get_undefined(ctx.env)?)
}
