use napi::bindgen_prelude::*;

#[napi]
fn date_to_number(input: Date) -> Result<f64> {
  input.value_of()
}
