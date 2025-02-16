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
