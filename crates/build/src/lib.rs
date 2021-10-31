mod macos;
mod windows;

pub fn setup() {
  println!("cargo:rerun-if-changed=TYPE_DEF_TMP_PATH");
  println!("cargo:rerun-if-changed=DEBUG_GENERATED_CODE");
  match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
    Ok("macos") => macos::setup(),
    Ok("windows") => windows::setup(),
    _ => {}
  }
}
