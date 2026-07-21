//! End-to-end consumer of `napi-async-runtime`: the host resolves its
//! configuration first, then installs the shared scheduler as this addon's
//! `AsyncRuntime` backend from its own `module_init` hook.

use std::time::{Duration, Instant};

use napi_derive::napi;

#[napi_derive::module_init]
fn init() {
  // Resolve host configuration BEFORE installing: the scheduler never reads
  // the environment itself. This example keeps the per-target defaults.
  napi_async_runtime::install(napi_async_runtime::RuntimeOptions::default())
    .expect("failed to install the shared async runtime");
}

#[napi]
pub async fn plus_100(input: u32) -> u32 {
  input + 100
}

#[napi]
pub async fn sleep_then_add(a: u32, b: u32, sleep_ms: u32) -> u32 {
  napi_async_runtime::sleep_until(Instant::now() + Duration::from_millis(u64::from(sleep_ms)))
    .await;
  a + b
}

/// Race two shared-runtime sleeps and report the winner (`0` = short,
/// `1` = long). The losing sleep future is dropped before its deadline,
/// which drives the timer relay's cancel path end-to-end: the native side
/// must call the JS timer host's `cancel` callback for the abandoned relay.
#[napi]
pub async fn race_sleeps(short_ms: u32, long_ms: u32) -> u32 {
  let now = Instant::now();
  let short = std::pin::pin!(napi_async_runtime::sleep_until(
    now + Duration::from_millis(u64::from(short_ms))
  ));
  let long = std::pin::pin!(napi_async_runtime::sleep_until(
    now + Duration::from_millis(u64::from(long_ms))
  ));
  match futures::future::select(short, long).await {
    futures::future::Either::Left(((), _abandoned_long)) => 0,
    futures::future::Either::Right(((), _abandoned_short)) => 1,
  }
}

#[napi]
pub async fn blocking_sum(input: Vec<u32>) -> napi::Result<u32> {
  napi_async_runtime::spawn_blocking(move || input.iter().copied().map(u64::from).sum::<u64>())
    .await
    .map_err(|error| napi::Error::from_reason(error.to_string()))
    .and_then(|sum| {
      u32::try_from(sum).map_err(|_| napi::Error::from_reason("the blocking sum overflowed a u32"))
    })
}

// The native smoke test drives the exact scheduler this addon installs: the
// runtime accepts async and blocking work, the sleep facility fires, and
// shutdown quiesces cleanly. It runs as a plain cargo test (no Node); the
// `install` half of `module_init` is exercised by registering the backend the
// same way and then exercising the scheduler API napi would submit into.
#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
  use std::time::{Duration, Instant};

  #[test]
  fn installed_runtime_runs_async_sleep_and_blocking_work() {
    napi_async_runtime::install(napi_async_runtime::RuntimeOptions::default())
      .expect("the shared async runtime must install");
    napi_async_runtime::start().expect("the shared async runtime must start");

    // Async work through the scheduler napi submits into.
    let spawned = napi_async_runtime::block_on(async {
      napi_async_runtime::spawn(async { 41 + 1 })
        .await
        .expect("the spawned task must complete")
    });
    assert_eq!(spawned, 42);

    // The sleep-backed export path: the timer must actually elapse.
    let started = Instant::now();
    let slept = napi_async_runtime::block_on(async {
      napi_async_runtime::sleep_until(Instant::now() + Duration::from_millis(50)).await;
      7
    });
    assert_eq!(slept, 7);
    assert!(
      started.elapsed() >= Duration::from_millis(50),
      "the sleep must not resolve early"
    );

    // The blocking lane used by `blocking_sum`.
    let sum = napi_async_runtime::block_on(async {
      napi_async_runtime::spawn_blocking(|| (1_u32..=10).sum::<u32>())
        .await
        .expect("the blocking task must complete")
    });
    assert_eq!(sum, 55);

    let metrics = napi_async_runtime::metrics();
    assert!(metrics.tasks_spawned >= 1);
    assert!(metrics.blocking_tasks_started >= 1);

    napi_async_runtime::shutdown().expect("the shared async runtime must shut down cleanly");
  }
}
