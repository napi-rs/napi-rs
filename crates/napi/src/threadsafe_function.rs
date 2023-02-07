#![allow(clippy::single_component_path_imports)]

use std::convert::Into;
use std::ffi::CString;
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use crate::bindgen_runtime::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};
use crate::{check_status, sys, Env, JsError, JsUnknown, Result, Status};

/// ThreadSafeFunction Context object
/// the `value` is the value passed to `call` method
pub struct ThreadSafeCallContext<T: 'static> {
  pub env: Env,
  pub value: T,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThreadsafeFunctionCallMode {
  NonBlocking,
  Blocking,
}

impl From<ThreadsafeFunctionCallMode> for sys::napi_threadsafe_function_call_mode {
  fn from(value: ThreadsafeFunctionCallMode) -> Self {
    match value {
      ThreadsafeFunctionCallMode::Blocking => sys::ThreadsafeFunctionCallMode::blocking,
      ThreadsafeFunctionCallMode::NonBlocking => sys::ThreadsafeFunctionCallMode::nonblocking,
    }
  }
}

type_level_enum! {
  /// Type-level `enum` to express how to feed [`ThreadsafeFunction`] errors to
  /// the inner [`JsFunction`].
  ///
  /// ### Context
  ///
  /// For callbacks that expect a `Result`-like kind of input, the convention is
  /// to have the callback take an `error` parameter as its first parameter.
  ///
  /// This way receiving a `Result<Args…>` can be modelled as follows:
  ///
  ///   - In case of `Err(error)`, feed that `error` entity as the first parameter
  ///     of the callback;
  ///
  ///   - Otherwise (in case of `Ok(_)`), feed `null` instead.
  ///
  /// In pseudo-code:
  ///
  /// ```rust,ignore
  /// match result_args {
  ///     Ok(args) => {
  ///         let js_null = /* … */;
  ///         callback.call(
  ///             // this
  ///             None,
  ///             // args…
  ///             &iter::once(js_null).chain(args).collect::<Vec<_>>(),
  ///         )
  ///     },
  ///     Err(err) => callback.call(None, &[JsError::from(err)]),
  /// }
  /// ```
  ///
  /// **Note that the `Err` case can stem from a failed conversion from native
  /// values to js values when calling the callback!**
  ///
  /// That's why:
  ///
  /// > **[This][`ErrorStrategy::CalleeHandled`] is the default error strategy**.
  ///
  /// In order to opt-out of it, [`ThreadsafeFunction`] has an optional second
  /// generic parameter (of "kind" [`ErrorStrategy::T`]) that defines whether
  /// this behavior ([`ErrorStrategy::CalleeHandled`]) or a non-`Result` one
  /// ([`ErrorStrategy::Fatal`]) is desired.
  pub enum ErrorStrategy {
    /// Input errors (including conversion errors) are left for the callee to
    /// handle:
    ///
    /// The callee receives an extra `error` parameter (the first one), which is
    /// `null` if no error occurred, and the error payload otherwise.
    CalleeHandled,

    /// Input errors (including conversion errors) are deemed fatal:
    ///
    /// they can thus cause a `panic!` or abort the process.
    ///
    /// The callee thus is not expected to have to deal with [that extra `error`
    /// parameter][CalleeHandled], which is thus not added.
    Fatal,
  }
}

struct ThreadsafeFunctionHandle {
  raw: sys::napi_threadsafe_function,
  aborted: RwLock<bool>,
  referred: AtomicBool,
}

unsafe impl Send for ThreadsafeFunctionHandle {}
unsafe impl Sync for ThreadsafeFunctionHandle {}

impl Drop for ThreadsafeFunctionHandle {
  fn drop(&mut self) {
    let aborted_guard = self
      .aborted
      .read()
      .expect("Threadsafe Function aborted lock failed");
    if !*aborted_guard && self.referred.load(Ordering::Acquire) {
      let release_status = unsafe {
        sys::napi_release_threadsafe_function(self.raw, sys::ThreadsafeFunctionReleaseMode::release)
      };
      assert!(
        release_status == sys::Status::napi_ok,
        "Threadsafe Function release failed {}",
        Status::from(release_status)
      );
    }
  }
}

#[repr(u8)]
enum ThreadsafeFunctionCallVariant {
  Direct,
  WithCallback,
}

