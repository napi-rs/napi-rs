use napi::bindgen_prelude::*;

#[napi]
fn get_buffer() -> Buffer {
  String::from("Hello world").as_bytes().into()
}

#[napi]
fn convert_u32_array(input: Uint32Array) -> Vec<u32> {
  input.to_vec()
}

#[napi]
fn create_external_typed_array() -> Uint32Array {
  Uint32Array::new(vec![1, 2, 3, 4, 5])
}

#[napi]
fn mutate_typed_array(mut input: Float32Array) {
  for item in input.as_mut() {
    *item *= 2.0;
  }
}
