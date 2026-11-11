use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(extends = Parent)]
#[repr(C, packed(2))]
pub struct Child {
  parent: Parent,
}

fn main() {}
