mod macos;

cfg_if::cfg_if! {
  if #[cfg(not(target_env = "musl"))] {
    mod windows;
  }
}

pub fn setup() {
  match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
    Ok("macos") => macos::setup(),
    Ok("windows") => {
      cfg_if::cfg_if! {
        if #[cfg(not(target_env = "musl"))] {
          windows::setup()
        } else {
          eprintln!("Cross compiling to windows-msvc is not supported from *-musl hosts")
        }
      }
    }
    _ => {}
  }
}
