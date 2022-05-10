mod macos;

pub fn setup() {
  println!("cargo:rerun-if-env-changed=DEBUG_GENERATED_CODE");
  if let Ok("macos") = std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
    macos::setup();
  }
}
