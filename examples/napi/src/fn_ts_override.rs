use napi::bindgen_prelude::{Object, Result};

#[napi(ts_args_type = "a: { foo: number }", ts_return_type = "string[]")]
fn ts_rename(a: Object) -> Result<Object> {
  a.get_property_names()
}
