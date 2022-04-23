use std::mem::ManuallyDrop;
use std::str;

use napi::{
  noop_finalize, CallContext, ContextlessResult, Env, Error, JsBuffer, JsNumber, JsObject,
  JsString, JsUndefined, Result, Status,
};

#[js_function(1)]
pub fn get_buffer_length(ctx: CallContext) -> Result<JsNumber> {
  let buffer = ctx.get::<JsBuffer>(0)?.into_value()?;
  ctx.env.create_uint32(buffer.len() as u32)
}

#[js_function(1)]
pub fn buffer_to_string(ctx: CallContext) -> Result<JsString> {
  let buffer = ctx.get::<JsBuffer>(0)?.into_value()?;
  ctx.env.create_string(
    str::from_utf8(&buffer).map_err(|e| Error::new(Status::StringExpected, format!("{}", e)))?,
  )
}

#[js_function(1)]
pub fn copy_buffer(ctx: CallContext) -> Result<JsBuffer> {
  let buffer = ctx.get::<JsBuffer>(0)?.into_value()?;
  ctx.env.create_buffer_copy(buffer).map(|b| b.into_raw())
}

#[contextless_function]
pub fn create_borrowed_buffer_with_noop_finalize(env: Env) -> ContextlessResult<JsBuffer> {
  let data = vec![1, 2, 3];
  let data_ptr = data.as_ptr();
  let length = data.len();
  let manually_drop = ManuallyDrop::new(data);

  unsafe { env.create_buffer_with_borrowed_data(data_ptr, length, manually_drop, noop_finalize) }
    .map(|b| Some(b.into_raw()))
}

#[contextless_function]
pub fn create_borrowed_buffer_with_finalize(env: Env) -> ContextlessResult<JsBuffer> {
  let data = vec![1, 2, 3];
  let data_ptr = data.as_ptr();
  let length = data.len();
  let manually_drop = ManuallyDrop::new(data);

  unsafe {
    env.create_buffer_with_borrowed_data(
      data_ptr,
      length,
      manually_drop,
      |mut hint: ManuallyDrop<Vec<u8>>, _| {
        ManuallyDrop::drop(&mut hint);
      },
    )
  }
  .map(|b| Some(b.into_raw()))
}

#[contextless_function]
pub fn create_empty_borrowed_buffer_with_finalize(env: Env) -> ContextlessResult<JsBuffer> {
  let data = vec![];
  let data_ptr = data.as_ptr();
  let length = data.len();
  let manually_drop = ManuallyDrop::new(data);

  unsafe {
    env.create_buffer_with_borrowed_data(
      data_ptr,
      length,
      manually_drop,
      |mut hint: ManuallyDrop<Vec<u8>>, _| {
        ManuallyDrop::drop(&mut hint);
      },
    )
  }
  .map(|b| Some(b.into_raw()))
}

#[contextless_function]
pub fn create_empty_buffer(env: Env) -> ContextlessResult<JsBuffer> {
  let data = vec![];

  env
    .create_buffer_with_data(data)
    .map(|b| Some(b.into_raw()))
}

#[js_function(1)]
fn mutate_buffer(ctx: CallContext) -> Result<JsUndefined> {
  let buffer = &mut ctx.get::<JsBuffer>(0)?.into_value()?;
  buffer[1] = 42;
  ctx.env.get_undefined()
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("getBufferLength", get_buffer_length)?;
  exports.create_named_method("bufferToString", buffer_to_string)?;
  exports.create_named_method("copyBuffer", copy_buffer)?;
  exports.create_named_method(
    "createBorrowedBufferWithNoopFinalize",
    create_borrowed_buffer_with_noop_finalize,
  )?;
  exports.create_named_method(
    "createBorrowedBufferWithFinalize",
    create_borrowed_buffer_with_finalize,
  )?;
  exports.create_named_method(
    "createEmptyBorrowedBufferWithFinalize",
    create_empty_borrowed_buffer_with_finalize,
  )?;
  exports.create_named_method("createEmptyBuffer", create_empty_buffer)?;
  exports.create_named_method("mutateBuffer", mutate_buffer)?;
  Ok(())
}
