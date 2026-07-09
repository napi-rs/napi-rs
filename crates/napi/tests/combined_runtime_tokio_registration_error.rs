#![cfg(all(feature = "async-runtime", feature = "tokio_rt", not(feature = "noop")))]

#[path = "support/combined_tokio_registration.rs"]
mod support;

use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};

use napi::bindgen_prelude::create_custom_tokio_runtime_factory;

#[test]
fn infallible_tokio_factory_error_is_scoped_to_tokio_compatibility_use() {
  support::start_custom_and_paired_tokio();

  let factory_called = Arc::new(AtomicBool::new(false));
  let factory_called_from_hook = Arc::clone(&factory_called);
  create_custom_tokio_runtime_factory(move || -> napi::Result<_> {
    factory_called_from_hook.store(true, Ordering::SeqCst);
    unreachable!("a rejected custom Tokio factory must not run")
  });
  assert!(!factory_called.load(Ordering::SeqCst));

  support::shutdown_and_wait();
  let error = support::restart_custom_and_paired_tokio()
    .expect_err("the deferred Tokio registration error must reject the Tokio compatibility use");
  assert_eq!(error.status, napi::Status::InvalidArg);
  support::assert_registration_error(&error);
  assert_eq!(
    support::starts(),
    2,
    "a deferred Tokio registration error must not poison custom-runtime restart"
  );
  support::shutdown_and_wait();
}
