#[cfg(not(target_family = "wasm"))]
use futures::prelude::*;
use napi::bindgen_prelude::*;
use napi::tokio;
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
