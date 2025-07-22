use std::path::{Path, PathBuf};

use napi::{Env, JsString, Result};

#[napi]
pub struct CreateStringClass {
  inner: PathBuf,
}

#[napi]
impl CreateStringClass {
  #[napi]
  pub fn new() -> Self {
    Self {
      inner: PathBuf::from(""),
    }
  }

  #[napi]
  pub fn create_string<'env>(&self, env: &'env Env) -> Option<JsString<'env>> {
    create_string(env, &self.inner).ok()
  }

  #[napi]
  pub fn create_string_result<'env>(&self, env: &'env Env) -> Result<JsString<'env>> {
    create_string(env, &self.inner)
  }
}

fn create_string<'env>(env: &'env Env, path: &Path) -> Result<JsString<'env>> {
  let path = path.to_string_lossy();
  env.create_string(path.as_ref())
}
