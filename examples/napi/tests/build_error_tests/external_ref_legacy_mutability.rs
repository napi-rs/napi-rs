use napi::bindgen_prelude::{External, FromNapiMutRef};
use napi::JsExternal;

fn assert_mutable_conversion<T: FromNapiMutRef>() {}

fn shared_getter_is_not_mutable<'env>(
  value: &'env JsExternal<'env>,
) -> napi::Result<&'env mut u32> {
  value.get_value()
}

fn main() {
  assert_mutable_conversion::<External<u32>>();
}
