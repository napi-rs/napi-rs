use std::env;

mod android;
mod wasi;
mod windows;

/// The build-script lines that give the calling crate `cfg(napi_wasi_threads)`.
///
/// The `rustc-check-cfg` line is unconditional, so the cfg is a *known* cfg on
/// every target and `#[cfg(napi_wasi_threads)]` never trips the
/// `unexpected_cfgs` lint. The `rustc-cfg` line is emitted only for the
/// threaded WASI target, matched as an exact triple — the same gate
/// `crates/napi/build.rs` and `crates/async-runtime/build.rs` use, because the
/// addon and `napi` have to agree on what the cfg means.
///
/// `cargo::` rather than the legacy `cargo:` form: the double-colon syntax
/// needs Cargo 1.77 and this crate's `rust-version` is 1.88, so a toolchain
/// old enough to misread it cannot compile `napi-build` in the first place.
/// Both napi build scripts already emit their cfgs this way.
fn wasi_threads_cfg_lines(target: &str) -> Vec<&'static str> {
  let mut lines = vec!["cargo::rustc-check-cfg=cfg(napi_wasi_threads)"];
  if target == "wasm32-wasip1-threads" {
    lines.push("cargo::rustc-cfg=napi_wasi_threads");
  }
  lines
}

/// Configure the build of a `napi-rs` addon crate.
///
/// Call it from the addon's `build.rs`. Besides the per-platform link
/// arguments, it hands the crate a first-party `cfg(napi_wasi_threads)`, set
/// exactly when the crate is compiled for `wasm32-wasip1-threads`:
///
/// ```ignore
/// // build.rs
/// fn main() {
///   napi_build::setup();
/// }
///
/// // src/lib.rs
/// #[cfg(napi_wasi_threads)]
/// const SHARED_MEMORY: bool = true;
/// #[cfg(not(napi_wasi_threads))]
/// const SHARED_MEMORY: bool = false;
/// ```
///
/// rustc has no built-in cfg that tells the two WASI targets apart: it prints
/// an *identical* cfg set for `wasm32-wasip1` and `wasm32-wasip1-threads`
/// (same `target_env = "p1"`), and the wasm `atomics` target feature is
/// unstable, so the stable channel never puts `target_feature = "atomics"` in
/// the cfg set of either one (rust-lang/rust#77839). Only the exact cargo
/// `TARGET` answers the question, and only a build script can read it.
///
/// A build-script cfg is crate-local: it reaches the crate whose `build.rs`
/// called this function and nothing else. Every other crate in the graph that
/// needs the distinction needs its own build script. Absence must therefore be
/// the conservative branch — a plain `cargo build` compiles the
/// `not(napi_wasi_threads)` side, and that side has to stay correct.
pub fn setup() {
  for line in wasi_threads_cfg_lines(&env::var("TARGET").unwrap_or_default()) {
    println!("{line}");
  }

  // compatible with the v2 versions, will remove in the future
  {
    println!("cargo:rerun-if-env-changed=DEBUG_GENERATED_CODE");
    println!("cargo:rerun-if-env-changed=TYPE_DEF_TMP_PATH");
    println!("cargo:rerun-if-env-changed=CARGO_CFG_NAPI_RS_CLI_VERSION");
  }

  println!("cargo::rerun-if-env-changed=NAPI_DEBUG_GENERATED_CODE");
  println!("cargo::rerun-if-env-changed=NAPI_TYPE_DEF_TMP_FOLDER");
  println!(
    "cargo::rerun-if-env-changed=NAPI_FORCE_BUILD_{}",
    env::var("CARGO_PKG_NAME")
      .expect("CARGO_PKG_NAME is not set")
      .to_uppercase()
      .replace("-", "_")
  );

  let target_env = env::var("CARGO_CFG_TARGET_ENV").expect("CARGO_CFG_TARGET_ENV is not set");
  let target_os = env::var("CARGO_CFG_TARGET_OS").expect("CARGO_CFG_TARGET_OS is not set");

  match target_os.as_str() {
    "android" => if android::setup().is_ok() {},
    "wasi" => {
      wasi::setup();
    }
    "macos" => {
      // Keep the dynamic lookup behavior on macOS to avoid breaking changes.
      println!("cargo:rustc-cdylib-link-arg=-Wl");
      println!("cargo:rustc-cdylib-link-arg=-undefined");
      println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
    }
    "windows" => {
      if let Ok("gnu") = env::var("CARGO_CFG_TARGET_ENV").as_deref() {
        windows::setup_gnu();
      }
    }
    _ => {}
  }

  if (target_env == "gnu" && target_os != "windows")
    || target_os == "freebsd"
    || target_os == "openbsd"
  {
    // https://sourceware.org/bugzilla/show_bug.cgi?id=21032
    // https://sourceware.org/bugzilla/show_bug.cgi?id=21031
    // https://github.com/rust-lang/rust/issues/134820
    // pthread_key_create() destructors and segfault after a DSO unloading
    println!("cargo:rustc-link-arg=-Wl,-z,nodelete");
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn emits_the_cfg_for_the_threaded_wasi_target() {
    assert_eq!(
      wasi_threads_cfg_lines("wasm32-wasip1-threads"),
      vec![
        "cargo::rustc-check-cfg=cfg(napi_wasi_threads)",
        "cargo::rustc-cfg=napi_wasi_threads",
      ]
    );
  }

  #[test]
  fn keeps_the_cfg_off_the_threadless_wasi_target() {
    assert_eq!(
      wasi_threads_cfg_lines("wasm32-wasip1"),
      vec!["cargo::rustc-check-cfg=cfg(napi_wasi_threads)"]
    );
  }

  #[test]
  fn still_declares_the_cfg_on_a_native_target() {
    assert_eq!(
      wasi_threads_cfg_lines("x86_64-unknown-linux-gnu"),
      vec!["cargo::rustc-check-cfg=cfg(napi_wasi_threads)"]
    );
  }
}
