use napi::bindgen_prelude::{Object, Result};
use napi::JsFunction;

#[napi(ts_args_type = "a: { foo: number }", ts_return_type = "string[]")]
fn ts_rename(a: Object) -> Result<Object> {
  a.get_property_names()
}

#[napi]
fn override_individual_arg_on_function(
  not_overridden: String,
  #[napi(ts_arg_type = "() => string")] f: JsFunction,
  not_overridden2: u32,
) -> String {
  let u = f.call_without_args(None).unwrap();
  let s = u
    .coerce_to_string()
    .unwrap()
    .into_utf8()
    .unwrap()
    .as_str()
    .unwrap()
    .to_string();

  format!("oia: {}-{}-{}", not_overridden, not_overridden2, s)
}

#[napi]
fn override_individual_arg_on_function_with_cb_arg<
  T: Fn(String, Option<String>) -> Result<Object>,
>(
  #[napi(ts_arg_type = "(town: string, name?: string | undefined | null) => string")] callback: T,
  not_overridden: u32,
) -> Result<Object> {
  callback(format!("World({})", not_overridden), None)
}
