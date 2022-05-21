//! This is testing that `#[napi(ts_arg_type="...")]` fails if the attribute is something other than
//! `ts_arg_type`

use napi_derive::napi;

#[napi]
pub fn add(u: u32, #[napi(not_expected = "obj")] f: Option<String>) {
  println!("Hello, world! {f:?}-{u}");
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
