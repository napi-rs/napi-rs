cfg_if::cfg_if! {
    if #[cfg(windows)] {
      mod windows;
      pub use windows::setup;
    } else if #[cfg(target_os = "macos")] {
      mod macos;
      pub use macos::setup;
    } else {
      pub fn setup() {
        setup_napi_feature();
      }
    }
}

use std::process::Command;

pub fn setup_napi_feature() {
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
