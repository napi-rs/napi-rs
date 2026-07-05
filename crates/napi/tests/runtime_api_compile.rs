//! Compile-time coverage for runtime helper signatures across additive Cargo features.
#![cfg(not(feature = "noop"))]

#[cfg(feature = "async-runtime")]
#[test]
fn custom_runtime_helper_signatures_are_feature_stable() {
  use napi::bindgen_prelude::{
    spawn_blocking_on_custom_runtime, spawn_on_custom_runtime, JoinHandle,
  };

  fn assert_spawn_signature() -> JoinHandle<u8> {
    spawn_on_custom_runtime(async { 42 })
  }

  fn assert_spawn_blocking_signature() -> JoinHandle<u8> {
    spawn_blocking_on_custom_runtime(|| 42)
  }

  let _ = assert_spawn_signature as fn() -> JoinHandle<u8>;
  let _ = assert_spawn_blocking_signature as fn() -> JoinHandle<u8>;
}

#[cfg(feature = "tokio_rt")]
#[test]
fn tokio_runtime_helper_signatures_remain_compatible() {
  use napi::bindgen_prelude::{spawn, spawn_blocking};

  fn assert_spawn_signature() -> tokio::task::JoinHandle<()> {
    spawn(async {})
  }

  fn assert_spawn_blocking_signature() -> tokio::task::JoinHandle<u8> {
    spawn_blocking(|| 42)
  }

  let _ = assert_spawn_signature as fn() -> tokio::task::JoinHandle<()>;
  let _ = assert_spawn_blocking_signature as fn() -> tokio::task::JoinHandle<u8>;
}
