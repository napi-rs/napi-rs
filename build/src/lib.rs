cfg_if::cfg_if! {
  if #[cfg(windows)] {
    mod windows;
    pub use windows::setup;
  } else if #[cfg(target_os = "macos")] {
    mod macos;
    pub use macos::setup;
  } else {
    pub fn setup() { }
  }
}
