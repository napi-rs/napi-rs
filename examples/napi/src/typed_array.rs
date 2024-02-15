use napi::{bindgen_prelude::*, JsArrayBuffer};

#[napi]
fn get_buffer() -> Buffer {
  String::from("Hello world").as_bytes().into()
}

#[napi]
fn append_buffer(buf: Buffer) -> Buffer {
  let mut buf = Vec::<u8>::from(buf);
  buf.push(b'!');
  buf.into()
}

#[napi]
fn get_empty_buffer() -> Buffer {
  vec![].into()
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

#[napi]
fn deref_uint8_array(a: Uint8Array, b: Uint8ClampedArray) -> u32 {
  (a.len() + b.len()) as u32
}

#[napi]
async fn buffer_pass_through(buf: Buffer) -> Result<Buffer> {
  Ok(buf)
}

#[napi]
async fn array_buffer_pass_through(buf: Uint8Array) -> Result<Uint8Array> {
  Ok(buf)
}

#[napi]
fn accept_slice(fixture: &[u8]) -> usize {
  fixture.len()
}

#[napi]
fn u8_array_to_array(input: &[u8]) -> Vec<u8> {
  input.to_vec()
}

#[napi]
fn i8_array_to_array(input: &[i8]) -> Vec<i8> {
  input.to_vec()
}

#[napi]
fn u16_array_to_array(input: &[u16]) -> Vec<u16> {
  input.to_vec()
}

#[napi]
fn i16_array_to_array(input: &[i16]) -> Vec<i16> {
  input.to_vec()
}

#[napi]
fn u32_array_to_array(input: &[u32]) -> Vec<u32> {
  input.to_vec()
}

#[napi]
fn i32_array_to_array(input: &[i32]) -> Vec<i32> {
  input.to_vec()
}

#[napi]
fn f32_array_to_array(input: &[f32]) -> Vec<f32> {
  input.to_vec()
}

#[napi]
fn f64_array_to_array(input: &[f64]) -> Vec<f64> {
  input.to_vec()
}

#[napi]
fn u64_array_to_array(input: &[u64]) -> Vec<u64> {
  input.to_vec()
}

#[napi]
fn i64_array_to_array(input: &[i64]) -> Vec<i64> {
  input.to_vec()
}

struct AsyncBuffer {
  buf: Buffer,
}

#[napi]
impl Task for AsyncBuffer {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(self.buf.iter().fold(0u32, |a, b| a + *b as u32))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
fn async_reduce_buffer(buf: Buffer) -> Result<AsyncTask<AsyncBuffer>> {
  Ok(AsyncTask::new(AsyncBuffer { buf }))
}

#[napi]
fn async_buffer_to_array(buf: JsArrayBuffer) -> Result<Vec<u8>> {
  Ok(buf.into_value()?.as_ref().to_vec())
}
