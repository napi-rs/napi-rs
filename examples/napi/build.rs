fn main() {
  println!("cargo::rustc-check-cfg=cfg(tokio_unstable)");
  println!("cargo::rustc-check-cfg=cfg(napi_tsfn_public_behavior_test)");

  if std::env::var("TARGET").as_deref() == Ok("wasm32-wasip1-threads")
    && std::env::var_os("CARGO_FEATURE_NOOP").is_none()
  {
    println!("cargo::rustc-cfg=napi_tsfn_public_behavior_test");
    println!("cargo::rustc-link-arg=--export=__napi_rs_test_tsfn_state_ptr");
  }

  use napi_build::setup;

  setup();
}
