extern crate bindgen;
extern crate glob;
extern crate semver;
#[cfg(target_os = "windows")]
extern crate tar;

use glob::glob;

use std::env;
use std::path::PathBuf;
use std::process::Command;

#[cfg(not(any(target_os = "windows", napidocsrs)))]
const NODE_PRINT_EXEC_PATH: &'static str = "console.log(process.execPath)";

fn main() {
  let node_full_version =
    String::from_utf8(Command::new("node").arg("-v").output().unwrap().stdout).unwrap();
  let node_version = semver::Version::parse(node_full_version.as_str().get(1..).unwrap()).unwrap();

  let node_major_version = node_version.major;

  println!("cargo:rerun-if-env-changed=NODE_INCLUDE_PATH");
  for entry in glob("./src/**/*.*").unwrap() {
    println!(
      "cargo:rerun-if-changed={}",
      entry.unwrap().to_str().unwrap()
    );
  }

  if node_major_version < 8 && node_version.minor < 9 {
    panic!("node version is too low")
  }

  let node_include_path_buf = find_node_include_path(node_full_version.trim_end());

  let node_include_path = match env::var("NODE_INCLUDE_PATH") {
    Ok(node_include_path) => node_include_path,
    Err(_) => node_include_path_buf.to_str().unwrap().to_owned(),
  };

  let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());

  let mut sys_bindings_path = PathBuf::from("src");
  sys_bindings_path.push("bindings.h");

  let mut bindgen_builder = bindgen::Builder::default()
    .derive_default(true)
    .header(sys_bindings_path.to_str().unwrap().to_owned())
    .clang_arg(format!("-I{}", node_include_path));

  if let Ok(uv_include_path) = env::var("UV_INCLUDE_PATH") {
    bindgen_builder = bindgen_builder.clang_arg(format!("-I{}", uv_include_path));
  } else if cfg!(target_os = "freebsd") {
    bindgen_builder = bindgen_builder.clang_arg(format!(
      "-I{}",
      node_include_path_buf.parent().unwrap().to_str().unwrap()
    ));
  }

  bindgen_builder
    .rustified_enum("(napi_|uv_).+")
    .whitelist_function("(napi_|uv_|extras_).+")
    .whitelist_type("(napi_|uv_|extras_).+")
    .generate()
    .expect("Unable to generate napi bindings")
    .write_to_file(out_path.join("bindings.rs"))
    .expect("Unable to write napi bindings");
}

#[cfg(all(target_os = "windows", not(napidocsrs)))]
fn find_node_include_path(node_full_version: &str) -> PathBuf {
  let mut out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
  out_path.push(format!("node-headers-{}.tar.gz", node_full_version));
  let mut header_dist_path = PathBuf::from(&PathBuf::from(&out_path).parent().unwrap());
  let unpack_path = PathBuf::from(&header_dist_path);
  header_dist_path.push(format!("node-{}", node_full_version));
  header_dist_path.push("include");
  header_dist_path.push("node");
  if !header_dist_path.exists() {
    let script = r#"require('https').get(process.release.headersUrl, function (res) {
      res.pipe(require('zlib').createUnzip()).pipe(process.stdout)
    })"#;

    let tar_binary = Command::new("node")
      .arg("-e")
      .arg(script)
      .output()
      .expect("Download headers file failed")
      .stdout;
    tar::Archive::new(tar_binary.as_slice())
      .unpack(&unpack_path)
      .expect("Unpack headers file failed");
  };
  header_dist_path
}

#[cfg(napidocsrs)]
fn find_node_include_path(_node_full_version: &str) -> PathBuf {
  let mut current = env::current_dir().unwrap();
  current.push(".node-headers");
  current
}

#[cfg(not(any(target_os = "windows", napidocsrs)))]
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
