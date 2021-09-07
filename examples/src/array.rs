use napi::bindgen_prelude::*;

#[napi]
fn get_words() -> Vec<&'static str> {
  vec!["foo", "bar"]
}

#[napi]
fn get_nums() -> Vec<u32> {
  vec![1, 1, 2, 3, 5, 8]
}
