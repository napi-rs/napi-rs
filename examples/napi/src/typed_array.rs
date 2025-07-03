use std::sync::Arc;

use napi::bindgen_prelude::*;

#[napi]
fn get_buffer() -> Buffer {
  String::from("Hello world").as_bytes().into()
}

#[napi]
fn get_buffer_slice(env: &Env) -> Result<BufferSlice<'_>> {
  BufferSlice::from_data(env, String::from("Hello world").as_bytes().to_vec())
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
pub fn create_external_buffer_slice(env: &Env) -> Result<BufferSlice<'_>> {
  let mut data = String::from("Hello world").as_bytes().to_vec();
  let data_ptr = data.as_mut_ptr();
  let len = data.len();
  // Mock the ffi data that not managed by Rust
  std::mem::forget(data);
  unsafe {
    BufferSlice::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr, len, len));
    })
  }
}

#[napi]
pub fn create_buffer_slice_from_copied_data(env: &Env) -> Result<BufferSlice<'_>> {
  BufferSlice::copy_from(env, String::from("Hello world").as_bytes())
}

#[napi]
fn get_empty_typed_array() -> Uint8Array {
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
  for item in unsafe { input.as_mut() } {
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
fn buffer_with_async_block(env: &Env, buf: Arc<Buffer>) -> Result<AsyncBlock<u32>> {
  let buf_to_dispose = buf.clone();
  AsyncBlockBuilder::with(async move { Ok(buf.len() as u32) })
    .with_dispose(move |_| {
      drop(buf_to_dispose);
      Ok(())
    })
    .build(env)
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
fn accept_arraybuffer(fixture: ArrayBuffer) -> Result<usize> {
  Ok(fixture.len())
}

#[napi]
fn create_arraybuffer(env: &Env) -> Result<ArrayBuffer<'_>> {
  let buf = ArrayBuffer::from_data(env, vec![1, 2, 3, 4])?;
  Ok(buf)
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

#[napi]
fn accept_uint8_clamped_slice(input: Uint8ClampedSlice) -> usize {
  input.len()
}

#[napi]
fn accept_uint8_clamped_slice_and_buffer_slice(a: BufferSlice, b: Uint8ClampedSlice) -> usize {
  a.len() + b.len()
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
fn async_buffer_to_array(buf: ArrayBuffer) -> Result<Vec<u8>> {
  Ok(buf.to_vec())
}

#[napi]
async fn u_init8_array_from_string() -> Uint8Array {
  Uint8Array::from_string("Hello world".to_owned())
}

struct AsyncReader {}

struct OutputBuffer {}

impl OutputBuffer {
  fn into_buffer_slice(self, env: &Env) -> Result<BufferSlice<'_>> {
    BufferSlice::from_data(env, String::from("Hello world"))
  }
}

#[napi]
impl Task for AsyncReader {
  type Output = OutputBuffer;
  type JsValue = Buffer;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(OutputBuffer {})
  }

  fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
    output
      .into_buffer_slice(&env)
      .and_then(|slice| slice.into_buffer(&env))
  }
}

#[napi(constructor)]
pub struct Reader {}

#[napi]
impl Reader {
  #[napi]
  pub fn read<'env>(&'env self, env: &'env Env) -> Result<BufferSlice<'env>> {
    let output = AsyncReader {}.compute()?;
    output.into_buffer_slice(env)
  }
}

#[napi]
pub fn create_uint8_clamped_array_from_data(env: &Env) -> Result<Uint8ClampedSlice<'_>> {
  Uint8ClampedSlice::from_data(env, b"Hello world")
}

#[napi]
pub fn create_uint8_clamped_array_from_external(env: &Env) -> Result<Uint8ClampedSlice<'_>> {
  let mut data = b"Hello world".to_vec();
  let data_ptr = data.as_mut_ptr();
  let len = data.len();
  std::mem::forget(data);
  unsafe {
    Uint8ClampedSlice::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr, len, len));
    })
  }
}

#[napi]
pub fn array_buffer_from_data(env: &Env) -> Result<ArrayBuffer<'_>> {
  ArrayBuffer::from_data(env, b"Hello world")
}

#[napi]
pub fn uint8_array_from_data(env: &Env) -> Result<Uint8ArraySlice<'_>> {
  Uint8ArraySlice::from_data(env, b"Hello world")
}

#[napi]
pub fn uint8_array_from_external(env: &Env) -> Result<Uint8ArraySlice<'_>> {
  let mut data = b"Hello world".to_vec();
  let data_ptr = data.as_mut_ptr();
  let len = data.len();
  std::mem::forget(data);
  unsafe {
    Uint8ArraySlice::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr, len, len));
    })
  }
}

#[napi]
pub fn accept_untyped_typed_array(input: TypedArray) -> usize {
  input.arraybuffer.len()
}