struct ThreadsafeFunctionCallJsBackData<T> {
  data: T,
  call_variant: ThreadsafeFunctionCallVariant,
  callback: Box<dyn FnOnce(JsUnknown) -> Result<()>>,
}

/// Communicate with the addon's main thread by invoking a JavaScript function from other threads.
///
/// ## Example
/// An example of using `ThreadsafeFunction`:
///
/// ```rust
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
///
/// #[js_function(1)]
/// pub fn test_threadsafe_function(ctx: CallContext) -> Result<JsUndefined> {
///   let func = ctx.get::<JsFunction>(0)?;
///
///   let tsfn =
///       ctx
///           .env
///           .create_threadsafe_function(&func, 0, |ctx: ThreadSafeCallContext<Vec<u32>>| {
///             ctx.value
///                 .iter()
///                 .map(|v| ctx.env.create_uint32(*v))
///                 .collect::<Result<Vec<JsNumber>>>()
///           })?;
///
///   let tsfn_cloned = tsfn.clone();
///
///   thread::spawn(move || {
///       let output: Vec<u32> = vec![0, 1, 2, 3];
///       // It's okay to call a threadsafe function multiple times.
///       tsfn.call(Ok(output.clone()), ThreadsafeFunctionCallMode::Blocking);
///   });
///
///   thread::spawn(move || {
///       let output: Vec<u32> = vec![3, 2, 1, 0];
///       // It's okay to call a threadsafe function multiple times.
///       tsfn_cloned.call(Ok(output.clone()), ThreadsafeFunctionCallMode::NonBlocking);
///   });
///
///   ctx.env.get_undefined()
/// }
/// ```
pub struct ThreadsafeFunction<T: 'static, ES: ErrorStrategy::T = ErrorStrategy::CalleeHandled> {
  handle: Arc<ThreadsafeFunctionHandle>,
  _phantom: PhantomData<(T, ES)>,
}

impl<T: 'static, ES: ErrorStrategy::T> Clone for ThreadsafeFunction<T, ES> {
  fn clone(&self) -> Self {
    let aborted_guard = self
      .handle
      .aborted
      .read()
      .expect("Threadsafe Function aborted lock failed");
    if *aborted_guard {
      panic!("ThreadsafeFunction was aborted, can not clone it");
    }

    Self {
      handle: self.handle.clone(),
      _phantom: PhantomData,
    }
  }
}

pub trait JsValuesTupleIntoVec {
  fn into_vec(self, env: &Env) -> Result<Vec<JsUnknown>>;
}

impl<T: ToNapiValue> JsValuesTupleIntoVec for T {
  fn into_vec(self, env: &Env) -> Result<Vec<JsUnknown>> {
    Ok(vec![JsUnknown(crate::Value {
      env: env.0,
      value: unsafe { <T as ToNapiValue>::to_napi_value(env.0, self)? },
      value_type: crate::ValueType::Unknown,
    })])
  }
}

macro_rules! impl_js_value_tuple_to_vec {
  ($($ident:ident),*) => {
    impl<$($ident: ToNapiValue),*> JsValuesTupleIntoVec for ($($ident,)*) {
      fn into_vec(self, env: &Env) -> Result<Vec<JsUnknown>> {
        #[allow(non_snake_case)]
        let ($($ident,)*) = self;
        Ok(vec![$(JsUnknown($crate::Value {
          env: env.0,
          value: unsafe { <$ident as ToNapiValue>::to_napi_value(env.0, $ident)? },
          value_type: $crate::ValueType::Unknown,
        })),*])
      }
    }
  };
}

impl_js_value_tuple_to_vec!(A);
impl_js_value_tuple_to_vec!(A, B);
impl_js_value_tuple_to_vec!(A, B, C);
impl_js_value_tuple_to_vec!(A, B, C, D);
impl_js_value_tuple_to_vec!(A, B, C, D, E);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W);
impl_js_value_tuple_to_vec!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X);
impl_js_value_tuple_to_vec!(
  A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y
);
impl_js_value_tuple_to_vec!(
  A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z
);

impl<T: JsValuesTupleIntoVec + 'static, ES: ErrorStrategy::T> FromNapiValue
  for ThreadsafeFunction<T, ES>
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Self::create(env, napi_val, 0, |ctx| ctx.value.into_vec(&ctx.env))
  }
}

