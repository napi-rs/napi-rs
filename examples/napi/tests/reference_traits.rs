use napi::bindgen_prelude::{Reference, SharedReference};
use static_assertions::assert_not_impl_any;

assert_not_impl_any!(Reference<u32>: Send, Sync);
assert_not_impl_any!(SharedReference<u32, u32>: Send, Sync);

#[test]
fn reference_family_remains_thread_affine() {}
