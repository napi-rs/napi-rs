#[cfg(not(feature = "napi4"))]
trait AmbiguousIfSend<A> {
  fn marker() {}
}

#[cfg(not(feature = "napi4"))]
impl<T: ?Sized> AmbiguousIfSend<()> for T {}
#[cfg(not(feature = "napi4"))]
impl<T: ?Sized + Send> AmbiguousIfSend<u8> for T {}

#[cfg(not(feature = "napi4"))]
trait AmbiguousIfSync<A> {
  fn marker() {}
}

#[cfg(not(feature = "napi4"))]
impl<T: ?Sized> AmbiguousIfSync<()> for T {}
#[cfg(not(feature = "napi4"))]
impl<T: ?Sized + Sync> AmbiguousIfSync<u8> for T {}

#[cfg(not(feature = "napi4"))]
#[test]
fn low_napi_reference_owners_are_thread_affine() {
  use napi::{
    bindgen_prelude::{Buffer, FunctionRef, Uint8Array},
    Error,
  };

  let _ = <Error as AmbiguousIfSend<_>>::marker;
  let _ = <Error as AmbiguousIfSync<_>>::marker;
  let _ = <Buffer as AmbiguousIfSend<_>>::marker;
  let _ = <Buffer as AmbiguousIfSync<_>>::marker;
  let _ = <FunctionRef<(), ()> as AmbiguousIfSend<_>>::marker;
  let _ = <FunctionRef<(), ()> as AmbiguousIfSync<_>>::marker;
  let _ = <Uint8Array as AmbiguousIfSend<_>>::marker;
  let _ = <Uint8Array as AmbiguousIfSync<_>>::marker;
}

#[cfg(feature = "napi4")]
#[test]
fn napi4_reference_owners_remain_send_and_sync() {
  use napi::{
    bindgen_prelude::{Buffer, FunctionRef, Uint8Array},
    Error,
  };

  fn assert_send_sync<T: Send + Sync>() {}

  assert_send_sync::<Error>();
  assert_send_sync::<Buffer>();
  assert_send_sync::<FunctionRef<(), ()>>();
  assert_send_sync::<Uint8Array>();
}
