fn main() {
  let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
  let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap();
  if target_os == "windows" && target_env == "gnu" {
    napi_build::setup();
  }
}
