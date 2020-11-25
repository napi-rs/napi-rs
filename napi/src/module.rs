use crate::{Callback, Env, JsObject, Result};

pub struct Module {
  pub env: Env,
  pub exports: JsObject,
}

#[deprecated(since = "1.0.0", note = "[module_exports] macro instead")]
impl Module {
  pub fn create_named_method(&mut self, name: &str, function: Callback) -> Result<()> {
    self
      .exports
      .set_named_property(name, self.env.create_function(name, function)?)?;

    Ok(())
  }
}
