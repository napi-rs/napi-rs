//! This is testing that `#[napi(ts_arg_type="...")]` fails if the argument for `ts_arg_type`
//! is not a string literal.

use napi_derive::napi;

#[napi]
pub fn add(u: u32, #[napi(ts_arg_type = 32)] f: Option<String>) {
  println!("Hello, world! {f:?}-{u}");
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
