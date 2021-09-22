use napi::bindgen_prelude::*;

#[napi]
fn map_option(val: Option<u32>) -> Option<u32> {
  val.map(|v| v + 1)
}
