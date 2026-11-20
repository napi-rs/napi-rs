#[napi_derive::napi]
mod invalid_option {
  #[napi_derive::napi(unknown_option)]
  pub fn bad_option() -> u32 {
    1
  }
}

#[napi_derive::napi]
mod invalid_name_value {
  #[napi_derive::napi = "bad"]
  pub fn bad_name_value() -> u32 {
    1
  }
}

fn main() {}
