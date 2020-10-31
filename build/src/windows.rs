use crate::*;
use std::fs::{create_dir, metadata, write};
use std::io::Read;
use std::path::PathBuf;

fn get_node_version() -> std::io::Result<String> {
  let output = Command::new("node").arg("-v").output()?;
  let stdout_str = String::from_utf8_lossy(&output.stdout);

  // version should not have a leading "v" or trailing whitespace
  Ok(stdout_str.trim().trim_start_matches('v').to_string())
}

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
  // Assume nodejs if not specified.
  let dist_url = std::env::var("NPM_CONFIG_DISTURL").unwrap_or("https://nodejs.org/dist".into());

  // Try to get local nodejs version if not specified.
  let node_version = std::env::var("NPM_CONFIG_TARGET")
    .or_else(|_| get_node_version())
    .expect("Failed to determine nodejs version");

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

  println!("cargo:rerun-if-env-changed=NPM_CONFIG_DISTURL");
  println!("cargo:rerun-if-env-changed=NPM_CONFIG_TARGET");

  let mut node_lib_file_dir = PathBuf::from(
    String::from_utf8(
      Command::new("node")
        .arg("-e")
        .arg("console.log(require('os').homedir())")
        .output()
        .unwrap()
        .stdout,
    )
    .unwrap()
    .trim_end()
    .to_owned(),
  );

  node_lib_file_dir.push(".napi-rs");

  match create_dir(&node_lib_file_dir) {
    Ok(_) => {}
    Err(err) => {
      if err.kind() != std::io::ErrorKind::AlreadyExists {
        panic!(
          "create {} folder failed: {}",
          node_lib_file_dir.to_str().unwrap(),
          err
        )
      }
    }
  }

  let link_search_dir = node_lib_file_dir.clone();

  node_lib_file_dir.push(format!("node-{}.lib", node_version));

  if let Err(_) = metadata(&node_lib_file_dir) {
    let node_lib = download_node_lib(&dist_url, &node_version, &arch);
    write(&node_lib_file_dir, &node_lib).expect(&format!(
      "Could not save file to {}",
      node_lib_file_dir.to_str().unwrap()
    ));
  }
  println!(
    "cargo:rustc-link-lib={}",
    &node_lib_file_dir.file_stem().unwrap().to_str().unwrap()
  );
  println!(
    "cargo:rustc-link-search=native={}",
    link_search_dir.to_str().unwrap()
  );
  println!("cargo:rustc-cdylib-link-arg=delayimp.lib");
  println!("cargo:rustc-cdylib-link-arg=/DELAYLOAD:node.exe");
  setup_napi_feature();
}
