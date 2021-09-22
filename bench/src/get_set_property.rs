use std::str::FromStr;

use napi::*;

struct TestNative {
  miter_limit: u32,
  line_join: LineJoin,
}

enum LineJoin {
  Miter,
  Round,
  Bevel,
}

impl LineJoin {
  fn as_str(&self) -> &str {
    match self {
      Self::Bevel => "bevel",
      Self::Miter => "miter",
      Self::Round => "round",
    }
  }
}

impl FromStr for LineJoin {
  type Err = Error;

  fn from_str(value: &str) -> Result<LineJoin> {
    match value {
      "bevel" => Ok(Self::Bevel),
      "round" => Ok(Self::Round),
      "miter" => Ok(Self::Miter),
      _ => Err(Error::new(
        Status::InvalidArg,
        format!("[{}] is not valid LineJoin value", value),
      )),
    }
  }
}

pub fn register_js(exports: &mut JsObject, env: &Env) -> Result<()> {
  let test_class = env.define_class(
    "TestClass",
    test_class_constructor,
    &[
      Property::new("miterNative")?
        .with_getter(get_miter_native)
        .with_setter(set_miter_native),
      Property::new("miter")?
        .with_getter(get_miter)
        .with_setter(set_miter),
      Property::new("lineJoinNative")?
        .with_getter(get_line_join_native)
        .with_setter(set_line_join_native),
      Property::new("lineJoin")?
        .with_getter(get_line_join)
        .with_setter(set_line_join),
    ],
  )?;
  exports.set_named_property("TestClass", test_class)?;
  Ok(())
}

#[js_function]
fn test_class_constructor(ctx: CallContext) -> Result<JsUndefined> {
  let native = TestNative {
    miter_limit: 10,
    line_join: LineJoin::Miter,
  };
  let mut this = ctx.this_unchecked::<JsObject>();
  ctx.env.wrap(&mut this, native)?;
  ctx.env.get_undefined()
}

#[js_function]
fn get_miter_native(ctx: CallContext) -> Result<JsNumber> {
  let this = ctx.this_unchecked::<JsObject>();
  let native = ctx.env.unwrap::<TestNative>(&this)?;

  ctx.env.create_uint32(native.miter_limit)
}

#[js_function(1)]
fn set_miter_native(ctx: CallContext) -> Result<JsUndefined> {
  let miter: u32 = ctx.get::<JsNumber>(0)?.get_uint32()?;

  let this = ctx.this_unchecked::<JsObject>();
  let native = ctx.env.unwrap::<TestNative>(&this)?;

  native.miter_limit = miter;

  ctx.env.get_undefined()
}

#[js_function]
fn get_miter(ctx: CallContext) -> Result<JsUnknown> {
  let this = ctx.this_unchecked::<JsObject>();
  this.get_named_property("_miterLimit")
}

#[js_function(1)]
fn set_miter(ctx: CallContext) -> Result<JsUndefined> {
  let miter_number = ctx.get::<JsNumber>(0)?;
  let miter = miter_number.get_uint32()?;

  let mut this = ctx.this_unchecked::<JsObject>();
  let native = ctx.env.unwrap::<TestNative>(&this)?;

  native.miter_limit = miter;

  this.set_named_property("_miterLimit", miter_number)?;

  ctx.env.get_undefined()
}

#[js_function]
fn get_line_join_native(ctx: CallContext) -> Result<JsString> {
  let this = ctx.this_unchecked::<JsObject>();
  let native = ctx.env.unwrap::<TestNative>(&this)?;

  ctx.env.create_string(native.line_join.as_str())
}

#[js_function(1)]
fn set_line_join_native(ctx: CallContext) -> Result<JsUndefined> {
  let line_join_string = ctx.get::<JsString>(0)?;
  let line_join = line_join_string.into_utf8()?;

  let this = ctx.this_unchecked::<JsObject>();
  let native = ctx.env.unwrap::<TestNative>(&this)?;

  native.line_join = LineJoin::from_str(line_join.as_str()?)?;

  ctx.env.get_undefined()
}

#[js_function]
fn get_line_join(ctx: CallContext) -> Result<JsUnknown> {
  let this = ctx.this_unchecked::<JsObject>();

  this.get_named_property("_lineJoin")
}

#[js_function(1)]
fn set_line_join(ctx: CallContext) -> Result<JsUndefined> {
  let line_join_string = ctx.get::<JsString>(0)?;
  let line_join = line_join_string.into_utf8()?;

  let mut this = ctx.this_unchecked::<JsObject>();
  let native = ctx.env.unwrap::<TestNative>(&this)?;

  native.line_join = LineJoin::from_str(line_join.as_str()?)?;

  this.set_named_property("_lineJoin", line_join_string)?;

  ctx.env.get_undefined()
}
