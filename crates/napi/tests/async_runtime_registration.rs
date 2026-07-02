//! Double registration of a custom [`AsyncRuntime`] must panic loudly.
//!
//! This lives in its own integration-test target on purpose: the registration is
//! process-global (a `OnceLock`), and the unit-test binary of the `napi` crate already
//! registers its own backend — a `#[should_panic]` double-registration test in that binary
//! would cross-contaminate the other tests (and vice versa).
#![cfg(all(feature = "async-runtime", not(feature = "noop")))]

use std::{future::Future, pin::Pin};

use napi::bindgen_prelude::{create_custom_async_runtime, AsyncRuntime};

struct FirstRuntime;

impl AsyncRuntime for FirstRuntime {
  fn spawn(&self, _future: Pin<Box<dyn Future<Output = ()> + Send + 'static>>) {}

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}
}

struct SecondRuntime;

impl AsyncRuntime for SecondRuntime {
  fn spawn(&self, _future: Pin<Box<dyn Future<Output = ()> + Send + 'static>>) {}

  fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) {}
}

#[test]
#[should_panic(expected = "create_custom_async_runtime was called more than once")]
fn double_registration_of_custom_async_runtime_panics() {
  create_custom_async_runtime(FirstRuntime);
  // The second registration must fail loudly instead of being silently dropped.
  create_custom_async_runtime(SecondRuntime);
}
