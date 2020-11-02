fn main() {
  // Just use `napi_build::setup();` in an actual project; `setup_napi_feature()` is just for testing purposes. 
  setup_napi_feature();
  napi_build::setup();
}

// Extracted and modified from the old napi build script.
// This looks at the currently installed node version and determines the correct napi features to set.
// In an actual project, manually set the napi fetaure you are targeting and just use `napi_build::setup();`.
// This is mostly only to simplify testing on ci.
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
    println!("cargo:rustc-cfg=feature=napi{}", napi_version_number);
  } else {
    for version in 2..(napi_version_number + 1) {
      println!("cargo:rustc-cfg=feature=napi{}", version);
    }
  }
}
