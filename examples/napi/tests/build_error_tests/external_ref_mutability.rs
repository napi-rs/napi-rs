use std::ops::DerefMut;

use napi::bindgen_prelude::ExternalRef;

fn assert_deref_mut<T: DerefMut<Target = u32>>() {}

fn main() {
  assert_deref_mut::<ExternalRef<u32>>();
}
