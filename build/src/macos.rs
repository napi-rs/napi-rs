use crate::*;

pub fn setup() {
  println!("cargo:rustc-cdylib-link-arg=-Wl");
  println!("cargo:rustc-cdylib-link-arg=-undefined");
  println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
  setup_napi_feature();
}
