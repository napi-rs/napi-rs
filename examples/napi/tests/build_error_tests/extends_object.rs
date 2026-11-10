use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(object, extends = Parent)]
pub struct Child {
  pub value: i32,
}

fn main() {}
