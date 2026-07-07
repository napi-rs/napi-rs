use std::{future::Future, pin::Pin, sync::Mutex, thread::JoinHandle};

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[derive(Default)]
struct ModuleInitRuntime {
  tasks: Mutex<Vec<JoinHandle<()>>>,
}

unsafe impl AsyncRuntime for ModuleInitRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    let task = std::thread::spawn(move || futures::executor::block_on(task));
    self
      .tasks
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .push(task);
    Ok(())
  }

  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
    futures::executor::block_on(future);
  }

  fn shutdown(&self) -> Result<()> {
    let tasks = std::mem::take(
      &mut *self
        .tasks
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    for task in tasks {
      task
        .join()
        .map_err(|_| Error::from_reason("module rollback async task panicked"))?;
    }
    Ok(())
  }
}

#[napi_derive::module_init]
fn initialize_runtime() {
  register_async_runtime(ModuleInitRuntime::default());
  try_start_async_runtime().expect("module-init runtime should start before module loading");
}

#[napi]
pub fn module_init_rollback_probe() -> &'static str {
  "ready"
}

#[napi]
pub async fn module_init_rollback_async_probe(value: u32) -> u32 {
  value + 1
}

#[napi]
pub fn module_init_rollback_drop_buffers_on_native_thread(buffers: Vec<Buffer>) -> Result<()> {
  if buffers.is_empty() {
    return Err(Error::from_reason(
      "custom-GC module-init probe array must not be empty",
    ));
  }
  std::thread::spawn(move || drop(buffers))
    .join()
    .map_err(|_| Error::from_reason("custom-GC probe thread panicked"))
}

#[napi]
pub struct ModuleInitRollbackClass {
  value: u32,
}

#[napi]
impl ModuleInitRollbackClass {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self { value }
  }

  #[napi]
  pub fn incremented(&self) -> Self {
    Self {
      value: self.value + 1,
    }
  }

  #[napi]
  pub async fn incremented_async(&self) -> u32 {
    self.value + 1
  }

  #[napi(getter)]
  pub fn value(&self) -> u32 {
    self.value
  }
}
