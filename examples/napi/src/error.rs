use napi::bindgen_prelude::*;

#[napi]
pub fn throw_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Manual Error".to_owned()))
}

#[napi(catch_unwind)]
pub fn panic() {
  panic!("Don't panic");
}
