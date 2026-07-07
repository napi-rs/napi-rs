use napi::bindgen_prelude::ExternalRef;

fn assert_sync<T: Sync>() {}

fn main() {
  assert_sync::<ExternalRef<u32>>();
}
