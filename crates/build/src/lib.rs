use std::env;

mod android;
mod macos;
mod wasi;
mod windows;

pub fn setup() {
  let package_name = env::var("CARGO_PKG_NAME").expect("CARGO_PKG_NAME is not set");

  println!("cargo:rerun-if-env-changed=DEBUG_GENERATED_CODE");
  println!("cargo:rerun-if-env-changed=TYPE_DEF_TMP_PATH");
  println!("cargo:rerun-if-env-changed=CARGO_CFG_NAPI_RS_CLI_VERSION");
  println!(
    "cargo:rerun-if-env-changed=NAPI_PACKAGE_{}_INVALID",
    package_name.to_uppercase().replace("-", "_")
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
