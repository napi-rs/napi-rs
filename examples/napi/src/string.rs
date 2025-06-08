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

#[napi]
pub fn return_c_string() -> RawCString {
  let mock_c_string = b"Hello from C string!\0";
  let mock_c_string_ptr = mock_c_string.as_ptr().cast();
  RawCString::new(mock_c_string_ptr, NAPI_AUTO_LENGTH)
}

#[napi]
/// Function to test escaped quotes in comments.
/// This comment contains escaped quotes: \\"g+sx\\" and should not break JSON parsing.
/// The pattern \\"value\\" is commonly used in regex and shell commands.
/// Another example: sed 's/old/\\"new\\"/g' where quotes are escaped.
pub fn test_escaped_quotes_in_comments(input: String) -> String {
  format!("Processed: {}", input)
}
