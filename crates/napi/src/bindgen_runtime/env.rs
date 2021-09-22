use crate::{sys, Result};

use super::{Array, Object};

#[repr(transparent)]
pub struct Env(sys::napi_env);

impl From<sys::napi_env> for Env {
  fn from(raw_env: sys::napi_env) -> Env {
    Env(raw_env)
  }
}

impl Env {
  pub fn create_object(&self) -> Result<Object> {
    Object::new(self.0)
  }

  pub fn create_array(&self, len: u32) -> Result<Array> {
    Array::new(self.0, len)
  }
}
