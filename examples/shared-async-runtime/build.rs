fn main() {
  // `napi_build::setup()` owns the whole WASI link configuration (emnapi
  // archive selection, exports, reactor crt) and requires the emnapi archives
  // advertised through `EMNAPI_LINK_DIR`, which the napi cli (or the vendored
  // emnapi install) provides when producing a real WASI artifact. Keep plain
  // `cargo check --target wasm32-wasip1(-threads)` working without that
  // toolchain: type checking never links, so the link setup is only needed
  // when an artifact is actually produced.
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("wasi")
    && std::env::var_os("EMNAPI_LINK_DIR").is_none()
  {
    return;
  }
  napi_build::setup();
}
