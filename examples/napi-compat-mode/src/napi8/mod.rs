use napi::{JsObject, Result};

mod async_cleanup;
mod object;

use async_cleanup::*;
use object::*;

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testSealObject", seal_object)?;
  exports.create_named_method("testFreezeObject", freeze_object)?;
  exports.create_named_method(
    "testAddRemovableAsyncCleanupHook",
    add_removable_async_cleanup_hook,
  )?;
  exports.create_named_method("testRemoveAsyncCleanupHook", remove_async_cleanup_hook)?;
  exports.create_named_method("testAddAsyncCleanupHook", add_async_cleanup_hook)?;
  Ok(())
}
