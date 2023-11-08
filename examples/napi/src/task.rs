use std::thread::sleep;

use napi::bindgen_prelude::*;

struct DelaySum(u32, u32);

#[napi]
impl napi::Task for DelaySum {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    sleep(std::time::Duration::from_millis(100));
    Ok(self.0 + self.1)
  }

  fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
fn without_abort_controller(a: u32, b: u32) -> AsyncTask<DelaySum> {
  AsyncTask::new(DelaySum(a, b))
}

#[napi]
fn with_abort_controller(a: u32, b: u32, signal: AbortSignal) -> AsyncTask<DelaySum> {
  AsyncTask::with_signal(DelaySum(a, b), signal)
}

struct AsyncTaskVoidReturn {}

#[napi]
impl Task for AsyncTaskVoidReturn {
  type JsValue = ();
  type Output = ();

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(())
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
fn async_task_void_return() -> AsyncTask<AsyncTaskVoidReturn> {
  AsyncTask::new(AsyncTaskVoidReturn {})
}

struct AsyncTaskOptionalReturn {}

#[napi]
impl Task for AsyncTaskOptionalReturn {
  type JsValue = Option<u32>;
  type Output = ();

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(())
  }

  fn resolve(&mut self, _env: Env, _: Self::Output) -> Result<Self::JsValue> {
    Ok(None)
  }
}

#[napi]
fn async_task_optional_return() -> AsyncTask<AsyncTaskOptionalReturn> {
  AsyncTask::new(AsyncTaskOptionalReturn {})
}
