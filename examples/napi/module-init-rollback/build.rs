use std::env;

fn main() {
  let target_env = env::var("CARGO_CFG_TARGET_ENV").expect("CARGO_CFG_TARGET_ENV is not set");
  let target_os = env::var("CARGO_CFG_TARGET_OS").expect("CARGO_CFG_TARGET_OS is not set");
  let setup_would_disable_unloading = (target_env == "gnu"
    && !matches!(target_os.as_str(), "windows" | "android"))
    || matches!(target_os.as_str(), "freebsd" | "openbsd");

  if target_os == "linux" {
    println!("cargo:rustc-cdylib-link-arg=-Wl,--wrap=napi_add_env_cleanup_hook");
  }

  if setup_would_disable_unloading {
    setup_rerun_tracking();
  } else {
    napi_build::setup();
  }
}

fn setup_rerun_tracking() {
  println!("cargo:rerun-if-env-changed=DEBUG_GENERATED_CODE");
  println!("cargo:rerun-if-env-changed=TYPE_DEF_TMP_PATH");
  println!("cargo:rerun-if-env-changed=CARGO_CFG_NAPI_RS_CLI_VERSION");
  println!("cargo::rerun-if-env-changed=NAPI_DEBUG_GENERATED_CODE");
  println!("cargo::rerun-if-env-changed=NAPI_TYPE_DEF_TMP_FOLDER");
  println!(
    "cargo::rerun-if-env-changed=NAPI_FORCE_BUILD_{}",
    env::var("CARGO_PKG_NAME")
      .expect("CARGO_PKG_NAME is not set")
      .to_uppercase()
      .replace('-', "_")
  );
}
