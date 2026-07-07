use std::cell::RefCell;
#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use std::sync::atomic::{AtomicUsize, Ordering};
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
pub fn sum_buffer_slice_from_data(env: &Env) -> Result<u32> {
  Ok(
    BufferSlice::from_data(env, vec![1, 2, 3, 4])?
      .iter()
      .map(|value| u32::from(*value))
      .sum(),
  )
}

#[napi]
pub fn sum_buffer_slice_from_external(env: &Env) -> Result<u32> {
  let mut data = vec![1u8, 2, 3, 4];
  let data_ptr = data.as_mut_ptr();
  let len = data.len();
  std::mem::forget(data);
  let value = unsafe {
    BufferSlice::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      drop(Vec::from_raw_parts(ptr, len, len));
    })?
  };
  Ok(value.iter().map(|value| u32::from(*value)).sum())
}

#[napi]
pub fn sum_buffer_slice_from_copy(env: &Env) -> Result<u32> {
  Ok(
    BufferSlice::copy_from(env, [1, 2, 3, 4])?
      .iter()
      .map(|value| u32::from(*value))
      .sum(),
  )
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
fn mutate_uint16_array_for_sync(env: &Env, mut input: Uint16Array) {
  for item in unsafe { input.as_mut() } {
    *item = item.wrapping_add(1);
  }
  #[cfg(target_family = "wasm")]
  input.sync(env);
  #[cfg(not(target_family = "wasm"))]
  let _ = env;
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

// Repro for napi-rs#3357: unlike `*_pass_through`, these CONSUME the buffer, so the
// `Buffer`/`Uint8Array` is dropped inside the future on a tokio worker thread (a non-JS
// thread). When the owning isolate differs from the single global CUSTOM_GC_TSFN owner,
// the cross-thread drop is routed to the wrong isolate => cross-isolate napi_reference_unref.
#[napi]
async fn buffer_len_async(buf: Buffer) -> Result<u32> {
  Ok(buf.len() as u32)
}

#[napi]
async fn array_buffer_len_async(buf: Uint8Array) -> Result<u32> {
  Ok(buf.len() as u32)
}

// Same-thread post-teardown Drop coverage for napi-rs#3357 (must_fix #1): a JS-origin Buffer
// stashed in a Rust thread_local on the OWNER JS thread drops at worker thread-exit, AFTER the
// env teardown that sets the per-handle `aborted` flag. The fixed Drop must no-op (not UAF).
thread_local! {
  static STASHED_BUFFERS: RefCell<Vec<Buffer>> = const { RefCell::new(Vec::new()) };
}

#[napi]
fn stash_buffer_in_thread_local(buf: Buffer) {
  STASHED_BUFFERS.with(|c| c.borrow_mut().push(buf));
}

thread_local! {
  static STASHED_TYPED_ARRAYS: RefCell<Vec<Uint8Array>> = const { RefCell::new(Vec::new()) };
}

#[napi]
fn stash_typed_array_in_thread_local(buf: Uint8Array) {
  STASHED_TYPED_ARRAYS.with(|c| c.borrow_mut().push(buf));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
thread_local! {
  static LIFECYCLE_STASHED_BUFFER: RefCell<Option<Buffer>> = const { RefCell::new(None) };
  static LIFECYCLE_STASHED_TYPED_ARRAY: RefCell<Option<Uint8Array>> = const { RefCell::new(None) };
  static LIFECYCLE_STASHED_TYPED_ARRAY_SLICE: RefCell<Option<Uint8ArraySlice<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_CLAMPED_SLICE: RefCell<Option<Uint8ClampedSlice<'static>>> =
    const { RefCell::new(None) };
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
static MUTABLE_TYPED_ARRAY_FINALIZE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashBufferAcrossDuplicateLoad")]
fn stash_lifecycle_buffer(value: Buffer) {
  LIFECYCLE_STASHED_BUFFER.with(|stored| *stored.borrow_mut() = Some(value));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeBufferAcrossDuplicateLoad")]
fn take_lifecycle_buffer() -> Result<Buffer> {
  LIFECYCLE_STASHED_BUFFER
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no lifecycle Buffer was stashed"))
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashTypedArrayAcrossDuplicateLoad")]
fn stash_lifecycle_typed_array(value: Uint8Array) {
  LIFECYCLE_STASHED_TYPED_ARRAY.with(|stored| *stored.borrow_mut() = Some(value));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeTypedArrayAcrossDuplicateLoad")]
fn take_lifecycle_typed_array() -> Result<Uint8Array> {
  LIFECYCLE_STASHED_TYPED_ARRAY
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no lifecycle TypedArray was stashed"))
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
fn lifecycle_typed_array_slice() -> Result<Uint8ArraySlice<'static>> {
  LIFECYCLE_STASHED_TYPED_ARRAY_SLICE
    .with(|stored| *stored.borrow())
    .ok_or_else(|| Error::from_reason("no lifecycle TypedArray slice was stashed"))
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
fn lifecycle_clamped_slice() -> Result<Uint8ClampedSlice<'static>> {
  LIFECYCLE_STASHED_CLAMPED_SLICE
    .with(|stored| *stored.borrow())
    .ok_or_else(|| Error::from_reason("no lifecycle clamped TypedArray slice was stashed"))
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashTypedArraySlicesAcrossDuplicateLoad")]
fn stash_lifecycle_typed_array_slices(
  typed_array: Uint8ArraySlice<'static>,
  clamped: Uint8ClampedSlice<'static>,
) {
  LIFECYCLE_STASHED_TYPED_ARRAY_SLICE.with(|stored| *stored.borrow_mut() = Some(typed_array));
  LIFECYCLE_STASHED_CLAMPED_SLICE.with(|stored| *stored.borrow_mut() = Some(clamped));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "verifyTypedArraySlicesSameEnv")]
#[allow(clippy::needless_borrows_for_generic_args)]
fn verify_lifecycle_typed_array_slices_same_env(
  env: Env,
  mut typed_array: Uint8ArraySlice,
  clamped: Uint8ClampedSlice,
  this: This,
) -> Result<()> {
  unsafe {
    <&Uint8ArraySlice<'_>>::to_napi_value(env.raw(), &typed_array)?;
    <&mut Uint8ArraySlice<'_>>::to_napi_value(env.raw(), &mut typed_array)?;
  }
  typed_array.assign_to_this(this, "typedArraySlice")?;
  typed_array.into_typed_array(&env)?;
  clamped.assign_to_this(this, "clampedTypedArraySlice")?;
  clamped.into_typed_array(&env)?;
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "returnTypedArraySliceRefAcrossDuplicateLoad")]
#[allow(clippy::needless_borrows_for_generic_args)]
fn return_lifecycle_typed_array_slice_ref(env: Env) -> Result<Unknown<'static>> {
  let value = lifecycle_typed_array_slice()?;
  let raw = unsafe { <&Uint8ArraySlice<'_>>::to_napi_value(env.raw(), &value)? };
  Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), raw) })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "returnTypedArraySliceMutAcrossDuplicateLoad")]
#[allow(clippy::needless_borrows_for_generic_args)]
fn return_lifecycle_typed_array_slice_mut(env: Env) -> Result<Unknown<'static>> {
  let mut value = lifecycle_typed_array_slice()?;
  let raw = unsafe { <&mut Uint8ArraySlice<'_>>::to_napi_value(env.raw(), &mut value)? };
  Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), raw) })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "assignTypedArraySliceAcrossDuplicateLoad")]
