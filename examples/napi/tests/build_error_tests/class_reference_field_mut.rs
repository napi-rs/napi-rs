use napi_derive::napi;

#[napi]
pub struct MutableReferenceField {
  pub value: &mut String,
}

fn main() {}
