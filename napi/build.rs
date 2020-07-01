extern crate bindgen;
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

use std::env;
use std::path::PathBuf;
use std::process::Command;

// https://stackoverflow.com/questions/37498864/finding-executable-in-path-with-rust

const NODE_PRINT_EXEC_PATH: &'static str = "console.log(process.execPath)";

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

  let napi_version = String::from_utf8(
    Command::new("node")
      .args(&["-e", "console.log(process.versions.napi)"])
      .output()
      .unwrap()
      .stdout,
  )
  .unwrap();

  for version in 2..napi_version.trim().parse::<u32>().unwrap() {
    println!("cargo:rustc-cfg=napi{}", version);
  }
}

#[cfg(target_os = "windows")]
fn find_node_include_path(node_full_version: &str) -> PathBuf {
  let mut node_exec_path = PathBuf::from(
    String::from_utf8(
      Command::new("node")
        .arg("-e")
        .arg(NODE_PRINT_EXEC_PATH)
        .output()
        .unwrap()
        .stdout,
    )
    .expect("can not find executable node"),
  )
  .parent()
  .unwrap()
  .to_path_buf();
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
  let node_exec_path = String::from_utf8(
    Command::new("node")
      .arg("-e")
      .arg(NODE_PRINT_EXEC_PATH)
      .output()
      .unwrap()
      .stdout,
  )
  .unwrap();
  PathBuf::from(node_exec_path)
    .parent()
    .unwrap()
    .parent()
    .unwrap()
    .join("include/node")
}
