#![allow(clippy::expect_fun_call)]
use std::env;
use std::fs::{metadata, write};
use std::path::PathBuf;

fn copy_node_lib(arch: &str) -> Vec<u8> {
  match arch {
    "x64" => include_bytes!("libs/node-x64.lib").to_vec(),
    "x86" => include_bytes!("libs/node-x86.lib").to_vec(),
    "arm64" => include_bytes!("libs/node-arm64.lib").to_vec(),
    _ => unreachable!(),
  }
}

pub fn setup() {
  let out_dir = env::var("OUT_DIR").expect("OUT_DIR is not set");

  // NPM also gives us an arch var, but let's trust cargo more.
  // We translate from cargo's arch env format into npm/gyps's.
  // See https://doc.rust-lang.org/reference/conditional-compilation.html#target_arch for rust env values.
  // Nodejs appears to follow `process.arch`.
  // See https://nodejs.org/docs/latest/api/process.html#process_process_arch for npm env values.
  // For windows, we only support `['ia32', 'x64', 'arm64']`
  // https://github.com/nodejs/node-gyp/blob/master/lib/install.js#L301
  let arch = env::var("CARGO_CFG_TARGET_ARCH")
    .map(|arch| match arch.as_str() {
      "x86" => "x86",
      "x86_64" => "x64",
      // https://github.com/nodejs/node/issues/25998
      // actually not supported for now
      // but we can get it from https://unofficial-builds.nodejs.org/download/release
      // just set the `NPM_CONFIG_DISTURL` to `https://unofficial-builds.nodejs.org/download/release`
      "aarch64" => "arm64",
      arch => panic!("Unsupported CPU Architecture: {}", arch),
    })
    .expect("Failed to determine target arch");

  let mut node_lib_file_path = PathBuf::from(out_dir);
  let link_search_dir = node_lib_file_path.clone();

  // Encode arch to detect and require node.lib.
  let node_lib_file_name = format!("node-{arch}.lib", arch = arch,);
  node_lib_file_path.push(&node_lib_file_name);

  // If file does not exist, download it.
  if metadata(&node_lib_file_path).is_err() {
    let node_lib = copy_node_lib(&arch);

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
  // Link `win_delay_load_hook.obj`
  // Needed for electron, but okay for other environments
  // https://github.com/neon-bindings/neon/pull/627
  println!("cargo:rustc-cdylib-link-arg=delayimp.lib");
  println!("cargo:rustc-cdylib-link-arg=/DELAYLOAD:node.exe");
}
