use std::convert::Into;
use std::ffi::CString;
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::{check_status, sys, Env, Error, JsError, JsFunction, NapiValue, Result, Status};

use sys::napi_threadsafe_function_call_mode;

/// ThreadSafeFunction Context object
/// the `value` is the value passed to `call` method
pub struct ThreadSafeCallContext<T: 'static> {
  pub env: Env,
  pub value: T,
}

#[repr(u8)]
pub enum ThreadsafeFunctionCallMode {
  NonBlocking,
  Blocking,
}

impl Into<napi_threadsafe_function_call_mode> for ThreadsafeFunctionCallMode {
  fn into(self) -> napi_threadsafe_function_call_mode {
    match self {
      ThreadsafeFunctionCallMode::Blocking => {
        napi_threadsafe_function_call_mode::napi_tsfn_blocking
      }
      ThreadsafeFunctionCallMode::NonBlocking => {
        napi_threadsafe_function_call_mode::napi_tsfn_nonblocking
      }
    }
  }
}

/// Communicate with the addon's main thread by invoking a JavaScript function from other threads.
///
/// ## Example
/// An example of using `ThreadsafeFunction`:
///
/// ```
/// #[macro_use]
/// extern crate napi_derive;
///
/// use std::thread;
///
/// use napi::{
///     threadsafe_function::{
///         ThreadSafeCallContext, ThreadsafeFunctionCallMode, ThreadsafeFunctionReleaseMode,
///     },
///     CallContext, Error, JsFunction, JsNumber, JsUndefined, Result, Status,
/// };

/// #[js_function(1)]
/// pub fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
///     let func = ctx.get::<JsFunction>(0)?;

///     let tsfn = ctx.env
///         .create_threadsafe_function(func, 0, |ctx: ThreadSafeCallContext<Vec<u32>>| {
///             ctx.value
///                 .iter()
///                 .map(|v| ctx.env.create_uint32(*v))]
///                 .collect::<Result<Vec<JsNumber>>>()
///         })?;

///     thread::spawn(move || {
///         let output: Vec<u32> = vec![42, 1, 2, 3];
///         // It's okay to call a threadsafe function multiple times.
///         tsfn.call(Ok(output.clone()), ThreadsafeFunctionCallMode::Blocking);
///         tsfn.call(Ok(output.clone()), ThreadsafeFunctionCallMode::NonBlocking);
///         tsfn.release(ThreadsafeFunctionReleaseMode::Release);
///     });

///     ctx.env.get_undefined()
/// }
/// ```
pub struct ThreadsafeFunction<T: 'static> {
  raw_tsfn: sys::napi_threadsafe_function,
  aborted: Arc<AtomicBool>,
  _phantom: PhantomData<T>,
}

unsafe impl<T> Send for ThreadsafeFunction<T> {}
unsafe impl<T> Sync for ThreadsafeFunction<T> {}

struct ThreadSafeContext<T: 'static, V: NapiValue>(
  Box<dyn FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>>,
);

