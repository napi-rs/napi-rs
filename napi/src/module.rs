use crate::{Callback, Env, JsObject, Result};

pub struct Module<'env> {
  pub env: &'env Env,
  pub exports: JsObject<'env>,
}

impl<'env> Module<'env> {
  pub fn create_named_method(&mut self, name: &str, function: Callback) -> Result<()> {
    self
      .exports
      .set_named_property(name, self.env.create_function(name, function)?)?;

    Ok(())
  }
}
