/// Give this crate `cfg(napi_wasi_threads)` for exactly `wasm32-wasip1-threads`; it gates the
/// `wasi_heap_sync` module.
///
/// rustc prints the same cfg set for `wasm32-wasip1` and `wasm32-wasip1-threads`, so only the
/// exact cargo `TARGET` tells them apart. `crates/napi/build.rs`, `crates/build/src/lib.rs` and
/// `crates/async-runtime/build.rs` gate on the same triple.
fn main() {
  println!("cargo::rerun-if-changed=build.rs");
  println!("cargo::rustc-check-cfg=cfg(napi_wasi_threads)");
  if std::env::var("TARGET").as_deref() == Ok("wasm32-wasip1-threads") {
    println!("cargo::rustc-cfg=napi_wasi_threads");
  }
}
