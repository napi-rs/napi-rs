use std::sync::atomic::{AtomicU32, Ordering};

#[cfg(not(target_family = "wasm"))]
use futures::prelude::*;
use napi::bindgen_prelude::*;
#[cfg(not(target_family = "wasm"))]
use napi::tokio::fs;

static ASYNC_BLOCK_TERMINAL_FINALIZER_COUNT: AtomicU32 = AtomicU32::new(0);

#[napi]
async fn read_file_async(path: String) -> Result<Buffer> {
  #[cfg(not(target_family = "wasm"))]
  {
    fs::read(path)
      .map(|r| match r {
        Ok(content) => Ok(content.into()),
        Err(e) => Err(Error::new(
          Status::GenericFailure,
          format!("failed to read file, {}", e),
        )),
      })
      .await
  }
  #[cfg(target_family = "wasm")]
  {
    let conetent = std::fs::read(path)?;
    Ok(conetent.into())
  }
}

#[napi]
async fn async_multi_two(arg: u32) -> Result<u32> {
  tokio::task::spawn(async move { Ok(arg * 2) })
    .await
    .unwrap()
}

#[napi]
async fn panic_in_async() {
  panic!("panic in async function");
}

#[cfg(not(feature = "noop"))]
#[napi]
fn shutdown_async_runtime_for_test() -> Result<()> {
  try_shutdown_async_runtime()
}

#[napi]
fn pending_async_block_with_terminal_finalizer(env: &Env) -> Result<AsyncBlock<()>> {
  AsyncBlockBuilder::new(async {
    std::future::pending::<()>().await;
    Ok(())
  })
  .with_terminal_finalizer(|| {
    ASYNC_BLOCK_TERMINAL_FINALIZER_COUNT.fetch_add(1, Ordering::SeqCst);
  })
  .build(env)
}

#[napi]
fn async_block_terminal_finalizer_count() -> u32 {
  ASYNC_BLOCK_TERMINAL_FINALIZER_COUNT.load(Ordering::SeqCst)
}

#[napi(async_runtime)]
pub fn within_async_runtime_if_available() {
  tokio::spawn(async {
    println!("within_runtime_if_available");
  });
}

#[napi(constructor)]
pub struct AsyncThrowClass {}

#[napi]
impl AsyncThrowClass {
  #[napi]
  pub async fn async_throw_error(&self) -> Result<()> {
    Err(Error::new(Status::GenericFailure, "Throw async error"))
  }
}