impl<T: 'static, ES: ErrorStrategy::T> ThreadsafeFunction<T, ES> {
  /// See [napi_create_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_create_threadsafe_function)
  /// for more information.
  pub(crate) fn create<
    V: ToNapiValue,
    R: 'static + Send + FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>,
  >(
    env: sys::napi_env,
    func: sys::napi_value,
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

    let mut raw_tsfn = ptr::null_mut();
    let callback_ptr = Box::into_raw(Box::new(callback));
    check_status!(unsafe {
      sys::napi_create_threadsafe_function(
        env,
        func,
        ptr::null_mut(),
        async_resource_name,
        max_queue_size,
        1,
        ptr::null_mut(),
        Some(thread_finalize_cb::<T, V, R>),
        callback_ptr.cast(),
        Some(call_js_cb::<T, V, R, ES>),
        &mut raw_tsfn,
      )
    })?;

    Ok(ThreadsafeFunction {
      handle: Arc::new(ThreadsafeFunctionHandle {
        raw: raw_tsfn,
        aborted: RwLock::new(false),
        referred: AtomicBool::new(true),
      }),
      _phantom: PhantomData,
    })
  }

  /// See [napi_ref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_ref_threadsafe_function)
  /// for more information.
  ///
  /// "ref" is a keyword so that we use "refer" here.
  pub fn refer(&mut self, env: &Env) -> Result<()> {
    let aborted_guard = self
      .handle
      .aborted
      .read()
      .expect("Threadsafe Function aborted lock failed");
    if !*aborted_guard && !self.handle.referred.load(Ordering::Acquire) {
      check_status!(unsafe { sys::napi_ref_threadsafe_function(env.0, self.handle.raw) })?;
      self.handle.referred.store(true, Ordering::Release);
    }
    Ok(())
  }

  /// See [napi_unref_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_unref_threadsafe_function)
  /// for more information.
  pub fn unref(&mut self, env: &Env) -> Result<()> {
    let aborted_guard = self
      .handle
      .aborted
      .read()
      .expect("Threadsafe Function aborted lock failed");
    if !*aborted_guard && self.handle.referred.load(Ordering::Acquire) {
      check_status!(unsafe { sys::napi_unref_threadsafe_function(env.0, self.handle.raw) })?;
      self.handle.referred.store(false, Ordering::Release);
    }
    Ok(())
  }

  pub fn aborted(&self) -> bool {
    let aborted_guard = self
      .handle
      .aborted
      .read()
      .expect("Threadsafe Function aborted lock failed");
    *aborted_guard
  }

  pub fn abort(self) -> Result<()> {
    let mut aborted_guard = self
      .handle
      .aborted
      .write()
      .expect("Threadsafe Function aborted lock failed");
    if !*aborted_guard {
      check_status!(unsafe {
        sys::napi_release_threadsafe_function(
          self.handle.raw,
          sys::ThreadsafeFunctionReleaseMode::abort,
        )
      })?;
      *aborted_guard = true;
    }
    Ok(())
  }

  /// Get the raw `ThreadSafeFunction` pointer
  pub fn raw(&self) -> sys::napi_threadsafe_function {
    self.handle.raw
  }
}

