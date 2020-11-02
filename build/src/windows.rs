use crate::*;
use std::collections::hash_map::DefaultHasher;
use std::fs::{metadata, write};
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::PathBuf;

fn download_node_lib(dist_url: &str, version: &str, arch: &str) -> Vec<u8> {
  // Assume windows since we know we are building on windows.
  let url = format!(
    "{dist_url}/v{version}/win-{arch}/node.lib",
    dist_url = dist_url,
    version = version,
    arch = arch
  );

  let response = ureq::get(&url).call();
  if let Some(error) = response.synthetic_error() {
    panic!("Failed to download node.lib: {:#?}", error);
  }

  let mut reader = response.into_reader();
  let mut bytes = vec![];
  reader.read_to_end(&mut bytes).unwrap();

  bytes
}

pub fn setup() {
  let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR is not set");
  let dist_url = get_dist_url();
  let node_version = get_target_node_version().expect("Failed to determine nodejs version");

  // NPM also gives us an arch var, but let's trust cargo more.
  // We translate from cargo's arch env format into npm/gyps's.
  // See https://doc.rust-lang.org/reference/conditional-compilation.html#target_arch for rust env values.
  // Nodejs appears to follow `process.arch`.
  // See https://nodejs.org/docs/latest/api/process.html#process_process_arch for npm env values.
  let arch = std::env::var("CARGO_CFG_TARGET_ARCH")
    .map(|arch| match arch.as_str() {
      "x86" => "x86", // TODO: x86 appears to also be called ia32 in npm_config_arch sometimes. What is the right value?
      "x86_64" => "x64",
      "mips" => "mips",
      "powerpc" => "ppc",
      "powerpc64" => "ppc64",
      "arm" => "arm",
      "aarch64" => "arm64",
      arch => panic!("Unknown Architecture: {}", arch),
    })
    .expect("Failed to determine target arch");

  let mut node_lib_file_path = PathBuf::from(out_dir);
  let link_search_dir = node_lib_file_path.clone();

  // Hash the dist_url and store it in the node lib file name.
  let dist_url_hash = {
    let mut hasher = DefaultHasher::new();
    dist_url.hash(&mut hasher);
    hasher.finish()
  };

  // Encode version, arch, and dist_url to detect and reaquire node.lib when these 3 change.
  let node_lib_file_name = format!(
    "node-{version}-{arch}-{dist_url_hash}.lib",
    version = node_version,
    arch = arch,
    dist_url_hash = dist_url_hash
  );
  node_lib_file_path.push(&node_lib_file_name);

  // If file does not exist, download it.
  if metadata(&node_lib_file_path).is_err() {
    let node_lib = download_node_lib(&dist_url, &node_version, &arch);

    write(&node_lib_file_path, &node_lib).expect(&format!(
      "Could not save file to {}",
      node_lib_file_path.to_str().unwrap()
    ));
  }

  println!(
    "cargo:rustc-link-lib={}",
    node_lib_file_path.file_stem().unwrap().to_str().unwrap()
  );
  println!(
    "cargo:rustc-link-search=native={}",
    link_search_dir.display()
  );
  println!("cargo:rustc-cdylib-link-arg=delayimp.lib");
  println!("cargo:rustc-cdylib-link-arg=/DELAYLOAD:node.exe");
}
