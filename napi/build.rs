extern crate bindgen;
extern crate cc;
#[cfg(windows)]
extern crate flate2;
extern crate glob;
extern crate napi_build;
#[cfg(windows)]
extern crate reqwest;
extern crate semver;
#[cfg(windows)]
extern crate tar;

use glob::glob;

use std::borrow::Cow;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

// https://stackoverflow.com/questions/37498864/finding-executable-in-path-with-rust

#[cfg(not(target_os = "windows"))]
fn enhance_exe_name(exe_name: &Path) -> Cow<Path> {
  exe_name.into()
}

#[cfg(target_os = "windows")]
fn enhance_exe_name(exe_name: &Path) -> Cow<Path> {
  use std::ffi::OsStr;
  use std::os::windows::ffi::OsStrExt;

  let raw_input: Vec<_> = exe_name.as_os_str().encode_wide().collect();
  let raw_extension: Vec<_> = OsStr::new(".exe").encode_wide().collect();

  if raw_input.ends_with(&raw_extension) {
    exe_name.into()
  } else {
    let mut with_exe = exe_name.as_os_str().to_owned();
    with_exe.push(".exe");
    PathBuf::from(with_exe).into()
  }
}

fn find_it<P>(exe_name: P) -> Option<PathBuf>
where
  P: AsRef<Path>,
{
  let exe_name = enhance_exe_name(exe_name.as_ref());
  env::var_os("PATH").and_then(|paths| {
    env::split_paths(&paths)
      .filter_map(|dir| {
        let full_path = dir.join(&exe_name);
        if full_path.is_file() {
          Some(full_path)
        } else {
          None
        }
      })
      .next()
  })
}

fn main() {
  napi_build::setup();
  let node_full_version =
    String::from_utf8(Command::new("node").arg("-v").output().unwrap().stdout).unwrap();
  let node_version = semver::Version::parse(node_full_version.as_str().get(1..).unwrap()).unwrap();

  let node_major_version = node_version.major;

  println!("cargo:rerun-if-env-changed=NODE_INCLUDE_PATH");
  for entry in glob("./src/sys/**/*.*").unwrap() {
    println!(
      "cargo:rerun-if-changed={}",
      entry.unwrap().to_str().unwrap()
    );
  }

  env::set_var("CARGO_RUSTC_FLAGS", "-Clink-args=-export_dynamic");

  if node_major_version < 10 {
    panic!("node version is too low")
  }

  let node_include_path = find_node_include_path(node_full_version.trim_end());

  let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());

  let mut sys_bindigs_path = PathBuf::from("src");
  sys_bindigs_path.push("sys");
  sys_bindigs_path.push("bindings.h");

  bindgen::Builder::default()
    .header(sys_bindigs_path.to_str().unwrap().to_owned())
    .clang_arg(String::from("-I") + node_include_path.to_str().unwrap())
    .rustified_enum("(napi_|uv_).+")
    .whitelist_function("(napi_|uv_|extras_).+")
    .whitelist_type("(napi_|uv_|extras_).+")
    .generate()
    .expect("Unable to generate napi bindings")
    .write_to_file(out_path.join("bindings.rs"))
    .expect("Unable to write napi bindings");

  let mut bindings_path = PathBuf::from("src");
  bindings_path.push("sys");
  bindings_path.push("bindings.cc");

  let mut cc_builder = cc::Build::new();

  cc_builder
    .cpp(true)
    .include(&node_include_path)
    .file(bindings_path);
  if !cfg!(windows) {
    cc_builder.flag("-Wno-unused-parameter");
  };

  if cfg!(target_os = "macos") {
    cc_builder.flag("-std=c++0x");
  } else if cfg!(linux) || cfg!(target_env = "gnu") {
    cc_builder.flag("-std=c++14");
  }

  cc_builder
    .cargo_metadata(true)
    .out_dir(&out_path)
    .compile("napi-bindings");
}

#[cfg(target_os = "windows")]
fn find_node_include_path(node_full_version: &str) -> PathBuf {
  let mut node_exec_path = PathBuf::from(
    find_it("node")
      .expect("can not find executable node")
      .parent()
      .unwrap(),
  );
  node_exec_path.push(format!("node-headers-{}.tar.gz", node_full_version));
  let mut header_dist_path = PathBuf::from(&PathBuf::from(&node_exec_path).parent().unwrap());
  let unpack_path = PathBuf::from(&header_dist_path);
  header_dist_path.push(format!("node-{}", node_full_version));
  header_dist_path.push("include");
  header_dist_path.push("node");
  if !header_dist_path.exists() {
    let header_file_download_url = String::from_utf8(
      Command::new("node")
        .args(vec!["-e", "console.log(process.release.headersUrl)"])
        .output()
        .unwrap()
        .stdout,
    )
    .unwrap();
    let resp = reqwest::blocking::get(&header_file_download_url).expect("request failed");
    tar::Archive::new(flate2::read::GzDecoder::new(resp))
      .unpack(&unpack_path)
      .expect("Unpack headers file failed");
  };
  header_dist_path
}

#[cfg(not(target_os = "windows"))]
fn find_node_include_path(_node_full_version: &str) -> PathBuf {
  let node_exec_path = find_it("node").expect("can not find executable node");
  node_exec_path
    .parent()
    .unwrap()
    .parent()
    .unwrap()
    .join("include/node")
}
