use std::env;

pub fn setup() {
  let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");
  println!("cargo:rustc-link-search={}", link_dir);
  println!("cargo:rustc-link-lib=static=emnapi-basic");
  println!("cargo:rustc-link-arg=--initial-memory=16777216");
  println!("cargo:rustc-link-arg=--export-dynamic");
  println!("cargo:rustc-link-arg=--export=malloc");
  println!("cargo:rustc-link-arg=--export=free");
  println!("cargo:rustc-link-arg=--export=napi_register_wasm_v1");
  println!("cargo:rustc-link-arg=--export-table");
  println!("cargo:rustc-link-arg=--import-undefined");
}
