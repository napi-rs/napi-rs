use napi::bindgen_prelude::*;

#[napi]
fn get_buffer() -> Buffer {
  String::from("Hello world").as_bytes().into()
}