impl<T: 'static> ThreadsafeFunction<T, ErrorStrategy::CalleeHandled> {
  /// See [napi_call_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_call_threadsafe_function)
  /// for more information.
  pub fn call(&self, value: Result<T>, mode: ThreadsafeFunctionCallMode) -> Status {
    unsafe {
      sys::napi_call_threadsafe_function(
        self.handle.raw,
        Box::into_raw(Box::new(value.map(|data| {
          ThreadsafeFunctionCallJsBackData {
            data,
            call_variant: ThreadsafeFunctionCallVariant::Direct,
            callback: Box::new(|_d: JsUnknown| Ok(())),
          }
        })))
        .cast(),
        mode.into(),
      )
    }
    .into()
  }

  pub fn call_with_return_value<D: FromNapiValue, F: 'static + FnOnce(D) -> Result<()>>(
    &self,
    value: Result<T>,
    mode: ThreadsafeFunctionCallMode,
    cb: F,
  ) -> Status {
    unsafe {
      sys::napi_call_threadsafe_function(
        self.handle.raw,
        Box::into_raw(Box::new(value.map(|data| {
          ThreadsafeFunctionCallJsBackData {
            data,
            call_variant: ThreadsafeFunctionCallVariant::WithCallback,
            callback: Box::new(move |d: JsUnknown| {
              D::from_napi_value(d.0.env, d.0.value).and_then(cb)
            }),
          }
        })))
        .cast(),
        mode.into(),
      )
    }
    .into()
  }

  #[cfg(feature = "tokio_rt")]
  pub async fn call_async<D: 'static + FromNapiValue>(&self, value: Result<T>) -> Result<D> {
    let (sender, receiver) = tokio::sync::oneshot::channel::<D>();
    check_status!(unsafe {
      sys::napi_call_threadsafe_function(
        self.handle.raw,
        Box::into_raw(Box::new(value.map(|data| {
          ThreadsafeFunctionCallJsBackData {
            data,
            call_variant: ThreadsafeFunctionCallVariant::WithCallback,
            callback: Box::new(move |d: JsUnknown| {
              D::from_napi_value(d.0.env, d.0.value).and_then(move |d| {
                sender.send(d).map_err(|_| {
                  crate::Error::from_reason("Failed to send return value to tokio sender")
                })
              })
            }),
          }
        })))
        .cast(),
        ThreadsafeFunctionCallMode::NonBlocking.into(),
      )
    })?;
    receiver
      .await
      .map_err(|err| crate::Error::new(Status::GenericFailure, format!("{}", err)))
  }
}

impl<T: 'static> ThreadsafeFunction<T, ErrorStrategy::Fatal> {
  /// See [napi_call_threadsafe_function](https://nodejs.org/api/n-api.html#n_api_napi_call_threadsafe_function)
  /// for more information.
  pub fn call(&self, value: T, mode: ThreadsafeFunctionCallMode) -> Status {
    unsafe {
      sys::napi_call_threadsafe_function(
        self.handle.raw,
        Box::into_raw(Box::new(ThreadsafeFunctionCallJsBackData {
          data: value,
          call_variant: ThreadsafeFunctionCallVariant::Direct,
          callback: Box::new(|_d: JsUnknown| Ok(())),
        }))
        .cast(),
        mode.into(),
      )
    }
    .into()
  }

  pub fn call_with_return_value<D: FromNapiValue, F: 'static + FnOnce(D) -> Result<()>>(
    &self,
    value: T,
    mode: ThreadsafeFunctionCallMode,
    cb: F,
  ) -> Status {
    unsafe {
      sys::napi_call_threadsafe_function(
        self.handle.raw,
        Box::into_raw(Box::new(ThreadsafeFunctionCallJsBackData {
          data: value,
          call_variant: ThreadsafeFunctionCallVariant::WithCallback,
          callback: Box::new(move |d: JsUnknown| {
            D::from_napi_value(d.0.env, d.0.value).and_then(cb)
          }),
        }))
        .cast(),
        mode.into(),
      )
    }
    .into()
  }

  #[cfg(feature = "tokio_rt")]
  pub async fn call_async<D: 'static + FromNapiValue>(&self, value: T) -> Result<D> {
    let (sender, receiver) = tokio::sync::oneshot::channel::<D>();
    check_status!(unsafe {
      sys::napi_call_threadsafe_function(
        self.handle.raw,
        Box::into_raw(Box::new(ThreadsafeFunctionCallJsBackData {
          data: value,
          call_variant: ThreadsafeFunctionCallVariant::WithCallback,
          callback: Box::new(move |d: JsUnknown| {
            D::from_napi_value(d.0.env, d.0.value).and_then(move |d| {
              sender.send(d).map_err(|_| {
                crate::Error::from_reason("Failed to send return value to tokio sender")
              })
            })
          }),
        }))
        .cast(),
        ThreadsafeFunctionCallMode::NonBlocking.into(),
      )
    })?;
    receiver
      .await
      .map_err(|err| crate::Error::new(Status::GenericFailure, format!("{}", err)))
  }
}

#[allow(unused_variables)]
unsafe extern "C" fn thread_finalize_cb<T: 'static, V: ToNapiValue, R>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) where
  R: 'static + Send + FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>,
{
  // cleanup
  drop(unsafe { Box::<R>::from_raw(finalize_hint.cast()) });
}

