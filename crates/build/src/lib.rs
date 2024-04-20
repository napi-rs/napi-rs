mod android;
mod macos;
mod wasi;

use std::env;
use std::path::PathBuf;

pub fn setup() {
  println!("cargo:rerun-if-env-changed=DEBUG_GENERATED_CODE");
  println!("cargo:rerun-if-env-changed=TYPE_DEF_TMP_PATH");
  println!("cargo:rerun-if-env-changed=CARGO_CFG_NAPI_RS_CLI_VERSION");

  match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
    Ok("macos") => {
      macos::setup();
    }
    Ok("android") => if android::setup().is_ok() {},
    Ok("wasi") => {
      wasi::setup();
    }
    _ => {}
  }

  if env::var("CARGO_CFG_TARGET_ENV").unwrap().contains("gnu") {
    let target_triple = env::var("TARGET").unwrap();
    if target_triple.contains("windows") {
      let libnode_path = search_libnode_path();
      if let Some(libnode_dir) = libnode_path {
        let node_lib_path = libnode_dir.join("libnode.dll");
        if node_lib_path.exists() {
          println!("cargo:rustc-link-search=native={}", libnode_dir.display());
          println!("cargo:rustc-link-lib=node");
        } else {
          panic!("libnode.dll not found in {}", libnode_dir.display());
        }
      } else {
        panic!("libnode.dll not found in any search path");
      }
    }
  }
}

fn search_libnode_path() -> Option<PathBuf> {
  if let Ok(path) = env::var("LIBNODE_PATH") {
    let libnode_dir = PathBuf::from(path);
    if libnode_dir.exists() {
      return Some(libnode_dir);
    }
  }

  if let Ok(paths) = env::var("LIBPATH") {
    for path in env::split_paths(&paths) {
      if path.join("libnode.dll").exists() {
        return Some(path);
      }
    }
  }

  if let Ok(paths) = env::var("PATH") {
    for path in env::split_paths(&paths) {
      if path.join("libnode.dll").exists() {
        return Some(path);
      }
    }
  }

  None
}
