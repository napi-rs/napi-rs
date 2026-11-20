#[napi_derive::napi]
mod qualified_pass {
  #[napi_derive::napi]
  pub fn bare_qualified() -> u32 {
    1
  }

  #[::napi_derive::napi]
  pub const BARE_CONST: u32 = 2;

  #[napi_derive::napi(namespace = "explicit_other")]
  pub fn explicit_other() -> u32 {
    3
  }

  #[napi_derive::napi(namespace = "qualified_pass")]
  pub fn explicit_same() -> u32 {
    4
  }

  #[rustfmt::skip]
  #[napi_derive::napi { js_name = "braceDelim" }]
  pub fn brace_delim() -> u32 {
    5
  }

  #[rustfmt::skip]
  #[::napi_derive::napi[js_name = "bracketDelim"]]
  pub fn bracket_delim() -> u32 {
    6
  }
}

fn main() {}
