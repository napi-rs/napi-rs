use napi::bindgen_prelude::*;

#[napi]
pub fn create_external(size: u32) -> External<u32> {
  External::new(size)
}

#[napi]
pub fn create_external_string(content: String) -> External<String> {
  External::new(content)
}

#[napi]
pub fn get_external(external: External<u32>) -> u32 {
  *external
}

#[napi]
pub fn mutate_external(mut external: External<u32>, new_val: u32) {
  *external = new_val;
}
