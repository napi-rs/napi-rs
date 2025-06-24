use std::{env, format};

use napi::{bindgen_prelude::*, threadsafe_function::ThreadsafeFunctionCallMode, JsValue, Unknown};

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

#[napi(
  ts_generic_types = "T",
  ts_args_type = "functionInput: () => T | Promise<T>, callback: (err: Error | null, result: T) => void",
  ts_return_type = "T | Promise<T>"
)]
fn callback_return_promise<'env>(
  env: &'env Env,
  fn_in: Function<(), Unknown<'env>>,
  fn_out: Function<String, ()>,
) -> Result<Unknown<'env>> {
  let ret = fn_in.call(())?;
  if ret.is_promise()? {
    let p = Promise::<String>::from_unknown(ret)?;
    let fn_out_tsfn = fn_out
      .build_threadsafe_function()
      .callee_handled::<true>()
      .build()?;
    env
      .spawn_future(async move {
        let s = p.await;
        fn_out_tsfn.call(s, ThreadsafeFunctionCallMode::NonBlocking);
        Ok::<(), Error>(())
      })
      .map(|v| v.to_unknown())
  } else {
    Ok(ret)
  }
}

#[napi(ts_return_type = "Promise<string>")]
pub fn callback_return_promise_and_spawn<F: Fn(String) -> Result<Promise<String>>>(
  env: &Env,
  js_func: F,
) -> napi::Result<PromiseRaw<'_, String>> {
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
