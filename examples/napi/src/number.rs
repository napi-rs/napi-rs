use napi::bindgen_prelude::*;

#[napi]
fn add(a: u32, b: u32) -> u32 {
  a + b
}

#[napi]
fn fibonacci(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci(n - 1) + fibonacci(n - 2),
  }
}
