use napi::bindgen_prelude::*;

#[napi]
fn throw_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Manual Error".to_owned()))
}