fn assign_lifecycle_typed_array_slice_to_this(this: This) -> Result<()> {
  lifecycle_typed_array_slice()?.assign_to_this(this, "typedArraySlice")?;
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "convertTypedArraySliceAcrossDuplicateLoad")]
fn convert_lifecycle_typed_array_slice(env: &Env) -> Result<Uint8Array> {
  lifecycle_typed_array_slice()?.into_typed_array(env)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "assignClampedSliceAcrossDuplicateLoad")]
fn assign_lifecycle_clamped_slice_to_this(this: This) -> Result<()> {
  lifecycle_clamped_slice()?.assign_to_this(this, "clampedTypedArraySlice")?;
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "convertClampedSliceAcrossDuplicateLoad")]
fn convert_lifecycle_clamped_slice(env: &Env) -> Result<Uint8ClampedSlice<'static>> {
  lifecycle_clamped_slice()?.into_typed_array(env)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "createMutableTypedArrayForOwnershipTest")]
fn create_mutable_typed_array_for_ownership_test(
  env: &Env,
  empty: Option<bool>,
) -> Result<Unknown<'_>> {
  let mut data = if empty.unwrap_or(false) {
    Vec::new()
  } else {
    vec![1u8, 2, 3, 4]
  };
  let data_ptr = data.as_mut_ptr();
  let length = data.len();
  let capacity = data.capacity();
  std::mem::forget(data);

  let mut typed_array = unsafe {
    Uint8Array::with_external_data(data_ptr, length, move |data, finalized_length| {
      debug_assert_eq!(finalized_length, length);
      drop(Vec::from_raw_parts(data, finalized_length, capacity));
      MUTABLE_TYPED_ARRAY_FINALIZE_COUNT.fetch_add(1, Ordering::SeqCst);
    })
  };
  let raw_value = unsafe { ToNapiValue::to_napi_value(env.raw(), &mut typed_array)? };
  Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), raw_value) })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi]
