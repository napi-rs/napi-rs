use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
  },
  thread::JoinHandle,
};

use napi::bindgen_prelude::*;
use napi_derive::napi;

static RUNTIME_START_CALLS: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_SHUTDOWN_CALLS: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_SHUTDOWN_TOKIO_ENTRIES: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_SHUTDOWN_TOKIO_ENTRY_FAILURES: AtomicUsize = AtomicUsize::new(0);

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

  fn start(&self) -> Result<()> {
    RUNTIME_START_CALLS.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }

  fn shutdown(&self) -> Result<()> {
    RUNTIME_SHUTDOWN_CALLS.fetch_add(1, Ordering::SeqCst);
    match try_within_runtime_if_available(|| ()) {
      Ok(()) => {
        RUNTIME_SHUTDOWN_TOKIO_ENTRIES.fetch_add(1, Ordering::SeqCst);
      }
      Err(error) => {
        RUNTIME_SHUTDOWN_TOKIO_ENTRY_FAILURES.fetch_add(1, Ordering::SeqCst);
        return Err(error);
      }
    }
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
pub fn module_init_rollback_runtime_lifecycle() -> Vec<u32> {
  [
    RUNTIME_START_CALLS.load(Ordering::SeqCst),
    RUNTIME_SHUTDOWN_CALLS.load(Ordering::SeqCst),
    RUNTIME_SHUTDOWN_TOKIO_ENTRIES.load(Ordering::SeqCst),
    RUNTIME_SHUTDOWN_TOKIO_ENTRY_FAILURES.load(Ordering::SeqCst),
  ]
  .into_iter()
  .map(|count| u32::try_from(count).expect("runtime lifecycle counter overflow"))
  .collect()
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
