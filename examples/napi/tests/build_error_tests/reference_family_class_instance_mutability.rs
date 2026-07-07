use std::ops::{Deref, DerefMut};

use napi::bindgen_prelude::ClassInstance;

fn assert_deref<T: Deref>() {}
fn assert_deref_mut<T: DerefMut>() {}

fn main() {
  assert_deref::<ClassInstance<'static, u32>>();
  assert_deref_mut::<ClassInstance<'static, u32>>();
}
