use napi_derive::napi;

#[napi(namespace = "")]
pub fn empty() {}

#[napi(namespace = "a..b")]
pub fn empty_segment() {}

#[napi(namespace = "a\0b")]
pub const NUL: u32 = 1;

#[napi(namespace = "a\u{2028}b")]
pub const LINE_SEPARATOR: u32 = 1;

#[napi(namespace = "x.__proto__")]
pub struct Proto {}

#[napi(namespace = "__proto__")]
pub enum SingleProto {
  A,
}

#[napi]
pub struct Valid {}

#[napi(namespace = "x.a-b")]
impl Valid {}

#[napi(namespace = "default.x")]
pub type ReservedRoot = u32;

#[napi(js_name = "m.")]
mod trailing_dot {
  #[napi]
  pub fn in_mod() {}
}

fn main() {}
