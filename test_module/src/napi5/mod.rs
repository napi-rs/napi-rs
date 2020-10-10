use napi::{Module, Result};

mod date;

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("testObjectIsDate", date::test_object_is_date)?;
  module.create_named_method("testCreateDate", date::test_create_date)?;
  module.create_named_method("testGetDateValue", date::test_get_date_value)?;
  Ok(())
}
