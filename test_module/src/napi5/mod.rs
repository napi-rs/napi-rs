use napi::{Module, Result};

mod date;

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("testObjectIsDate", date::test_object_is_date)?;
  Ok(())
}
