use napi::{bindgen_prelude::*, JsString, JsStringLatin1, JsStringUtf16};

#[napi(object)]
pub struct Latin1MethodsResult {
  pub length: u32,
  pub is_empty: bool,
  pub as_slice: Vec<u8>,
}

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

#[napi]
pub fn create_external_latin1_empty<'env>(env: &'env Env) -> Result<JsString<'env>> {
  // Test with empty string - from_external and from_data don't support empty strings
  // So we return a regular empty JsString instead
  env.create_string("")
}

#[napi]
pub fn create_external_latin1_short<'env>(env: &'env Env) -> Result<JsStringLatin1<'env>> {
  // Test with short string (likely to be copied by V8)
  let data = b"Hi".to_vec();
  let data_ptr = data.as_ptr();
  let len = data.len();
  std::mem::forget(data);

  unsafe {
    JsStringLatin1::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr as *mut u8, len, len));
    })
  }
}

#[napi]
pub fn create_external_latin1_long<'env>(env: &'env Env) -> Result<JsStringLatin1<'env>> {
  // Test with long string (more likely to remain external)
  let data = b"This is a much longer string that is more likely to be kept as an external string by V8 rather than being copied".to_vec();
  let data_ptr = data.as_ptr();
  let len = data.len();
  std::mem::forget(data);

  unsafe {
    JsStringLatin1::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr as *mut u8, len, len));
    })
  }
}

#[napi]
pub fn create_external_latin1_with_latin1_chars<'env>(
  env: &'env Env,
) -> Result<JsStringLatin1<'env>> {
  // Test with actual Latin-1 extended characters (bytes > 127)
  let data = vec![
    0x48, 0x65, 0x6C, 0x6C, 0x6F, // "Hello"
    0x20, // space
    0xC0, 0xC1, 0xC2, // À, Á, Â
    0x20, // space
    0xF1, 0xF2, 0xF3, // ñ, ò, ó
  ];
  let data_ptr = data.as_ptr();
  let len = data.len();
  std::mem::forget(data);

  unsafe {
    JsStringLatin1::from_external(env, data_ptr, len, data_ptr, move |_, ptr| {
      std::mem::drop(Vec::from_raw_parts(ptr as *mut u8, len, len));
    })
  }
}

#[napi]
pub fn create_external_latin1_custom_finalize<'env>(
  env: &'env Env,
) -> Result<JsStringLatin1<'env>> {
  // Test with custom finalize hint
  let data = b"Custom finalize test".to_vec();
  let data_ptr = data.as_ptr();
  let len = data.len();

  // Create a custom hint that includes the original length
  let hint = (data_ptr, len);
  std::mem::forget(data);

  unsafe {
    JsStringLatin1::from_external(env, data_ptr, len, hint, move |_, (ptr, size)| {
      // Custom cleanup that uses both pointer and size from hint
      std::mem::drop(Vec::from_raw_parts(ptr as *mut u8, size, size));
    })
  }
}

#[napi]
pub fn test_latin1_methods(env: &Env, input: String) -> Result<Latin1MethodsResult> {
  let data = input.as_bytes().to_vec();
  let latin1 = JsStringLatin1::from_data(env, data)?;

  Ok(Latin1MethodsResult {
    length: latin1.len() as u32,
    is_empty: latin1.is_empty(),
    as_slice: latin1.as_slice().to_vec(),
  })
}

#[napi]
pub fn create_static_latin1_string<'env>(env: &'env Env) -> Result<JsStringLatin1<'env>> {
  // Test from_static with a static Latin-1 string
  JsStringLatin1::from_static(env, "Static Latin1 string")
}

#[napi]
pub fn create_static_utf16_string<'env>(env: &'env Env) -> Result<JsStringUtf16<'env>> {
  // Test from_static with a static UTF-16 buffer
  static UTF16_DATA: &[u16] = &[
    0x0053, 0x0074, 0x0061, 0x0074, 0x0069, 0x0063, 0x0020, 0x0055, 0x0054, 0x0046, 0x0031, 0x0036,
  ]; // "Static UTF16"
  JsStringUtf16::from_static(env, UTF16_DATA)
}