unsafe extern "C" fn call_js_cb<T: 'static, V: ToNapiValue, R, ES>(
  raw_env: sys::napi_env,
  js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) where
  R: 'static + Send + FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>,
  ES: ErrorStrategy::T,
{
  // env and/or callback can be null when shutting down
  if raw_env.is_null() || js_callback.is_null() {
    return;
  }

  let ctx: &mut R = unsafe { Box::leak(Box::from_raw(context.cast())) };
  let val = unsafe {
    match ES::VALUE {
      ErrorStrategy::CalleeHandled::VALUE => {
        *Box::<Result<ThreadsafeFunctionCallJsBackData<T>>>::from_raw(data.cast())
      }
      ErrorStrategy::Fatal::VALUE => Ok(*Box::<ThreadsafeFunctionCallJsBackData<T>>::from_raw(
        data.cast(),
      )),
    }
  };

  let mut recv = ptr::null_mut();
  unsafe { sys::napi_get_undefined(raw_env, &mut recv) };

  let ret = val.and_then(|v| {
    (ctx)(ThreadSafeCallContext {
      env: unsafe { Env::from_raw(raw_env) },
      value: v.data,
    })
    .map(|ret| (ret, v.call_variant, v.callback))
  });

  // Follow async callback conventions: https://nodejs.org/en/knowledge/errors/what-are-the-error-conventions/
  // Check if the Result is okay, if so, pass a null as the first (error) argument automatically.
  // If the Result is an error, pass that as the first argument.
  let status = match ret {
    Ok((values, call_variant, callback)) => {
      let values = values
        .into_iter()
        .map(|v| unsafe { ToNapiValue::to_napi_value(raw_env, v) });
      let args: Result<Vec<sys::napi_value>> = if ES::VALUE == ErrorStrategy::CalleeHandled::VALUE {
        let mut js_null = ptr::null_mut();
        unsafe { sys::napi_get_null(raw_env, &mut js_null) };
        ::core::iter::once(Ok(js_null)).chain(values).collect()
      } else {
        values.collect()
      };
      let mut return_value = ptr::null_mut();
      let status = match args {
        Ok(args) => unsafe {
          sys::napi_call_function(
            raw_env,
            recv,
            js_callback,
            args.len(),
            args.as_ptr(),
            &mut return_value,
          )
        },
        Err(e) => match ES::VALUE {
          ErrorStrategy::Fatal::VALUE => unsafe {
            sys::napi_fatal_exception(raw_env, JsError::from(e).into_value(raw_env))
          },
          ErrorStrategy::CalleeHandled::VALUE => unsafe {
            sys::napi_call_function(
              raw_env,
              recv,
              js_callback,
              1,
              [JsError::from(e).into_value(raw_env)].as_mut_ptr(),
              &mut return_value,
            )
          },
        },
      };
      if let ThreadsafeFunctionCallVariant::WithCallback = call_variant {
        if let Err(err) = callback(JsUnknown(crate::Value {
          env: raw_env,
          value: return_value,
          value_type: crate::ValueType::Unknown,
        })) {
          let message = format!(
            "Failed to convert return value in ThreadsafeFunction callback into Rust value: {}",
            err
          );
          let message_length = message.len();
          unsafe {
            sys::napi_fatal_error(
              "threadsafe_function.rs:573\0".as_ptr().cast(),
              26,
              CString::new(message).unwrap().into_raw(),
              message_length,
            )
          };
        }
      }
      status
    }
    Err(e) if ES::VALUE == ErrorStrategy::Fatal::VALUE => unsafe {
      sys::napi_fatal_exception(raw_env, JsError::from(e).into_value(raw_env))
    },
    Err(e) => unsafe {
      sys::napi_call_function(
        raw_env,
        recv,
        js_callback,
        1,
        [JsError::from(e).into_value(raw_env)].as_mut_ptr(),
        ptr::null_mut(),
      )
    },
  };
  if status == sys::Status::napi_ok {
    return;
  }
  if status == sys::Status::napi_pending_exception {
    let mut error_result = ptr::null_mut();
    assert_eq!(
      unsafe { sys::napi_get_and_clear_last_exception(raw_env, &mut error_result) },
      sys::Status::napi_ok
    );

    // When shutting down, napi_fatal_exception sometimes returns another exception
    let stat = unsafe { sys::napi_fatal_exception(raw_env, error_result) };
    assert!(stat == sys::Status::napi_ok || stat == sys::Status::napi_pending_exception);
  } else {
    let error_code: Status = status.into();
    let error_code_string = format!("{:?}", error_code);
    let mut error_code_value = ptr::null_mut();
    assert_eq!(
      unsafe {
        sys::napi_create_string_utf8(
          raw_env,
          error_code_string.as_ptr() as *const _,
          error_code_string.len(),
          &mut error_code_value,
        )
      },
      sys::Status::napi_ok,
    );
    let error_msg = "Call JavaScript callback failed in thread safe function";
    let mut error_msg_value = ptr::null_mut();
    assert_eq!(
      unsafe {
        sys::napi_create_string_utf8(
          raw_env,
          error_msg.as_ptr() as *const _,
          error_msg.len(),
          &mut error_msg_value,
        )
      },
      sys::Status::napi_ok,
    );
    let mut error_value = ptr::null_mut();
    assert_eq!(
      unsafe {
        sys::napi_create_error(raw_env, error_code_value, error_msg_value, &mut error_value)
      },
      sys::Status::napi_ok,
    );
    assert_eq!(
      unsafe { sys::napi_fatal_exception(raw_env, error_value) },
      sys::Status::napi_ok
    );
  }
}

