mod android;
mod macos;

pub fn setup() {
  println!("cargo:rerun-if-env-changed=DEBUG_GENERATED_CODE");
  match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
    Ok("macos") => {
      macos::setup();
    }
    Ok("android") => if android::setup().is_ok() {},
    _ => {}
  }
}
