use napi_derive::napi;

#[napi(object)]
pub struct Shared {
  pub value: u32,
}
