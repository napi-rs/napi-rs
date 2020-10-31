extern crate cfg_if;

use std::process::Command;

use cfg_if::cfg_if;

cfg_if! {
  if #[cfg(windows)] {
    use std::fs::{create_dir, metadata, write};
    use std::path::PathBuf;
    use std::io::Read;

    fn get_node_version() -> std::io::Result<String> {
        let output = Command::new("node").arg("-v").output()?;
        let stdout_str = String::from_utf8_lossy(&output.stdout);

        // version should not have a leading "v" or trailing whitespace
        Ok(stdout_str.trim().trim_start_matches('v').to_string())
    }

    fn download_node_lib(version: &str) -> Vec<u8> {
      let url = format!("https://nodejs.org/dist/v{version}/win-x64/node.lib", version = version);

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
      let node_version = get_node_version().expect("Failed to determine nodejs version");

      let mut node_lib_file_dir =
        PathBuf::from(String::from_utf8(Command::new("node").arg("-e").arg("console.log(require('os').homedir())").output().unwrap().stdout).unwrap().trim_end().to_owned());

      node_lib_file_dir.push(".napi-rs");

      match create_dir(&node_lib_file_dir) {
        Ok(_) => {},
        Err(err) => {
          if err.kind() != std::io::ErrorKind::AlreadyExists {
            panic!("create {} folder failed: {}", node_lib_file_dir.to_str().unwrap(), err)
          }
        },
      }

      let link_search_dir = node_lib_file_dir.clone();

      node_lib_file_dir.push(format!("node-{}.lib", node_version));

      if let Err(_) = metadata(&node_lib_file_dir) {
        let node_lib = download_node_lib(&node_version);
        write(&node_lib_file_dir, &node_lib).expect(&format!("Could not save file to {}", node_lib_file_dir.to_str().unwrap()));
      }
      println!(
        "cargo:rustc-link-lib={}",
        &node_lib_file_dir.file_stem().unwrap().to_str().unwrap()
      );
      println!("cargo:rustc-link-search=native={}", link_search_dir.to_str().unwrap());
      // Link `win_delay_load_hook.obj` for windows electron
      println!("cargo:rustc-cdylib-link-arg=delayimp.lib");
      println!("cargo:rustc-cdylib-link-arg=/DELAYLOAD:node.exe");
      setup_napi_feature();
    }
  } else if #[cfg(target_os = "macos")] {
    /// Set up the build environment by setting Cargo configuration variables.
    pub fn setup() {
      println!("cargo:rustc-cdylib-link-arg=-Wl");
      println!("cargo:rustc-cdylib-link-arg=-undefined");
      println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
      setup_napi_feature();
    }
  } else {
    pub fn setup() {
      setup_napi_feature();
    }
  }
}

fn setup_napi_feature() {
  let napi_version = String::from_utf8(
    Command::new("node")
      .args(&["-e", "console.log(process.versions.napi)"])
      .output()
      .unwrap()
      .stdout,
  )
  .expect("Get NAPI version failed");

  let napi_version_number = napi_version.trim().parse::<u32>().unwrap();

  if napi_version_number < 2 {
    panic!("current napi version is too low");
  }

  if napi_version_number == 2 {
    println!("cargo:rustc-cfg=napi{}", napi_version_number);
  } else {
    for version in 2..(napi_version_number + 1) {
      println!("cargo:rustc-cfg=napi{}", version);
    }
  }
}
