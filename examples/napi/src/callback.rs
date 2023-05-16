use std::{env, format};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode},
  JsUnknown,
};

#[napi]
fn get_cwd<T: Fn(String) -> Result<()>>(callback: T) {
  callback(env::current_dir().unwrap().to_string_lossy().to_string()).unwrap();
}

#[napi]
fn option_end<T: Fn(String, Option<String>) -> Result<()>>(callback: T) {
  callback("Hello".to_string(), None).unwrap();
}

#[napi]
fn option_start<T: Fn(Option<String>, String) -> Result<()>>(callback: T) {
  callback(None, "World".to_string()).unwrap();
}

#[napi]
fn option_start_end<T: Fn(Option<String>, String, Option<String>) -> Result<()>>(callback: T) {
  callback(None, "World".to_string(), None).unwrap();
}

#[napi]
fn option_only<T: Fn(Option<String>) -> Result<()>>(callback: T) {
  callback(None).unwrap();
}

/// napi = { version = 2, features = ["serde-json"] }
#[napi]
fn read_file<T: Fn(Result<()>, Option<String>) -> Result<()>>(callback: T) {
  match read_file_content() {
    Ok(s) => callback(Ok(()), Some(s)),
    Err(e) => callback(Err(e), None),
  }
  .unwrap();
}

fn read_file_content() -> Result<String> {
  // serde_json::from_str(&s)?;
  Ok("hello world".to_string())
}

#[napi]
fn return_js_function(env: Env) -> Result<JsFunction> {
  get_js_function(&env, read_file_js_function)
}

#[napi(
  ts_generic_types = "T",
  ts_args_type = "functionInput: () => T | Promise<T>, callback: (err: Error | null, result: T) => void",
  ts_return_type = "T | Promise<T>"
)]
fn callback_return_promise<T: Fn() -> Result<JsUnknown>>(
  env: Env,
  fn_in: T,
  fn_out: JsFunction,
) -> Result<JsUnknown> {
  let ret = fn_in()?;
  if ret.is_promise()? {
    let p = Promise::<String>::from_unknown(ret)?;
    let fn_out_tsfn: ThreadsafeFunction<String> = fn_out
      .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| Ok(vec![ctx.value]))?;
    env
      .execute_tokio_future(
        async move {
          let s = p.await;
          fn_out_tsfn.call(s, ThreadsafeFunctionCallMode::NonBlocking);
          Ok::<(), Error>(())
        },
        |env, _| env.get_undefined(),
      )
      .map(|v| v.into_unknown())
  } else {
    Ok(ret)
  }
}

#[napi(ts_return_type = "Promise<string>")]
pub fn callback_return_promise_and_spawn<F: Fn(String) -> Result<Promise<String>>>(
  env: Env,
  js_func: F,
) -> napi::Result<Object> {
  let promise = js_func("Hello".to_owned())?;
  env.spawn_future(async move {
    let resolved = promise.await?;
    Ok::<String, napi::Error>(format!("{} 😼", resolved))
  })
}

#[napi]
pub fn capture_error_in_callback<C: Fn() -> Result<()>, E: Fn(Error) -> Result<()>>(
  cb1: C,
  cb2: E,
) -> Result<()> {
  if let Err(e) = cb1() {
    cb2(e)
  } else {
    Ok(())
  }
}
