use napi::{Module, Result};

mod bigint;

use bigint::*;

pub fn register_js(module: &mut Module) -> Result<()> {
  module.create_named_method("testCreateBigintFromI64", test_create_bigint_from_i64)?;
  module.create_named_method("testCreateBigintFromU64", test_create_bigint_from_u64)?;
  module.create_named_method("testCreateBigintFromI128", test_create_bigint_from_i128)?;
  module.create_named_method("testCreateBigintFromU128", test_create_bigint_from_u128)?;
  module.create_named_method("testCreateBigintFromWords", test_create_bigint_from_words)?;
  module.create_named_method("testGetBigintI64", test_get_bigint_i64)?;
  module.create_named_method("testGetBigintU64", test_get_bigint_u64)?;
  module.create_named_method("testGetBigintWords", test_get_bigint_words)?;
  Ok(())
}
