use napi::bindgen_prelude::*;

#[napi]
fn contains(source: String, target: String) -> bool {
  source.contains(&target)
}
