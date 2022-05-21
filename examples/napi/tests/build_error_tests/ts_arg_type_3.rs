//! This is testing that `#[napi(ts_arg_type="...")]` fails if the attribute is not a `MetaNameValue`
//! i.e. it's a name value pair.

use napi_derive::napi;

#[napi]
pub fn add(u: u32, #[napi(ts_arg_type, not_expected)] f: Option<String>) {
  println!("Hello, world! {f:?}-{u}");
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
