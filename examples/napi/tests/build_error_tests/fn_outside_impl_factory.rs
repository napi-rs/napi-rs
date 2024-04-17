//! This is testing that `#[napi(factory)]` outside of an `impl` block fails

use napi_derive::napi;

#[napi(factory)]
pub fn add() {
  println!("Hello, world!");
}

// Needed for the trybuild tests.
#[allow(unused)]
fn main() {}
