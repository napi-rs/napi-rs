use napi::{bindgen_prelude::*, JsStringLatin1, JsStringUtf16};

#[napi]
pub fn contains(source: String, target: String) -> bool {
  source.contains(&target)
}

#[napi]
pub fn concat_str(mut s: String) -> String {
  s.push_str(" + Rust 🦀 string!");
  s
}

#[napi]
pub fn concat_utf16(s: Utf16String) -> Utf16String {
  Utf16String::from(format!("{} + Rust 🦀 string!", s))
}

#[napi]
pub fn concat_latin1(s: Latin1String) -> String {
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

#[napi]
pub fn create_zero_copy_utf16_string<'env>(env: &'env Env) -> Result<JsStringUtf16<'env>> {
  let data = vec![0x0061, 0x0062, 0x0063];
  JsStringUtf16::from_data(env, data)
}

#[napi]
pub fn create_zero_copy_latin1_string<'env>(env: &'env Env) -> Result<JsStringLatin1<'env>> {
  let data = vec![0x48, 0x65, 0x6C, 0x6C, 0x6F]; // "Hello"
  JsStringLatin1::from_data(env, data)
}

#[napi]
pub fn create_external_utf16_string<'env>(env: &'env Env) -> Result<JsStringUtf16<'env>> {
  // Create UTF-16 data for "External UTF16"
  let data: Vec<u16> = "External UTF16".encode_utf16().collect();
  let data_ptr = data.as_ptr();
  let len = data.len();
  std::mem::forget(data);

  unsafe {
    JsStringUtf16::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr as *mut u16, len, len));
    })
  }
}

#[napi]
pub fn create_external_latin1_string<'env>(env: &'env Env) -> Result<JsStringLatin1<'env>> {
  // Create Latin1 data for "External Latin1"
  let data = b"External Latin1".to_vec();
  let data_ptr = data.as_ptr();
  let len = data.len();
  std::mem::forget(data);

  unsafe {
    JsStringLatin1::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr as *mut u8, len, len));
    })
  }
}
