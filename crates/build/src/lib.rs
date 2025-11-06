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
