use napi::bindgen_prelude::*;

#[napi]
fn get_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Manual Error".to_owned()))
}
