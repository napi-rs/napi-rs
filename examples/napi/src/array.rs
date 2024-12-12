use napi::{Env, JsObject};

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
fn to_js_obj(env: Env) -> napi::Result<JsObject> {
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
