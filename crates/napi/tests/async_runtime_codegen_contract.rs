//! Compile-time coverage for the versioned contract used by generated `#[napi(async_runtime)]`
//! entry guards.

#[test]
fn versioned_async_runtime_codegen_contract_is_available() {
  const { napi::__private::codegen_v1::assert_contract_version(1) };

  fn assert_enter_signature() -> napi::Result<u8> {
    napi::__private::codegen_v1::within_selected_async_runtime(|| Ok(42))
  }
  fn assert_legacy_enter_signature() -> napi::Result<u8> {
    napi::bindgen_prelude::within_custom_runtime_if_available(|| Ok(42))
  }

  let _ = assert_enter_signature as fn() -> napi::Result<u8>;
  let _ = assert_legacy_enter_signature as fn() -> napi::Result<u8>;
  assert_eq!(napi::__private::async_runtime_v1::CONTRACT_VERSION, 1);
  assert_eq!(napi::__private::codegen_v1::CONTRACT_VERSION, 1);
  #[cfg(any(
    feature = "noop",
    not(any(feature = "async-runtime", feature = "tokio_rt"))
  ))]
  {
    assert_eq!(assert_enter_signature().unwrap(), 42);
    assert_eq!(assert_legacy_enter_signature().unwrap(), 42);
  }
}
