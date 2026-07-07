use napi_derive::napi;

#[napi]
pub struct SharedReferenceField {
  pub value: &String,
}

fn main() {}
