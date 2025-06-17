use std::env;

mod android;
mod macos;
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

  match env::var("CARGO_CFG_TARGET_OS").as_deref() {
    Ok("macos") => {
      macos::setup();
    }
    Ok("android") => if android::setup().is_ok() {},
    Ok("wasi") => {
      wasi::setup();
    }
    Ok("windows") => {
      if let Ok("gnu") = env::var("CARGO_CFG_TARGET_ENV").as_deref() {
        windows::setup_gnu();
      }
    }
    _ => {}
  }
}
