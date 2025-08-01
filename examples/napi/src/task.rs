use std::thread::sleep;

use napi::{bindgen_prelude::*, ScopedTask};

pub struct DelaySum(u32, u32);

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

  fn finally(self, _env: Env) -> Result<()> {
    Ok(())
  }
}

#[napi]
pub fn without_abort_controller(a: u32, b: u32) -> AsyncTask<DelaySum> {
  AsyncTask::new(DelaySum(a, b))
}

#[napi]
pub fn with_abort_controller(a: u32, b: u32, signal: AbortSignal) -> AsyncTask<DelaySum> {
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

pub struct AsyncTaskOptionalReturn {}

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
pub fn async_task_optional_return() -> AsyncTask<AsyncTaskOptionalReturn> {
  AsyncTask::new(AsyncTaskOptionalReturn {})
}

pub struct AsyncTaskReadFile {
  path: String,
}

#[napi]
impl<'task> ScopedTask<'task> for AsyncTaskReadFile {
  type Output = Vec<u8>;
  type JsValue = BufferSlice<'task>;

  fn compute(&mut self) -> Result<Self::Output> {
    std::fs::read(&self.path).map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))
  }

  fn resolve(&mut self, env: &'task Env, output: Self::Output) -> Result<Self::JsValue> {
    BufferSlice::from_data(env, output)
  }
}

#[napi]
pub fn async_task_read_file(path: String) -> AsyncTask<AsyncTaskReadFile> {
  AsyncTask::new(AsyncTaskReadFile { path })
}

pub struct AsyncResolveArray {
  inner: usize,
}

#[napi]
impl<'task> ScopedTask<'task> for AsyncResolveArray {
  type Output = u32;
  type JsValue = Array<'task>;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(self.inner as u32)
  }

  fn resolve(&mut self, env: &'task Env, output: Self::Output) -> Result<Self::JsValue> {
    let mut array = env.create_array(output)?;
    for i in 0..output {
      array.set(i, i)?;
    }
    Ok(array)
  }
}

#[napi]
pub fn async_resolve_array(inner: u32) -> AsyncTask<AsyncResolveArray> {
  AsyncTask::new(AsyncResolveArray {
    inner: inner as usize,
  })
}

pub struct AsyncTaskFinally {
  inner: ObjectRef,
}

#[napi]
impl Task for AsyncTaskFinally {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(())
  }

  fn resolve(&mut self, env: Env, _output: Self::Output) -> Result<Self::JsValue> {
    let mut obj = self.inner.get_value(&env)?;
    obj.set("resolve", true)?;
    Ok(())
  }

  fn finally(self, env: Env) -> Result<()> {
    let mut obj = self.inner.get_value(&env)?;
    obj.set("finally", true)?;
    self.inner.unref(&env)?;
    Ok(())
  }
}

#[napi]
pub fn async_task_finally(inner: ObjectRef) -> AsyncTask<AsyncTaskFinally> {
  AsyncTask::new(AsyncTaskFinally { inner })
}
