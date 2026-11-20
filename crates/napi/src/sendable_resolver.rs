use crate::Result;
use napi_sys as sys;
use std::marker::PhantomData;

/// A resolver that can be moved to another thread, for example into the future that
/// `execute_tokio_future` spawns, and called back on the JavaScript thread.
///
/// [`SendableResolver::new`] requires the resolver to be `Send`. A resolver that is not `Send`
/// is not allowed on another thread, so it fails to compile:
///
/// ```compile_fail
/// use std::rc::Rc;
/// use napi::{sys, Result, SendableResolver};
///
/// let rc = Rc::new(42);
/// let resolver = SendableResolver::new(move |_env: sys::napi_env, _data: ()| -> Result<sys::napi_value> {
///   let _ = *rc;
///   Ok(std::ptr::null_mut())
/// });
/// std::thread::spawn(move || drop(resolver));
/// ```
///
/// Use [`SendableResolver::new_unchecked`] for a resolver that is not `Send` but is only called
/// and dropped on the JavaScript thread.
pub struct SendableResolver<
  Data: 'static + Send,
  R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
> {
  inner: R,
  _data: PhantomData<Data>,
}

// `new` only accepts a `Send` resolver, and `new_unchecked` makes its caller promise that the
// resolver is only called and dropped on the JavaScript thread, so moving the wrapper to another
// thread is sound either way.
unsafe impl<Data: 'static + Send, R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>>
  Send for SendableResolver<Data, R>
{
}

impl<
    Data: 'static + Send,
    R: 'static + Send + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
  > SendableResolver<Data, R>
{
  pub fn new(inner: R) -> Self {
    Self {
      inner,
      _data: PhantomData,
    }
  }
}

impl<Data: 'static + Send, R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>>
  SendableResolver<Data, R>
{
  /// Wraps a resolver that is not `Send`.
  ///
  /// # Safety
  ///
  /// The returned value may be moved to other threads, but it must be resolved and dropped on
  /// the JavaScript thread, and so must anything the resolver captures.
  pub unsafe fn new_unchecked(inner: R) -> Self {
    Self {
      inner,
      _data: PhantomData,
    }
  }

  pub fn resolve(self, env: sys::napi_env, data: Data) -> Result<sys::napi_value> {
    (self.inner)(env, data)
  }
}
