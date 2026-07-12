fn main() {
  // The two WASI targets are indistinguishable at cfg level on current rustc:
  // `rustc --print cfg` emits IDENTICAL sets for wasm32-wasip1 and
  // wasm32-wasip1-threads (same `target_env = "p1"`, and `target_feature =
  // "atomics"` is set for NEITHER -- verified empirically: a
  // wasm32-wasip1-threads build compiled `cfg!(target_feature = "atomics")`
  // to false). `THREADLESS_BUILD`'s target discrimination therefore comes
  // from the exact cargo TARGET, emitted here as a first-party cfg.
  println!("cargo::rustc-check-cfg=cfg(napi_runtime_wasi_threads)");
  if std::env::var("TARGET").as_deref() == Ok("wasm32-wasip1-threads") {
    println!("cargo::rustc-cfg=napi_runtime_wasi_threads");
  }
}
