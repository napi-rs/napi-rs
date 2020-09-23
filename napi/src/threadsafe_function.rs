use std::convert::Into;
use std::mem;
use std::os::raw::{c_char, c_void};
use std::ptr;

use crate::error::check_status;
use crate::{sys, Env, JsFunction, NapiValue, Result};

use sys::napi_threadsafe_function_call_mode;
use sys::napi_threadsafe_function_release_mode;

#[repr(u8)]
pub enum ThreadsafeFunctionCallMode {
  NonBlocking,
  Blocking,
}

#[repr(u8)]
pub enum ThreadsafeFunctionReleaseMode {
  Release,
  Abort,
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

impl Into<napi_threadsafe_function_release_mode> for ThreadsafeFunctionReleaseMode {
  fn into(self) -> napi_threadsafe_function_release_mode {
    match self {
      ThreadsafeFunctionReleaseMode::Release => {
        napi_threadsafe_function_release_mode::napi_tsfn_release
      }
      ThreadsafeFunctionReleaseMode::Abort => {
        napi_threadsafe_function_release_mode::napi_tsfn_abort
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
/// use napi::{
///   Number, Result, Env, CallContext, JsUndefined, JsFunction,
/// };
/// use napi::threadsafe_function::{
///   ToJs, ThreadsafeFunction, ThreadsafeFunctionCallMode, ThreadsafeFunctionReleaseMode,
/// };
///
/// // Define a struct for handling the data passed from `ThreadsafeFunction::call`
/// // and return the data to be used for the js callback.
/// #[derive(Clone, Copy)]
/// struct HandleNumber;
///
/// impl ToJs for HandleNumber {
///   type Output = u8;
///
///   fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<Vec<JsUnknown>> {
///     let value = env.create_uint32(output as u32)?.into_unknown()?;
///     // The first argument in the NodeJS callback will be either a null or an error
///     // depending on the result returned by this function.
///     // If this Result is Ok, the first argument will be null.
///     // If this Result is Err, the first argument will be the error.
///     Ok(vec![value])
///   }
/// }
///
/// #[js_function(1)]
/// fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
///   // The callback function from js which will be called in `ThreadsafeFunction::call`.
///   let func = ctx.get::<JsFunction>(0)?;
///
///   let to_js = HandleNumber;
///   let tsfn = ThreadsafeFunction::create(ctx.env, func, to_js, 0)?;
///
///   thread::spawn(move || {
///     let output: u8 = 42;
///     // It's okay to call a threadsafe function multiple times.
///     tsfn.call(Ok(output), ThreadsafeFunctionCallMode::Blocking).unwrap();
///     tsfn.call(Ok(output), ThreadsafeFunctionCallMode::Blocking).unwrap();
///     // We should call `ThreadsafeFunction::release` manually when we don't
///     // need the instance anymore, or it will prevent Node.js from exiting
///     // automatically and possibly cause memory leaks.
///     tsfn.release(ThreadsafeFunctionReleaseMode::Release).unwrap();
///   });
///
///   ctx.env.get_undefined()
/// }
/// ```
pub struct ThreadsafeFunction<T, V: NapiValue<'static>> {
  raw_tsfn: sys::napi_threadsafe_function,
  output: mem::MaybeUninit<Result<T>>,
  callback: Box<dyn FnMut(Env, T) -> Result<Vec<V>>>,
}

unsafe impl<T, V: NapiValue<'static>> Send for ThreadsafeFunction<T, V> {}
unsafe impl<T, V: NapiValue<'static>> Sync for ThreadsafeFunction<T, V> {}

impl<T, V: NapiValue<'static>> ThreadsafeFunction<T, V> {
  /// See [napi_create_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_create_threadsafe_function)
  /// for more information.
  pub fn create(
    env: &Env,
    func: JsFunction,
    max_queue_size: u64,
    callback: Box<dyn FnMut(Env, T) -> Result<Vec<V>>>,
  ) -> Result<&'static mut Self> {
    let mut async_resource_name = ptr::null_mut();
    let s = "napi_rs_threadsafe_function";
    check_status(unsafe {
      sys::napi_create_string_utf8(
        env.0,
        s.as_ptr() as *const c_char,
        s.len() as u64,
        &mut async_resource_name,
      )
    })?;

    let initial_thread_count: u64 = 1;
    let mut result = ptr::null_mut();
    let tsfn = ThreadsafeFunction {
      raw_tsfn: result,
      output: mem::MaybeUninit::zeroed(),
      callback,
    };

    let ref_value = Box::leak(Box::from(tsfn));
    let ptr = ref_value as *mut _ as *mut c_void;

    check_status(unsafe {
      sys::napi_create_threadsafe_function(
        env.0,
        func.0.value,
        ptr::null_mut(),
        async_resource_name,
        max_queue_size,
        initial_thread_count,
        ptr,
        Some(thread_finalize_cb::<T, V>),
        ptr,
        Some(call_js_cb::<T, V>),
        &mut result,
      )
    })?;

    Ok(ref_value)
  }

  /// See [napi_call_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_call_threadsafe_function)
  /// for more information.
  pub fn call(&mut self, value: Result<T>, mode: ThreadsafeFunctionCallMode) {
    let _ = mem::replace(&mut self.output, mem::MaybeUninit::new(value));
    let status =
      unsafe { sys::napi_call_threadsafe_function(self.raw_tsfn, ptr::null_mut(), mode.into()) };
    debug_assert!(
      status == sys::napi_status::napi_ok,
      "Threadsafe Function call failed"
    );
  }

  /// See [napi_acquire_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_acquire_threadsafe_function)
  /// for more information.
  pub fn acquire(&self) {
    let status = unsafe { sys::napi_acquire_threadsafe_function(self.raw_tsfn) };
    debug_assert!(
      status == sys::napi_status::napi_ok,
      "Threadsafe Function acquire failed"
    );
  }

  /// See [napi_release_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_release_threadsafe_function)
  /// for more information.
  pub fn release(self, mode: ThreadsafeFunctionReleaseMode) {
    let status = unsafe { sys::napi_release_threadsafe_function(self.raw_tsfn, mode.into()) };
    debug_assert!(
      status == sys::napi_status::napi_ok,
      "Threadsafe Function call failed"
    );
  }

  /// See [napi_ref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_ref_threadsafe_function)
  /// for more information.
  ///
  /// "ref" is a keyword so that we use "refer" here.
  pub fn refer(&self, env: &Env) -> Result<()> {
    check_status(unsafe { sys::napi_ref_threadsafe_function(env.0, self.raw_tsfn) })
  }

  /// See [napi_unref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_unref_threadsafe_function)
  /// for more information.
  pub fn unref(&self, env: &Env) -> Result<()> {
    check_status(unsafe { sys::napi_unref_threadsafe_function(env.0, self.raw_tsfn) })
  }
}

unsafe extern "C" fn thread_finalize_cb<T, V: NapiValue<'static>>(
  _raw_env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  // cleanup
  Box::from_raw(finalize_data as *mut ThreadsafeFunction<T, V>);
}

unsafe extern "C" fn call_js_cb<T, V: NapiValue<'static>>(
  raw_env: sys::napi_env,
  js_callback: sys::napi_value,
  context: *mut c_void,
  _data: *mut c_void,
) {
  let env = Env::from_raw(raw_env);
  let mut recv = ptr::null_mut();
  sys::napi_get_undefined(raw_env, &mut recv);

  let tsfn = Box::leak(Box::from_raw(context as *mut ThreadsafeFunction<T, V>));
  let val = mem::replace(&mut tsfn.output, mem::MaybeUninit::zeroed());

  let ret = val.assume_init().and_then(|v| (tsfn.callback)(env, v));

  let status;

  // Follow async callback conventions: https://nodejs.org/en/knowledge/errors/what-are-the-error-conventions/
  // Check if the Result is okay, if so, pass a null as the first (error) argument automatically.
  // If the Result is an error, pass that as the first argument.
  match ret {
    Ok(values) => {
      let mut args: Vec<sys::napi_value> = Vec::with_capacity(values.len() + 1);
      args.push(ptr::null_mut());
      args.extend(values.iter().map(|v| v.raw_value()));
      status = sys::napi_call_function(
        raw_env,
        recv,
        js_callback,
        2,
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
        [e.into_raw(raw_env)].as_mut_ptr(),
        ptr::null_mut(),
      );
    }
  }
  debug_assert!(status == sys::napi_status::napi_ok, "CallJsCB failed");
}
