use std::env;
use std::path::PathBuf;

pub fn setup_gnu() {
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
