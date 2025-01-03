use std::mem::ManuallyDrop;
use std::str;

use napi::{
  bindgen_prelude::BufferSlice, noop_finalize, CallContext, ContextlessResult, Env, Error,
  JsNumber, JsObject, JsString, JsUndefined, Result, Status,
};

#[js_function(1)]
pub fn get_buffer_length(ctx: CallContext) -> Result<JsNumber> {
  let buffer = ctx.get::<BufferSlice>(0)?;
  ctx.env.create_uint32(buffer.len() as u32)
}

#[js_function(1)]
pub fn buffer_to_string(ctx: CallContext) -> Result<JsString> {
  let buffer = ctx.get::<BufferSlice>(0)?;
  ctx.env.create_string(
    str::from_utf8(&buffer).map_err(|e| Error::new(Status::StringExpected, format!("{}", e)))?,
  )
}

#[js_function(1)]
pub fn copy_buffer(ctx: CallContext) -> Result<BufferSlice> {
  let buffer = ctx.get::<BufferSlice>(0)?;
  BufferSlice::copy_from(ctx.env, buffer)
}

#[contextless_function]
pub fn create_borrowed_buffer_with_noop_finalize(
  env: Env,
) -> ContextlessResult<BufferSlice<'static>> {
  let mut data = vec![1, 2, 3];
  let data_ptr = data.as_mut_ptr();
  let length = data.len();
  let manually_drop = ManuallyDrop::new(data);

  let ret =
    unsafe { BufferSlice::from_external(&env, data_ptr, length, manually_drop, noop_finalize) }?;

  Ok(Some(ret))
}

#[contextless_function]
pub fn create_borrowed_buffer_with_finalize(env: Env) -> ContextlessResult<BufferSlice<'static>> {
  let mut data = vec![1, 2, 3];
  let data_ptr = data.as_mut_ptr();
  let length = data.len();
  let manually_drop = ManuallyDrop::new(data);

  let ret = unsafe {
    BufferSlice::from_external(
      &env,
      data_ptr,
      length,
      manually_drop,
      |_, mut hint: ManuallyDrop<Vec<u8>>| {
        ManuallyDrop::drop(&mut hint);
      },
    )
  }?;

  Ok(Some(ret))
}

#[contextless_function]
pub fn create_empty_borrowed_buffer_with_finalize(
  env: Env,
) -> ContextlessResult<BufferSlice<'static>> {
  let mut data = vec![];
  let data_ptr = data.as_mut_ptr();
  let length = data.len();
  let manually_drop = ManuallyDrop::new(data);

  let ret = unsafe {
    BufferSlice::from_external(
      &env,
      data_ptr,
      length,
      manually_drop,
      |_, mut hint: ManuallyDrop<Vec<u8>>| {
        ManuallyDrop::drop(&mut hint);
      },
    )
  }?;

  Ok(Some(ret))
}

#[contextless_function]
pub fn create_empty_buffer(env: Env) -> ContextlessResult<BufferSlice<'static>> {
  let data = vec![];

  let ret = BufferSlice::from_data(&env, data)?;

  Ok(Some(ret))
}

#[js_function(1)]
fn mutate_buffer(ctx: CallContext) -> Result<JsUndefined> {
  let buffer = &mut ctx.get::<BufferSlice>(0)?;
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
