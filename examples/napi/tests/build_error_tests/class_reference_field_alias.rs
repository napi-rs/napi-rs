use napi_derive::napi;

type Borrowed<'a> = &'a str;

#[napi]
pub struct AliasedReferenceField<'a> {
  pub value: Borrowed<'a>,
}

fn main() {}
