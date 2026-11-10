use napi_derive::napi;

#[napi]
pub struct Parent {
  pub value: i32,
}

#[napi(extends = Parent)]
#[repr(C)]
pub struct Child {
  parent: Parent,
}

#[napi]
impl Child {
  #[napi(constructor)]
  pub fn new() -> Self {
    Child {
      parent: Parent { value: 1 },
    }
  }
}

fn main() {}
