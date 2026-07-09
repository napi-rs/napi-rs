#![cfg(all(feature = "async-runtime", feature = "tokio_rt", not(feature = "noop")))]

#[path = "support/combined_tokio_registration.rs"]
mod support;

use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};

use napi::bindgen_prelude::try_create_custom_tokio_runtime_factory;

#[test]
fn fallible_tokio_factory_error_preserves_combined_builtin_fallback() {
  support::start_custom_and_paired_tokio();

  let factory_called = Arc::new(AtomicBool::new(false));
  let factory_called_from_hook = Arc::clone(&factory_called);
  let error = try_create_custom_tokio_runtime_factory(move || -> napi::Result<_> {
    factory_called_from_hook.store(true, Ordering::SeqCst);
    unreachable!("a rejected custom Tokio factory must not run")
  })
  .expect_err("the rejected custom Tokio factory must report its error directly");
  assert_eq!(error.status, napi::Status::InvalidArg);
  support::assert_registration_error(&error);
  assert!(!factory_called.load(Ordering::SeqCst));

  support::shutdown_and_wait();
  assert_eq!(
    support::restart_custom_and_paired_tokio()
      .expect("the combined runtimes must remain restartable"),
    42
  );
  assert_eq!(
    support::starts(),
    2,
    "a fallible Tokio registration error must not poison selected-runtime restart"
  );
  support::shutdown_and_wait();
}
