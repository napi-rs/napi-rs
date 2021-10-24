use futures::prelude::*;
use napi::bindgen_prelude::*;
use tokio::fs;

#[napi]
async fn read_file_async(path: String) -> Result<Vec<u8>> {
  fs::read(path)
    .map(|v| {
      v.map_err(|e| {
        Error::new(
          Status::GenericFailure,
          format!("failed to read file, {}", e),
        )
      })
    })
    .await
}
