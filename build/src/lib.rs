mod macos;
mod windows;

pub fn setup() {
  match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
    Ok("macos") => macos::setup(),
    Ok("windows") => windows::setup(),
    _ => {}
  }
}
