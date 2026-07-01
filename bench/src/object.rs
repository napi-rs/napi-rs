use napi::{bindgen_prelude::FromNapiValue, CallContext, JsObject, JsValue, Result, Unknown};

#[napi(object)]
pub struct BenchStrictObject {
  pub name: String,
}

#[napi(object)]
pub struct BenchAllOptionalObject {
  pub name: Option<String>,
  pub age: Option<u32>,
}

#[napi(object)]
pub struct BenchNestedOptionalMeta {
  #[napi(js_name = "isSubImportsPattern")]
  pub is_sub_imports_pattern: Option<bool>,
}

#[napi(object)]
pub struct BenchNestedMeta {
  #[napi(js_name = "vite:import-glob")]
  pub vite_import_glob: BenchNestedOptionalMeta,
}

#[napi(discriminant = "type2")]
pub enum BenchStructuredKind {
  Birthday { name: String, age: u8 },
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("benchReceiveStrictObject", bench_receive_strict_object)?;
  exports.create_named_method(
    "benchReceiveAllOptionalObject",
    bench_receive_all_optional_object,
  )?;
  exports.create_named_method("benchReceiveNestedMeta", bench_receive_nested_meta)?;
  exports.create_named_method(
    "benchValidateStructuredEnum",
    bench_validate_structured_enum,
  )?;
  Ok(())
}

#[js_function(1)]
fn bench_receive_strict_object(ctx: CallContext) -> Result<()> {
  let input = ctx.get::<Unknown>(0)?;
  let _: BenchStrictObject = unsafe { FromNapiValue::from_napi_value(ctx.env.raw(), input.raw())? };
  Ok(())
}

#[js_function(1)]
fn bench_receive_all_optional_object(ctx: CallContext) -> Result<()> {
  let input = ctx.get::<Unknown>(0)?;
  let _: BenchAllOptionalObject =
    unsafe { FromNapiValue::from_napi_value(ctx.env.raw(), input.raw())? };
  Ok(())
}

#[js_function(1)]
fn bench_receive_nested_meta(ctx: CallContext) -> Result<()> {
  let input = ctx.get::<Unknown>(0)?;
  let _: BenchNestedMeta = unsafe { FromNapiValue::from_napi_value(ctx.env.raw(), input.raw())? };
  Ok(())
}

#[js_function(1)]
fn bench_validate_structured_enum(ctx: CallContext) -> Result<()> {
  let input = ctx.get::<Unknown>(0)?;
  let _: BenchStructuredKind =
    unsafe { FromNapiValue::from_napi_value(ctx.env.raw(), input.raw())? };
  Ok(())
}
