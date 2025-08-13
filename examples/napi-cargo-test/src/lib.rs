use napi_derive::napi;

#[napi]
pub fn plus(a: i32, b: i32) -> napi::Result<i32> {
  Ok(a + b)
}

#[napi]
#[derive(Debug, PartialEq, Eq)]
pub enum MyEnum {
  A,
  B,
}

#[napi(object)]
#[derive(Debug, PartialEq, Eq)]
pub struct MyObject {
  pub a: i32,
  pub b: i32,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_plus() {
    let result = plus(1, 2).unwrap();
    assert_eq!(result, 3i32);
  }

  #[test]
  fn test_enum() {
    let result = MyEnum::A;
    assert_eq!(result, MyEnum::A);
  }

  #[test]
  fn test_struct() {
    let result = MyObject { a: 1, b: 2 };
    assert_eq!(result, MyObject { a: 1, b: 2 });
  }
}
