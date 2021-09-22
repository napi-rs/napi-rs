use napi::{JsObject, Result};

mod bigint;
mod instance;

use bigint::*;
use instance::*;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testCreateBigintFromI64", test_create_bigint_from_i64)?;
  exports.create_named_method("testCreateBigintFromU64", test_create_bigint_from_u64)?;
  exports.create_named_method("testCreateBigintFromI128", test_create_bigint_from_i128)?;
  exports.create_named_method("testCreateBigintFromU128", test_create_bigint_from_u128)?;
  exports.create_named_method("testCreateBigintFromWords", test_create_bigint_from_words)?;
  exports.create_named_method("testGetBigintI64", test_get_bigint_i64)?;
  exports.create_named_method("testGetBigintU64", test_get_bigint_u64)?;
  exports.create_named_method("testGetBigintWords", test_get_bigint_words)?;

  exports.create_named_method("setInstanceData", set_instance_data)?;
  exports.create_named_method("getInstanceData", get_instance_data)?;
  exports.create_named_method("getWrongTypeInstanceData", get_wrong_type_instance_data)?;
  Ok(())
}
