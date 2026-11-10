use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(extends = Parent)]
pub struct Child {
  parent: Parent,
}

fn main() {}
