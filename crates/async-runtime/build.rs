/// Emit this crate's two first-party target cfgs.
///
/// - `napi_runtime_wasi_threads` -- exactly the threaded WASI target, which is
///   what `THREADLESS_BUILD` discriminates on.
/// - `napi_runtime_os_threads` -- "this build can create OS threads": every
///   non-wasm target plus `wasm32-wasip1-threads`.
///
/// Neither can be derived from a built-in cfg; see the note in the body.
fn main() {
  // The two WASI targets are indistinguishable at cfg level on current rustc:
  // `rustc --print cfg` emits IDENTICAL sets for wasm32-wasip1 and
  // wasm32-wasip1-threads (same `target_env = "p1"`, and `target_feature =
  // "atomics"` is set for NEITHER -- verified empirically: a
  // wasm32-wasip1-threads build compiled `cfg!(target_feature = "atomics")`
  // to false). `THREADLESS_BUILD`'s target discrimination therefore comes
  // from the exact cargo TARGET, emitted here as a first-party cfg.
  println!("cargo::rustc-check-cfg=cfg(napi_runtime_wasi_threads)");
  println!("cargo::rustc-check-cfg=cfg(napi_runtime_os_threads)");
  let target = std::env::var("TARGET").unwrap_or_default();
  let wasm = std::env::var("CARGO_CFG_TARGET_FAMILY")
    .is_ok_and(|family| family.split(',').any(|family| family == "wasm"));
  if target == "wasm32-wasip1-threads" {
    println!("cargo::rustc-cfg=napi_runtime_wasi_threads");
  }
  // "this build can create OS threads": every non-wasm target, plus the one
  // wasm target whose std links a real `pthread_create` (`wasi.thread-spawn`).
  // Kept orthogonal to `napi_runtime_wasi_threads`, which keeps its exact
  // "threaded WASI target" meaning for `THREADLESS_BUILD`.
  if !wasm || target == "wasm32-wasip1-threads" {
    println!("cargo::rustc-cfg=napi_runtime_os_threads");
  }
}
