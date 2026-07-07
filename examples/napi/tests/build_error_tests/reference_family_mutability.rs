use std::ops::DerefMut;

use napi::bindgen_prelude::{Reference, SharedReference, WeakReference};

fn assert_deref_mut<T: DerefMut>() {}

fn main() {
  assert_deref_mut::<Reference<u32>>();
  assert_deref_mut::<SharedReference<u32, u32>>();

  fn mutate_weak(mut reference: WeakReference<u32>) {
    let _ = reference.get_mut();
  }
}
