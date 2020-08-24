#[macro_use]
extern crate napi;
#[macro_use]
extern crate napi_derive;

use napi::{CallContext, Error, JsBoolean, JsString, JsUnknown, Module, Result, Status};

#[cfg(napi4)]
mod libuv;
#[cfg(napi4)]
mod napi4;
#[cfg(napi5)]
mod napi5;
#[cfg(napi4)]
mod tokio_rt;
#[cfg(napi6)]
mod napi6;

mod buffer;
mod class;
mod either;
mod external;
mod function;
mod napi_version;
mod string;
mod symbol;
mod task;

use buffer::{buffer_to_string, get_buffer_length};
use either::{dynamic_argument_length, either_number_string};
use external::{create_external, get_external_count};
use function::{call_function, call_function_with_this};
#[cfg(napi4)]
use libuv::read_file::uv_read_file;
#[cfg(napi4)]
use napi4::{test_threadsafe_function, test_tokio_readfile, test_tsfn_error};
#[cfg(napi5)]
use napi5::is_date::test_object_is_date;
use napi_version::get_napi_version;
use symbol::{create_named_symbol, create_symbol_from_js_string, create_unnamed_symbol};
use task::test_spawn_thread;
#[cfg(napi4)]
use tokio_rt::{error_from_tokio_future, test_execute_tokio_readfile};
#[cfg(napi6)]
use napi6::bigint::{
  test_create_bigint_from_i64,
  test_create_bigint_from_u64,
  test_create_bigint_from_words,
  test_get_bigint_i64,
  test_get_bigint_u64,
  test_get_bigint_words,
};

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
  module.create_named_method("getNapiVersion", get_napi_version)?;
  module.create_named_method("testCallFunction", call_function)?;
  module.create_named_method("testCallFunctionWithThis", call_function_with_this)?;
  module.create_named_method("eitherNumberString", either_number_string)?;
  module.create_named_method("dynamicArgumentLength", dynamic_argument_length)?;
  module.create_named_method("createTestClass", class::create_test_class)?;
  module.create_named_method("concatString", string::concat_string)?;
  module.create_named_method("instanceof", instanceof)?;
  module.create_named_method("isError", is_error)?;
  module.create_named_method("isTypedarray", is_typedarray)?;
  module.create_named_method("isDataview", is_dataview)?;
  module.create_named_method("strictEquals", strict_equals)?;
  #[cfg(napi4)]
  module.create_named_method("testExecuteTokioReadfile", test_execute_tokio_readfile)?;
  #[cfg(napi4)]
  module.create_named_method("testTsfnError", test_tsfn_error)?;
  #[cfg(napi4)]
  module.create_named_method("testThreadsafeFunction", test_threadsafe_function)?;
  #[cfg(napi4)]
  module.create_named_method("testTokioReadfile", test_tokio_readfile)?;
  #[cfg(napi4)]
  module.create_named_method("testTokioError", error_from_tokio_future)?;
  #[cfg(napi4)]
  module.create_named_method("uvReadFile", uv_read_file)?;
  #[cfg(napi5)]
  module.create_named_method("testObjectIsDate", test_object_is_date)?;
  #[cfg(napi6)]
  module.create_named_method("testCreateBigintFromI64", test_create_bigint_from_i64)?;
  #[cfg(napi6)]
  module.create_named_method("testCreateBigintFromU64", test_create_bigint_from_u64)?;
  #[cfg(napi6)]
  module.create_named_method("testCreateBigintFromWords", test_create_bigint_from_words)?;
  #[cfg(napi6)]
  module.create_named_method("testGetBigintI64", test_get_bigint_i64)?;
  #[cfg(napi6)]
  module.create_named_method("testGetBigintU64", test_get_bigint_u64)?;
  #[cfg(napi6)]
  module.create_named_method("testGetBigintWords", test_get_bigint_words)?;
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

#[js_function]
pub fn test_throw_with_panic(_ctx: CallContext) -> Result<JsUnknown> {
  panic!("don't panic.");
}

#[js_function(2)]
pub fn instanceof(ctx: CallContext) -> Result<JsBoolean> {
  let object = ctx.get::<JsUnknown>(0)?;
  let constructor = ctx.get::<JsUnknown>(1)?;
  ctx.env.get_boolean(object.instanceof(constructor)?)
}

#[js_function(1)]
pub fn is_error(ctx: CallContext) -> Result<JsBoolean> {
  let js_value = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(js_value.is_error()?)
}

#[js_function(1)]
pub fn is_typedarray(ctx: CallContext) -> Result<JsBoolean> {
  let js_value = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(js_value.is_typedarray()?)
}

#[js_function(1)]
pub fn is_dataview(ctx: CallContext) -> Result<JsBoolean> {
  let js_value = ctx.get::<JsUnknown>(0)?;
  ctx.env.get_boolean(js_value.is_dataview()?)
}

#[js_function(2)]
pub fn strict_equals(ctx: CallContext) -> Result<JsBoolean> {
  let a: JsUnknown = ctx.get(0)?;
  let b: JsUnknown = ctx.get(1)?;
  ctx.env.get_boolean(ctx.env.strict_equals(a, b)?)
}
