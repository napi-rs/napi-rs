use napi_derive::napi;

#[napi]
pub struct LifetimeReferenceField<'a> {
  pub value: &'a str,
}

fn main() {}
