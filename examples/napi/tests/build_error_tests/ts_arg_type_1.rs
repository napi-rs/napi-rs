//! This is testing that `#[napi(ts_args_type="...")]` and `#[napi(ts_arg_type="...")]`
//! are mutually exclusive

use napi_derive::napi;

#[napi(ts_args_type = "u: number, fn: object")]
pub fn add(u: u32, #[napi(ts_arg_type = "object")] f: Option<String>) {
  println!("Hello, world! {f:?}-{u}");
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
