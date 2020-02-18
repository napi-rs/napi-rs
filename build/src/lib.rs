extern crate cfg_if;
#[cfg(windows)]
extern crate reqwest;

use cfg_if::cfg_if;

cfg_if! {
  if #[cfg(windows)] {
    use std::env::var;
    use std::fs::File;
    use std::io::copy;
    use std::path::PathBuf;
    use std::process::Command;

    pub fn setup() {
      let node_full_version =
        String::from_utf8(Command::new("node").arg("-v").output().unwrap().stdout).unwrap();
      let node_exec_path = String::from_utf8(
        Command::new("node")
          .arg("-e")
          .arg("console.log(process.execPath)")
          .output()
          .unwrap()
          .stdout,
      )
      .unwrap();
      let node_exec_path = node_exec_path.trim_end();
      let mut node_lib_file_dir = PathBuf::from(node_exec_path)
        .parent()
        .unwrap()
        .to_path_buf();
      let node_lib_dir = PathBuf::from(&node_lib_file_dir);
      node_lib_file_dir.push(format!("node-{}.lib", node_full_version.trim_end()));
      if !node_lib_file_dir.exists() {
        let lib_file_download_url = format!(
          "https://nodejs.org/dist/{}/win-x64/node.lib",
          node_full_version
        );
        let mut resp =
          reqwest::blocking::get(&lib_file_download_url).expect("Download node.lib file failed");
        let mut node_lib_file = File::create(&node_lib_file_dir).unwrap();
        copy(&mut resp, &mut node_lib_file).expect("Save node.lib file failed");
      }
      println!(
        "cargo:rustc-link-lib={}",
        &node_lib_file_dir.file_stem().unwrap().to_str().unwrap()
      );
      println!("cargo:rustc-link-search={}", node_lib_dir.to_str().unwrap());
      // Link `win_delay_load_hook.obj` for windows electron
      let node_runtime_env = "npm_config_runtime";
      println!("cargo:rerun-if-env-changed={}", node_runtime_env);
      if var(node_runtime_env).map(|s| s == "electron") == Ok(true) {
        println!("cargo:rustc-cdylib-link-arg=win_delay_load_hook.obj");
        println!("cargo:rustc-cdylib-link-arg=delayimp.lib");
        println!("cargo:rustc-cdylib-link-arg=/DELAYLOAD:node.exe");
      }
    }
  } else if #[cfg(target_os = "macos")] {
    /// Set up the build environment by setting Cargo configuration variables.
    pub fn setup() {
      println!("cargo:rustc-cdylib-link-arg=-undefined");
      println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
    }
  } else {
    pub fn setup() { }
  }
}
