#[macro_use]
extern crate napi_rs as napi;
#[macro_use]
extern crate napi_rs_derive;

use napi::{CallContext, Error, JsString, JsUnknown, Module, Result, Status};

#[cfg(napi5)]
mod napi5;

mod buffer;
mod function;
mod external;
mod symbol;
mod task;
mod tsfn;

use buffer::{buffer_to_string, get_buffer_length};
use function::{call_function, call_function_with_this};
use external::{create_external, get_external_count};
#[cfg(napi5)]
use napi5::is_date::test_object_is_date;
use symbol::{create_named_symbol, create_symbol_from_js_string, create_unnamed_symbol};
use task::test_spawn_thread;
use tsfn::{test_threadsafe_function, test_tokio_readfile, test_tsfn_error};

register_module!(test_module, init);

fn init(module: &mut Module) -> Result<()> {
  module.create_named_method("testThrow", test_throw)?;
  module.create_named_method("testThrowWithReason", test_throw_with_reason)?;
  module.create_named_method("testSpawnThread", test_spawn_thread)?;
  module.create_named_method("createExternal", create_external)?;
  module.create_named_method("getExternalCount", get_external_count)?;
  module.create_named_method("getBufferLength", get_buffer_length)?;
  module.create_named_method("bufferToString", buffer_to_string)?;
  module.create_named_method("createNamedSymbol", create_named_symbol)?;
  module.create_named_method("createUnnamedSymbol", create_unnamed_symbol)?;
  module.create_named_method("createSymbolFromJsString", create_symbol_from_js_string)?;
  module.create_named_method("testTsfnError", test_tsfn_error)?;
  module.create_named_method("testThreadsafeFunction", test_threadsafe_function)?;
  module.create_named_method("testTokioReadfile", test_tokio_readfile)?;
  module.create_named_method("testCallFunction", call_function)?;
  module.create_named_method("testCallFunctionWithThis", call_function_with_this)?;
  #[cfg(napi5)]
  module.create_named_method("testObjectIsDate", test_object_is_date)?;
  Ok(())
}

#[js_function]
fn test_throw(_ctx: CallContext) -> Result<JsUnknown> {
  Err(Error::from_status(Status::GenericFailure))
}

#[js_function(1)]
fn test_throw_with_reason(ctx: CallContext) -> Result<JsUnknown> {
  let reason = ctx.get::<JsString>(0)?;
  Err(Error::new(
    Status::GenericFailure,
    reason.as_str()?.to_owned(),
  ))
}
