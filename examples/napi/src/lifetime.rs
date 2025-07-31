use std::path::{Path, PathBuf};

use napi::{bindgen_prelude::*, JsString, ScopedTask};

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

#[napi]
pub fn callback_in_spawn(env: &Env, callback: Function<Object, Unknown>) -> Result<()> {
  let callback_ref = callback.create_ref()?;
  env
    .spawn(AsyncTaskInSpawn {})?
    .promise_object()
    .then(move |ctx| {
      let cb = callback_ref.borrow_back(&ctx.env)?;
      cb.call(ctx.value)?;
      Ok(())
    })?;
  Ok(())
}

struct AsyncTaskInSpawn {}

impl<'env> ScopedTask<'env> for AsyncTaskInSpawn {
  type Output = ();
  type JsValue = Object<'env>;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(())
  }

  fn resolve(&mut self, env: &'env Env, _: Self::Output) -> Result<Self::JsValue> {
    let mut obj = Object::new(env)?;
    obj.set("foo", "bar")?;
    Ok(obj)
  }
}