fn mutable_typed_array_finalize_count() -> u32 {
  MUTABLE_TYPED_ARRAY_FINALIZE_COUNT.load(Ordering::SeqCst) as u32
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
pub fn array_buffer_from_external(env: &Env) -> Result<ArrayBuffer<'_>> {
  let mut data = b"Hello world from external".to_vec();
  let data_ptr = data.as_mut_ptr();
  let len = data.len();
  std::mem::forget(data);
  unsafe {
    ArrayBuffer::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr, len, len));
    })
  }
}

#[napi]
pub fn array_buffer_copy_from(env: &Env) -> Result<ArrayBuffer<'_>> {
  ArrayBuffer::copy_from(env, [1, 2, 3, 4])
}

#[napi]
pub fn uint16_array_copy_from(env: &Env) -> Result<Uint16ArraySlice<'_>> {
  Uint16ArraySlice::copy_from(env, [0x1234, 0x5678, 0x9abc])
}

#[napi]
pub fn uint8_clamped_array_copy_from(env: &Env) -> Result<Uint8ClampedSlice<'_>> {
  Uint8ClampedSlice::copy_from(env, [0, 127, 255])
}

#[napi]
pub fn create_empty_typed_array_slices(
  env: &Env,
) -> Result<(Uint16ArraySlice<'_>, Uint8ClampedSlice<'_>)> {
  Ok((
    Uint16ArraySlice::from_data(env, Vec::new())?,
    Uint8ClampedSlice::from_data(env, Vec::new())?,
  ))
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
pub fn create_i32_array_from_external(env: &Env) -> Result<Int32ArraySlice<'_>> {
  let mut data = vec![-1, -2, 30000, -40, 5];
  unsafe {
    Int32ArraySlice::from_external(env, data.as_mut_ptr(), data.len(), data, |_, d| {
      drop(d);
    })
  }
}

#[napi]
pub fn accept_untyped_typed_array(input: TypedArray) -> usize {
  input.arraybuffer.len()
}

#[napi]
pub fn untyped_typed_array_backing_bytes(input: TypedArray) -> Vec<u8> {
  input.arraybuffer.to_vec()
}

#[napi]
pub fn mutate_arraybuffer(mut buf: ArrayBuffer) {
  for item in unsafe { buf.as_mut() } {
    *item *= 2;
  }
}