impl<T: 'static> ThreadsafeFunction<T> {
  /// See [napi_create_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_create_threadsafe_function)
  /// for more information.
  #[inline]
  pub fn create<
    V: NapiValue,
    R: 'static + Send + FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>,
  >(
    env: sys::napi_env,
    func: &JsFunction,
    max_queue_size: usize,
    callback: R,
  ) -> Result<Self> {
    let mut async_resource_name = ptr::null_mut();
    let s = "napi_rs_threadsafe_function";
    let len = s.len();
    let s = CString::new(s)?;
    check_status!(unsafe {
      sys::napi_create_string_utf8(env, s.as_ptr(), len, &mut async_resource_name)
    })?;

    let initial_thread_count = 1usize;
    let mut raw_tsfn = ptr::null_mut();
    let context = ThreadSafeContext(Box::from(callback));
    let ptr = Box::into_raw(Box::new(context)) as *mut _;
    check_status!(unsafe {
      sys::napi_create_threadsafe_function(
        env,
        func.0.value,
        ptr::null_mut(),
        async_resource_name,
        max_queue_size,
        initial_thread_count,
        ptr,
        Some(thread_finalize_cb::<T, V>),
        ptr,
        Some(call_js_cb::<T, V>),
        &mut raw_tsfn,
      )
    })?;

    Ok(ThreadsafeFunction {
      raw_tsfn,
      aborted: Arc::new(AtomicBool::new(false)),
      _phantom: PhantomData,
    })
  }

  /// See [napi_call_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_call_threadsafe_function)
  /// for more information.
  pub fn call(&self, value: Result<T>, mode: ThreadsafeFunctionCallMode) -> Status {
    if self.aborted.load(Ordering::Acquire) {
      return Status::Closing;
    }
    unsafe {
      sys::napi_call_threadsafe_function(
        self.raw_tsfn,
        Box::into_raw(Box::new(value)) as *mut _,
        mode.into(),
      )
    }
    .into()
  }

  /// See [napi_ref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_ref_threadsafe_function)
  /// for more information.
  ///
  /// "ref" is a keyword so that we use "refer" here.
  pub fn refer(&mut self, env: &Env) -> Result<()> {
    if self.aborted.load(Ordering::Acquire) {
      return Err(Error::new(
        Status::Closing,
        format!("Can not ref, Thread safe function already aborted"),
      ));
    }
    check_status!(unsafe { sys::napi_ref_threadsafe_function(env.0, self.raw_tsfn) })
  }

  /// See [napi_unref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_unref_threadsafe_function)
  /// for more information.
  pub fn unref(&mut self, env: &Env) -> Result<()> {
    if self.aborted.load(Ordering::Acquire) {
      return Err(Error::new(
        Status::Closing,
        format!("Can not unref, Thread safe function already aborted"),
      ));
    }
    check_status!(unsafe { sys::napi_unref_threadsafe_function(env.0, self.raw_tsfn) })
  }

  pub fn aborted(&self) -> bool {
    self.aborted.load(Ordering::Acquire)
  }

  pub fn abort(self) -> Result<()> {
    check_status!(unsafe {
      sys::napi_release_threadsafe_function(
        self.raw_tsfn,
        sys::napi_threadsafe_function_release_mode::napi_tsfn_abort,
      )
    })?;
    self.aborted.store(true, Ordering::Release);
    Ok(())
  }

  pub fn try_clone(&self) -> Result<Self> {
    if self.aborted.load(Ordering::Acquire) {
      return Err(Error::new(
        Status::Closing,
        format!("Can not clone, Thread safe function already aborted"),
      ));
    }
    check_status!(unsafe { sys::napi_acquire_threadsafe_function(self.raw_tsfn) })?;
    Ok(Self {
      raw_tsfn: self.raw_tsfn,
      aborted: Arc::clone(&self.aborted),
      _phantom: PhantomData,
    })
  }

  /// Get the raw `ThreadSafeFunction` pointer
  pub fn raw(&self) -> sys::napi_threadsafe_function {
    self.raw_tsfn
  }
}

impl<T: 'static> Drop for ThreadsafeFunction<T> {
  fn drop(&mut self) {
    if !self.aborted.load(Ordering::Acquire) {
      let release_status = unsafe {
        sys::napi_release_threadsafe_function(
          self.raw_tsfn,
          sys::napi_threadsafe_function_release_mode::napi_tsfn_release,
        )
      };
      assert!(
        release_status == sys::Status::napi_ok,
        "Threadsafe Function release failed"
      );
    }
  }
}

unsafe extern "C" fn thread_finalize_cb<T: 'static, V: NapiValue>(
  _raw_env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  // cleanup
  Box::from_raw(finalize_data as *mut ThreadSafeContext<T, V>);
}

unsafe extern "C" fn call_js_cb<T: 'static, V: NapiValue>(
  raw_env: sys::napi_env,
  js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let mut recv = ptr::null_mut();
  sys::napi_get_undefined(raw_env, &mut recv);

  let ctx = Box::leak(Box::from_raw(context as *mut ThreadSafeContext<T, V>));
  let val = Box::from_raw(data as *mut Result<T>);

  let ret = val.and_then(|v| {
    (ctx.0)(ThreadSafeCallContext {
      env: Env::from_raw(raw_env),
      value: v,
    })
  });

  let status;

  // Follow async callback conventions: https://nodejs.org/en/knowledge/errors/what-are-the-error-conventions/
  // Check if the Result is okay, if so, pass a null as the first (error) argument automatically.
  // If the Result is an error, pass that as the first argument.
  match ret {
    Ok(values) => {
      let mut js_null = ptr::null_mut();
      sys::napi_get_null(raw_env, &mut js_null);
      let args_length = values.len() + 1;
      let mut args: Vec<sys::napi_value> = Vec::with_capacity(args_length);
      args.push(js_null);
      args.extend(values.iter().map(|v| v.raw()));
      status = sys::napi_call_function(
        raw_env,
        recv,
        js_callback,
        args_length,
        args.as_ptr(),
        ptr::null_mut(),
      );
    }
    Err(e) => {
      status = sys::napi_call_function(
        raw_env,
        recv,
        js_callback,
        1,
        [JsError::from(e).into_value(raw_env)].as_mut_ptr(),
        ptr::null_mut(),
      );
    }
  }
  debug_assert!(status == sys::Status::napi_ok, "CallJsCB failed");
}
