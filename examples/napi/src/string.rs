use napi::bindgen_prelude::*;

#[napi]
fn contains(source: String, target: String) -> bool {
  source.contains(&target)
}

#[napi]
fn concat_str(mut s: String) -> String {
  s.push_str(" + Rust 🦀 string!");
  s
}

#[napi]
fn concat_utf16(s: Utf16String) -> Utf16String {
  Utf16String::from(format!("{} + Rust 🦀 string!", s))
}

#[napi]
fn concat_latin1(s: Latin1String) -> String {
  format!("{} + Rust 🦀 string!", s)
}

#[napi]
pub fn roundtrip_str(s: String) -> String {
  s
}
