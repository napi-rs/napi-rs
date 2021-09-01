#[macro_use]
extern crate napi_macro;

use napi::bindgen_prelude::*;

#[napi]
pub fn test_callback<T>(resolve: T)
where
  T: Fn(String, i32) -> Result<()>,
{
  resolve("String".to_owned(), 1).unwrap();
}