/// Helper
macro_rules! type_level_enum {(
  $( #[doc = $doc:tt] )*
  $pub:vis
  enum $EnumName:ident {
    $(
      $( #[doc = $doc_variant:tt] )*
      $Variant:ident
    ),* $(,)?
  }
) => (type_level_enum! { // This requires the macro to be in scope when called.
  with_docs! {
    $( #[doc = $doc] )*
    ///
    /// ### Type-level `enum`
    ///
    /// Until `const_generics` can handle custom `enum`s, this pattern must be
    /// implemented at the type level.
    ///
    /// We thus end up with:
    ///
    /// ```rust,ignore
    /// #[type_level_enum]
    #[doc = ::core::concat!(
      " enum ", ::core::stringify!($EnumName), " {",
    )]
    $(
      #[doc = ::core::concat!(
        "     ", ::core::stringify!($Variant), ",",
      )]
    )*
    #[doc = " }"]
    /// ```
    ///
    #[doc = ::core::concat!(
      "With [`", ::core::stringify!($EnumName), "::T`](#reexports) \
      being the type-level \"enum type\":",
    )]
    ///
    /// ```rust,ignore
    #[doc = ::core::concat!(
      "<Param: ", ::core::stringify!($EnumName), "::T>"
    )]
    /// ```
  }
  #[allow(warnings)]
  $pub mod $EnumName {
    #[doc(no_inline)]
    pub use $EnumName as T;

    super::type_level_enum! {
      with_docs! {
        #[doc = ::core::concat!(
          "See [`", ::core::stringify!($EnumName), "`]\
          [super::", ::core::stringify!($EnumName), "]"
        )]
      }
      pub trait $EnumName : __sealed::$EnumName + ::core::marker::Sized + 'static {
        const VALUE: __value::$EnumName;
      }
    }

    mod __sealed { pub trait $EnumName {} }

    mod __value {
      #[derive(Debug, PartialEq, Eq)]
      pub enum $EnumName { $( $Variant ),* }
    }

    $(
      $( #[doc = $doc_variant] )*
      pub enum $Variant {}
      impl __sealed::$EnumName for $Variant {}
      impl $EnumName for $Variant {
        const VALUE: __value::$EnumName = __value::$EnumName::$Variant;
      }
      impl $Variant {
        pub const VALUE: __value::$EnumName = __value::$EnumName::$Variant;
      }
    )*
  }
});(
  with_docs! {
    $( #[doc = $doc:expr] )*
  }
  $item:item
) => (
  $( #[doc = $doc] )*
  $item
)}

use type_level_enum;

pub struct UnknownReturnValue;

impl TypeName for UnknownReturnValue {
  fn type_name() -> &'static str {
    "UnknownReturnValue"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Unknown
  }
}

impl ValidateNapiValue for UnknownReturnValue {}

impl FromNapiValue for UnknownReturnValue {
  unsafe fn from_napi_value(_env: sys::napi_env, _napi_val: sys::napi_value) -> Result<Self> {
    Ok(UnknownReturnValue)
  }
}
