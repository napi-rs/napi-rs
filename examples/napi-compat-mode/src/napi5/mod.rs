use napi::{JsObject, Result};

mod date;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testObjectIsDate", date::test_object_is_date)?;
  exports.create_named_method("testCreateDate", date::test_create_date)?;
  exports.create_named_method("testGetDateValue", date::test_get_date_value)?;
  Ok(())
}
