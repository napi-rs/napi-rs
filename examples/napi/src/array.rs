use std::sync::atomic::{AtomicUsize, Ordering};

use napi::{
  bindgen_prelude::{Array, ArrayBuffer, ClassInstance, Object},
  Env,
};

static DETACHABLE_EXTERNAL_ARRAYBUFFER_FINALIZE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[napi]
pub fn get_words() -> Vec<&'static str> {
  vec!["foo", "bar"]
}

#[napi]
/// Gets some numbers
fn get_nums() -> Vec<u32> {
  vec![1, 1, 2, 3, 5, 8]
}

#[napi]
fn sum_nums(nums: Vec<u32>) -> u32 {
  nums.iter().sum()
}

#[napi]
fn get_tuple(val: (u32, String, u8)) -> u32 {
  val.0 + Into::<u32>::into(val.2)
}

#[napi]
fn to_js_obj(env: &Env) -> napi::Result<Object<'_>> {
  let mut arr = env.create_array(0)?;
  arr.insert("a string")?;
  arr.insert(42)?;
  arr.coerce_to_object()
}

#[napi]
fn get_num_arr() -> [u32; 2] {
  [1, 2]
}

#[napi]
fn get_nested_num_arr() -> [[[u32; 1]; 1]; 2] {
  [[[1]], [[1]]]
}

#[napi(object)]
pub struct Meta {
  pub merge: bool,
}

#[napi(array)]
pub struct TupleToArray(pub String, pub u32, pub Option<Meta>);

#[napi]
fn merge_tuple_array(t1: TupleToArray, t2: TupleToArray) -> TupleToArray {
  let merge = t2.2.as_ref().is_some_and(|m| m.merge);
  if merge {
    let first = t1.0 + &t2.0;
    let second = t1.1 + t2.1;
    return TupleToArray(first, second, t2.2);
  }
  t1
}

#[napi]
pub struct ClassInArray {
  value: u32,
}

#[napi]
impl ClassInArray {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self { value }
  }
}

#[napi]
pub fn get_class_from_array(arr: Array<'_>) -> napi::Result<Option<u32>> {
  let Some(instance) = arr.get::<ClassInstance<ClassInArray>>(0)? else {
    return Ok(None);
  };
  instance.with(|class| class.value).map(Some)
}

#[napi]
pub fn create_detachable_external_arraybuffer(env: &Env) -> napi::Result<ArrayBuffer<'_>> {
  let mut data = vec![1, 2, 3, 4];
  let data_ptr = data.as_mut_ptr();
  let data_len = data.len();
  unsafe {
    ArrayBuffer::from_external(env, data_ptr, data_len, data, |_, data| {
      drop(data);
      DETACHABLE_EXTERNAL_ARRAYBUFFER_FINALIZE_COUNT.fetch_add(1, Ordering::SeqCst);
    })
  }
}

#[napi]
pub fn detach_arraybuffer_with_alias(
  buffer: ArrayBuffer<'_>,
  alias: ArrayBuffer<'_>,
) -> napi::Result<()> {
  if buffer.len() != alias.len() || !std::ptr::eq(buffer.as_ptr(), alias.as_ptr()) {
    return Err(napi::Error::from_reason(
      "expected ArrayBuffer arguments backed by the same allocation",
    ));
  }

  // `alias` is intentionally last accessed before detachment. See ArrayBuffer::detach.
  unsafe { buffer.detach() }
}

#[napi]
pub fn detachable_external_arraybuffer_finalize_count() -> u32 {
  DETACHABLE_EXTERNAL_ARRAYBUFFER_FINALIZE_COUNT.load(Ordering::SeqCst) as u32
}
