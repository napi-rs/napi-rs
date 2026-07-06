#[cfg(not(target_family = "wasm"))]
use futures::prelude::*;
use napi::bindgen_prelude::*;
#[cfg(not(target_family = "wasm"))]
use napi::tokio::fs;

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
#[napi(no_export)]
fn shutdown_async_runtime_for_test() -> Result<()> {
  try_shutdown_async_runtime()
}

#[napi(no_export)]
fn pending_async_block_with_terminal_finalizer(
  env: &Env,
  result_path: String,
) -> Result<AsyncBlock<()>> {
  AsyncBlockBuilder::new(async {
    std::future::pending::<()>().await;
    Ok(())
  })
  .with_terminal_finalizer(move || {
    let _ = std::fs::write(result_path, b"finalized");
  })
  .build(env)
}

#[cfg(not(feature = "noop"))]
pub(crate) fn install_lifecycle_fixture(fixture: &mut Object) -> Result<()> {
  fixture.create_named_method(
    "shutdownAsyncRuntimeForTest",
    shutdown_async_runtime_for_test_c_callback,
  )?;
  fixture.create_named_method(
    "pendingAsyncBlockWithTerminalFinalizer",
    pending_async_block_with_terminal_finalizer_c_callback,
  )
}

#[cfg(feature = "noop")]
pub(crate) fn install_lifecycle_fixture(_fixture: &mut Object) -> Result<()> {
  Ok(())
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
