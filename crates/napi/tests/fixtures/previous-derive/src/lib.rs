#![deny(unused_must_use)]

use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, LazyLock, Mutex,
  },
};

use napi::bindgen_prelude::{
  try_register_async_runtime, AsyncGenerator, AsyncRuntime, AsyncRuntimeGuard, AsyncRuntimeTask,
  External, Generator,
};
use napi_derive::napi;

static ENTER_COUNT: AtomicUsize = AtomicUsize::new(0);
static SPAWN_COUNT: AtomicUsize = AtomicUsize::new(0);
static TASK_THREADS: LazyLock<Mutex<Vec<std::thread::JoinHandle<()>>>> =
  LazyLock::new(|| Mutex::new(Vec::new()));

struct PreviousDeriveRuntime;

struct PreviousDeriveRuntimeGuard;

impl AsyncRuntimeGuard for PreviousDeriveRuntimeGuard {}

unsafe impl AsyncRuntime for PreviousDeriveRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> Result<(), AsyncRuntimeTask> {
    let task = Arc::new(Mutex::new(Some(task)));
    let worker_task = Arc::clone(&task);
    match std::thread::Builder::new()
      .name("previous-derive-runtime".to_owned())
      .spawn(move || {
        let task = worker_task
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .take();
        if let Some(task) = task {
          futures::executor::block_on(task);
        }
      }) {
      Ok(thread) => {
        SPAWN_COUNT.fetch_add(1, Ordering::SeqCst);
        TASK_THREADS
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .push(thread);
        Ok(())
      }
      Err(_) => Err(
        task
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner)
          .take()
          .expect("a failed thread spawn must leave the task available"),
      ),
    }
  }

  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
    futures::executor::block_on(future);
  }

  fn enter(&self) -> Box<dyn AsyncRuntimeGuard + '_> {
    ENTER_COUNT.fetch_add(1, Ordering::SeqCst);
    Box::new(PreviousDeriveRuntimeGuard)
  }

  fn start(&self) -> napi::Result<()> {
    Ok(())
  }

  fn shutdown(&self) -> napi::Result<()> {
    let threads = std::mem::take(
      &mut *TASK_THREADS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    for thread in threads {
      let _ = thread.join();
    }
    Ok(())
  }

  fn spawn_blocking(
    &self,
    work: Box<dyn FnOnce() + Send + 'static>,
  ) -> Result<(), Box<dyn FnOnce() + Send + 'static>> {
    Err(work)
  }
}

#[napi_derive::module_init]
fn register_previous_derive_runtime() {
  let _ = try_register_async_runtime(PreviousDeriveRuntime);
}

#[napi]
pub struct PreviousGeneratedClass {
  value: u32,
}

#[napi]
impl PreviousGeneratedClass {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self { value }
  }

  #[napi(factory)]
  pub fn create(value: u32) -> Self {
    Self { value }
  }

  #[napi(getter)]
  pub fn value(&self) -> u32 {
    self.value
  }
}

#[napi]
pub fn previous_generated_class(value: u32) -> PreviousGeneratedClass {
  PreviousGeneratedClass { value }
}

#[napi]
pub fn previous_generated_class_value(value: &PreviousGeneratedClass) -> u32 {
  value.value
}

#[napi]
pub fn previous_generated_external(value: u32) -> External<u32> {
  External::new(value)
}

#[napi]
pub fn previous_generated_external_value(value: &External<u32>) -> u32 {
  **value
}

#[napi(async_runtime)]
pub fn previous_generated_runtime_entry() -> napi::Result<u32> {
  Ok(42)
}

#[napi(async_runtime)]
pub fn previous_generated_runtime_has_tokio_handle() -> bool {
  tokio::runtime::Handle::try_current().is_ok()
}

#[napi]
pub fn previous_runtime_enter_count() -> u32 {
  ENTER_COUNT.load(Ordering::SeqCst) as u32
}

#[napi]
pub fn previous_runtime_spawn_count() -> u32 {
  SPAWN_COUNT.load(Ordering::SeqCst) as u32
}

#[napi]
pub async fn previous_generated_async_export(value: u32) -> u32 {
  value
}

#[napi]
pub async fn previous_generated_async_class(value: u32) -> PreviousGeneratedClass {
  PreviousGeneratedClass { value }
}

#[napi(iterator)]
pub struct PreviousGeneratedIterator {
  current: u32,
  end: u32,
}

#[napi]
impl Generator for PreviousGeneratedIterator {
  type Yield = u32;
  type Next = ();
  type Return = ();

  fn next(&mut self, _value: Option<Self::Next>) -> Option<Self::Yield> {
    if self.current >= self.end {
      return None;
    }
    let value = self.current;
    self.current += 1;
    Some(value)
  }
}

#[napi]
impl PreviousGeneratedIterator {
  #[napi(constructor)]
  pub fn new(current: u32, end: u32) -> Self {
    Self { current, end }
  }

  #[napi(factory)]
  pub fn create(current: u32, end: u32) -> Self {
    Self { current, end }
  }
}

#[napi]
pub fn previous_generated_iterator(current: u32, end: u32) -> PreviousGeneratedIterator {
  PreviousGeneratedIterator { current, end }
}

#[napi(async_iterator)]
pub struct PreviousGeneratedAsyncIterator {
  current: u32,
  end: u32,
}

#[napi]
impl AsyncGenerator for PreviousGeneratedAsyncIterator {
  type Yield = u32;
  type Next = ();
  type Return = ();

  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = napi::Result<Option<Self::Yield>>> + Send + 'static {
    let value = if self.current < self.end {
      let value = self.current;
      self.current += 1;
      Some(value)
    } else {
      None
    };
    async move { Ok(value) }
  }
}

#[napi]
impl PreviousGeneratedAsyncIterator {
  #[napi(constructor)]
  pub fn new(current: u32, end: u32) -> Self {
    Self { current, end }
  }

  #[napi(factory)]
  pub fn create(current: u32, end: u32) -> Self {
    Self { current, end }
  }
}

#[napi]
pub fn previous_generated_async_iterator(current: u32, end: u32) -> PreviousGeneratedAsyncIterator {
  PreviousGeneratedAsyncIterator { current, end }
}
