use crate::{sys, Result};

use super::{Array, Object};

pub struct Env {
  inner: sys::napi_env,
}

impl From<sys::napi_env> for Env {
  fn from(raw_env: sys::napi_env) -> Env {
    Env { inner: raw_env }
  }
}

impl Env {
  pub fn create_object(&self) -> Result<Object> {
    Object::new(self.inner)
  }

  pub fn create_array(&self, len: u32) -> Result<Array> {
    Array::new(self.inner, len)
  }
}
