use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(iterator, extends = Parent)]
#[repr(C)]
pub struct Child {
  parent: Parent,
}

fn main() {}
