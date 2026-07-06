#[cfg(all(
  feature = "async-runtime",
  feature = "tokio",
  not(feature = "tokio_rt"),
  not(feature = "noop")
))]
#[test]
fn custom_tokio_runtime_requires_tokio_rt() {
  let runtime = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("test runtime should build");
  let error = napi::bindgen_prelude::try_create_custom_tokio_runtime(runtime)
    .expect_err("a runtime that cannot be installed must not report success");

  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("tokio_rt feature is not enabled"));
}

#[cfg(all(feature = "noop", feature = "async-runtime", feature = "tokio"))]
#[test]
fn custom_tokio_runtime_is_rejected_by_noop_builds() {
  let runtime = tokio::runtime::Builder::new_current_thread()
    .build()
    .expect("test runtime should build");
  let error = napi::bindgen_prelude::try_create_custom_tokio_runtime(runtime)
    .expect_err("a noop build cannot install a runtime");

  assert_eq!(error.status, napi::Status::InvalidArg);
  assert!(error.reason.contains("noop build"));
}
