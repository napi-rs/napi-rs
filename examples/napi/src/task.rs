use std::thread::sleep;

use napi::bindgen_prelude::*;
use napi::Task;

struct DelaySum(u32, u32);

#[napi]
impl Task for DelaySum {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    sleep(std::time::Duration::from_secs(1));
    Ok(self.0 + self.1)
  }

  fn resolve(self, _env: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
fn without_abort_controller(a: u32, b: u32) -> AsyncTask<DelaySum> {
  AsyncTask::new(DelaySum(a, b))
}

#[napi]
fn with_abort_controller(a: u32, b: u32, ctrl: AsyncTaskAbortController) -> AsyncTask<DelaySum> {
  AsyncTask::with_abort_controller(DelaySum(a, b), ctrl)
}
