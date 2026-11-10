use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(extends = Parent)]
#[repr(C)]
pub struct Child {
  other: i32,
  parent: Parent,
}

fn main() {}
