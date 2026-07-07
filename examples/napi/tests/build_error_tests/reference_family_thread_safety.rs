use napi::bindgen_prelude::{Reference, SharedReference};

fn assert_sync<T: Sync>() {}

fn main() {
  assert_sync::<Reference<u32>>();
  assert_sync::<SharedReference<u32, u32>>();
}
