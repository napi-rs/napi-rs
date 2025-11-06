use std::env;

mod android;
mod wasi;
mod windows;

pub fn setup() {
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
  #[cfg(feature = "dummy-napi")]
  let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH is not set");

  match target_os.as_str() {
    "android" => if android::setup().is_ok() {},
    "wasi" => {
      wasi::setup();
    }
    "windows" => {
      if let Ok("gnu") = env::var("CARGO_CFG_TARGET_ENV").as_deref() {
        windows::setup_gnu();
      }
    }
    #[cfg(feature = "dummy-napi")]
    "linux" => {
      if target_arch == "x86_64" {
        let rustc_v = rustc_version::version().expect("Failed to get rustc version");
        // Workaround for the `rust-lld`
        // https://blog.rust-lang.org/2025/09/01/rust-lld-on-1.90.0-stable/
        // Background:
        // https://github.com/rust-lang/rust/issues/147707
        if rustc_v.major > 1 || (rustc_v.major == 1 && rustc_v.minor >= 90) {
          println!("cargo:rustc-link-arg=-Wl,--unresolved-symbols=ignore-all");
          // ignore all undefined symbols during the linking stage is not enough
          // the rust-lld compiled binary will still try to resolve them at the runtime startup
          // we need to provide a dummy implementation in tests
        }
      }
    }
    _ => {}
  }

  if (target_env == "gnu" && target_os != "windows") || target_os == "freebsd" {
    // https://sourceware.org/bugzilla/show_bug.cgi?id=21032
    // https://sourceware.org/bugzilla/show_bug.cgi?id=21031
    // https://github.com/rust-lang/rust/issues/134820
    // pthread_key_create() destructors and segfault after a DSO unloading
    println!("cargo:rustc-link-arg=-Wl,-z,nodelete");
  }
}
