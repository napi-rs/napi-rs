use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(constructor, extends = Parent)]
#[repr(C)]
pub struct Child {
  pub parent: Parent,
}

fn main() {}
