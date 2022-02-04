use napi::bindgen_prelude::*;

#[napi]
fn bigint_add(a: BigInt, b: BigInt) -> u128 {
  a.get_u128().1 + b.get_u128().1
}

#[napi]
fn create_big_int() -> BigInt {
  BigInt {
    words: vec![100u64, 200u64],
    sign_bit: true,
  }
}

#[napi]
fn create_big_int_i64() -> i64n {
  i64n(100)
}

#[napi]
pub fn bigint_get_u64_as_string(bi: BigInt) -> String {
  bi.get_u64().1.to_string()
}
