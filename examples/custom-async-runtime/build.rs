use std::env;

fn main() {
  println!("cargo:rustc-check-cfg=cfg(custom_runtime_wasi_threads)");
  if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("wasi") {
    let target = env::var("TARGET").expect("TARGET must be set by Cargo");
    if target == "wasm32-wasi" || target.ends_with("-threads") {
      println!("cargo:rustc-cfg=custom_runtime_wasi_threads");
    }
  }
  // `napi_build::setup()` owns the whole WASI link configuration (emnapi
  // archive selection, exports, reactor crt). Keeping a copy here previously
  // drifted from `crates/build/src/wasi.rs` (it still linked the emnapi v1
  // `emnapi-basic` archives after the emnapi v2 migration).
  napi_build::setup();
}
