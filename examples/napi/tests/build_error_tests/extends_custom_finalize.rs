use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(custom_finalize)]
pub struct Parent {
  pub value: i32,
}

impl ObjectFinalize for Parent {
  fn finalize(self, _env: Env) -> Result<()> {
    Ok(())
  }
}

#[napi(extends = Parent)]
#[repr(C)]
pub struct Child {
  parent: Parent,
}

fn main() {}
