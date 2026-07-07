#![cfg(not(feature = "noop"))]

use std::{
  cell::{Cell, RefCell},
  fs,
  path::PathBuf,
  sync::{mpsc, Mutex},
  time::Duration,
};

use napi::bindgen_prelude::{
  tokio_runtime_retirement_waiter, try_start_async_runtime, Error, Result, Status,
};

static TOKIO_WORKER_TLS_RESULT_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

thread_local! {
  static TOKIO_WORKER_TLS_PROBE: Cell<Option<TokioWorkerTlsProbe>> = const { Cell::new(None) };
  static TOKIO_BLOCKING_TLS_PROBE: RefCell<Option<TokioBlockingTlsProbe>> =
    const { RefCell::new(None) };
}

struct TokioWorkerTlsProbe;

impl Drop for TokioWorkerTlsProbe {
  fn drop(&mut self) {
    let result_path = TOKIO_WORKER_TLS_RESULT_PATH
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .clone();
    let Some(result_path) = result_path else {
      return;
    };
    let result = tokio_runtime_retirement_waiter().wait();
    let output = match result {
      Ok(()) => "Ok".to_owned(),
      Err(error) => format!("{:?}\n{}", error.status, error.reason),
    };
    let _ = fs::write(result_path, output);
  }
}

struct TokioBlockingTlsProbe(PathBuf);

impl Drop for TokioBlockingTlsProbe {
  fn drop(&mut self) {
    let result = tokio_runtime_retirement_waiter().wait();
    let output = match result {
      Ok(()) => "Ok".to_owned(),
      Err(error) => format!("{:?}\n{}", error.status, error.reason),
    };
    let _ = fs::write(&self.0, output);
  }
}

pub(crate) fn register_worker_tls_retirement_probe() {
  TOKIO_WORKER_TLS_PROBE.with(|probe| probe.set(Some(TokioWorkerTlsProbe)));
}

#[napi]
pub fn arm_tokio_worker_tls_retirement_probe(result_path: String) {
  *TOKIO_WORKER_TLS_RESULT_PATH
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(result_path.into());
}

#[napi]
pub async fn arm_tokio_blocking_tls_retirement_probe(
  result_path: String,
  release_path: String,
) -> Result<()> {
  let (started_tx, started_rx) = mpsc::sync_channel(1);
  drop(napi::tokio::task::spawn_blocking(move || {
    TOKIO_BLOCKING_TLS_PROBE.with(|probe| {
      *probe.borrow_mut() = Some(TokioBlockingTlsProbe(result_path.into()));
    });
    let _ = started_tx.send(());
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while !std::path::Path::new(&release_path).exists() && std::time::Instant::now() < deadline {
      std::thread::sleep(Duration::from_millis(1));
    }
  }));
  started_rx
    .recv_timeout(Duration::from_secs(5))
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("Failed to start direct Tokio blocking-thread TLS probe: {error}"),
      )
    })?;
  Ok(())
}

#[napi]
pub fn wait_for_tokio_runtime_retirement() -> Result<()> {
  tokio_runtime_retirement_waiter().wait()
}

#[napi]
pub fn restart_tokio_runtime_after_retirement() -> Result<()> {
  try_start_async_runtime()
}

#[napi]
pub async fn tokio_runtime_lifecycle_value(value: u32) -> u32 {
  value
}
