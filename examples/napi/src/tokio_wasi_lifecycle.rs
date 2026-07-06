use std::{fs, future::poll_fn, task::Poll, time::Duration};

use futures::channel::oneshot;
use napi::{
  bindgen_prelude::{spawn as spawn_on_tokio_runtime, JsObjectValue, Object},
  Error, Result, Status,
};

#[napi(no_export)]
pub async fn start_tokio_waker_after_cleanup_probe(
  entered_path: String,
  release_path: String,
  completed_path: String,
) -> Result<()> {
  let (started_tx, started_rx) = oneshot::channel();
  drop(spawn_on_tokio_runtime(async move {
    let mut setup = Some((entered_path, release_path, completed_path, started_tx));
    poll_fn(move |context| {
      if let Some((entered_path, release_path, completed_path, started_tx)) = setup.take() {
        let waker = context.waker().clone();
        std::thread::spawn(move || {
          let entered = fs::write(&entered_path, b"entered");
          let _ = started_tx
            .send(entered.map_err(|error| format!("failed to create entered marker: {error}")));
          let deadline = std::time::Instant::now() + Duration::from_secs(20);
          while !std::path::Path::new(&release_path).exists()
            && std::time::Instant::now() < deadline
          {
            std::thread::sleep(Duration::from_millis(1));
          }
          if !std::path::Path::new(&release_path).exists() {
            return;
          }
          waker.wake_by_ref();
          drop(waker);
          let _ = fs::write(completed_path, b"completed");
        });
      }
      Poll::<()>::Pending
    })
    .await;
  }));

  started_rx
    .await
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("Tokio waker probe did not start: {error}"),
      )
    })?
    .map_err(|reason| Error::new(Status::GenericFailure, reason))
}

pub(crate) fn install_lifecycle_fixture(fixture: &mut Object) -> Result<()> {
  fixture.create_named_method(
    "startTokioWakerAfterCleanupProbe",
    start_tokio_waker_after_cleanup_probe_c_callback,
  )
}
