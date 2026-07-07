#![cfg(not(feature = "noop"))]

trait AmbiguousIfCopy<A> {
  fn marker() {}
}

impl<T: ?Sized> AmbiguousIfCopy<()> for T {}
impl<T: Copy> AmbiguousIfCopy<u8> for T {}

trait AmbiguousIfClone<A> {
  fn marker() {}
}

impl<T: ?Sized> AmbiguousIfClone<()> for T {}
impl<T: Clone> AmbiguousIfClone<u8> for T {}

trait AmbiguousIfSend<A> {
  fn marker() {}
}

impl<T: ?Sized> AmbiguousIfSend<()> for T {}
impl<T: ?Sized + Send> AmbiguousIfSend<u8> for T {}

trait AmbiguousIfSync<A> {
  fn marker() {}
}

impl<T: ?Sized> AmbiguousIfSync<()> for T {}
impl<T: ?Sized + Sync> AmbiguousIfSync<u8> for T {}

#[cfg(feature = "napi3")]
#[test]
fn cleanup_env_hook_is_unique_and_thread_affine() {
  use napi::{CleanupEnvHook, Env, Result};

  let _ = <CleanupEnvHook<()> as AmbiguousIfCopy<_>>::marker;
  let _ = <CleanupEnvHook<()> as AmbiguousIfClone<_>>::marker;
  let _ = <CleanupEnvHook<()> as AmbiguousIfSend<_>>::marker;
  let _ = <CleanupEnvHook<()> as AmbiguousIfSync<_>>::marker;
  let _: fn(&Env, CleanupEnvHook<()>) -> Result<()> = Env::remove_env_cleanup_hook::<()>;
}

#[cfg(feature = "napi8")]
#[test]
fn async_cleanup_hook_is_unique_and_thread_affine() {
  use napi::AsyncCleanupHook;

  let _ = <AsyncCleanupHook as AmbiguousIfCopy<_>>::marker;
  let _ = <AsyncCleanupHook as AmbiguousIfClone<_>>::marker;
  let _ = <AsyncCleanupHook as AmbiguousIfSend<_>>::marker;
  let _ = <AsyncCleanupHook as AmbiguousIfSync<_>>::marker;
  let _: fn(AsyncCleanupHook) = AsyncCleanupHook::forget;
}
