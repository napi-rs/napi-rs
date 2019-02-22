extern crate bindgen;
extern crate cc;
extern crate glob;
extern crate semver;

use glob::glob;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn find_it<P>(exe_name: P) -> Option<PathBuf>
    where P: AsRef<Path>,
{
  env::var_os("PATH").and_then(|paths| {
    env::split_paths(&paths).filter_map(|dir| {
      let full_path = dir.join(&exe_name);
      if full_path.is_file() {
        Some(full_path)
      } else {
        None
      }
    }).next()
  })
}

fn main() {
  let node_include_path = find_it("node")
    .expect("can not find executable node")
    .parent().unwrap()
    .parent().unwrap()
    .join("include/node");
  let node_version = semver::Version::parse(
    String::from_utf8(Command::new("node")
      .arg("-v")
      .output()
      .unwrap().stdout
    )
      .unwrap()
      .as_str()
      .get(1..)
      .unwrap()
  ).unwrap();

  let node_major_version = node_version.major;

  println!("cargo:rerun-if-env-changed=NODE_INCLUDE_PATH");
  for entry in glob("./src/sys/**/*.*").unwrap() {
    println!(
      "cargo:rerun-if-changed={}",
      entry.unwrap().to_str().unwrap()
    );
  }

  // Activate the "node8" or "nodestable" feature for compatibility with
  // different versions of Node.js/N-API.
  println!("cargo:rustc-cfg=node{}", if node_major_version > 8 {
    "stable"
  } else if node_major_version == 8 {
    "8"
  } else {
    panic!("node version is too low")
  });

  bindgen::Builder::default()
    .header("src/sys/bindings.h")
    .clang_arg(String::from("-I") + node_include_path.to_str().unwrap())
    .rustified_enum("(napi_|uv_).+")
    .whitelist_function("(napi_|uv_|extras_).+")
    .whitelist_type("(napi_|uv_|extras_).+")
    .generate()
    .expect("Unable to generate napi bindings")
    .write_to_file("src/sys/bindings.rs")
    .expect("Unable to write napi bindings");

  cc::Build::new()
    .cpp(true)
    .include(&node_include_path)
    .file("src/sys/bindings.cc")
    .flag("-std=c++0x")
    .flag("-Wno-unused-parameter")
    .compile("extras");
}
