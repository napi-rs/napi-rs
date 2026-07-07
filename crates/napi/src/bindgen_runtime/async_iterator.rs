use std::ffi::{c_void, CStr};
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::ptr;
#[cfg(not(feature = "noop"))]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures::channel::oneshot::{channel, Receiver};
#[cfg(not(feature = "noop"))]
use futures::FutureExt;

#[cfg(not(feature = "noop"))]
use crate::{bindgen_runtime::Object, JsDeferred, SendableResolver};
use crate::{
  bindgen_runtime::{
    acquire_native_borrow, FromNapiValue, NapiValueOwner, PromiseRaw, ToNapiValue, Unknown,
  },
  check_status, sys, Env, JsError, Value,
};

/// Hidden property name for the GC-visible edge from async iterator callbacks to their owner.
/// This prevents premature garbage collection without creating an uncollectable strong `napi_ref`.
/// See: https://github.com/napi-rs/napi-rs/issues/3119
const INSTANCE_REF_KEY: &CStr = c"[[InstanceRef]]";
const REQUEST_VALUE_KEY: &CStr = c"[[RequestValue]]";

struct AsyncIteratorCallbackData {
  env: sys::napi_env,
  owner_ref: sys::napi_ref,
  state: Arc<AsyncIteratorState>,
}

impl AsyncIteratorCallbackData {
  fn owner_and_generator<T>(&self, env: sys::napi_env) -> crate::Result<(sys::napi_value, *mut T)> {
    let mut owner = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(env, self.owner_ref, &mut owner) },
      "Failed to get async iterator callback owner"
    )?;
    if owner.is_null() {
      return Err(crate::Error::from_reason(
        "Async iterator callback owner was already collected",
      ));
    }

    let mut generator_ptr = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_unwrap(env, owner, &mut generator_ptr) },
      "Failed to unwrap async iterator callback owner"
    )?;
    if generator_ptr.is_null() {
      return Err(crate::Error::from_reason(
        "Async iterator callback owner contained no native generator",
      ));
    }

    Ok((owner, generator_ptr.cast()))
  }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AsyncIteratorRequestMode {
  Next,
  Return,
  Throw,
}

impl AsyncIteratorRequestMode {
  fn closes_immediately(self) -> bool {
    self == Self::Return
  }
}

#[derive(Default)]
struct AsyncIteratorStateInner {
  next_sequence: u64,
  terminal_sequence: Option<u64>,
  tail: Option<Receiver<()>>,
}

#[derive(Default)]
struct AsyncIteratorState {
  inner: Mutex<AsyncIteratorStateInner>,
}

#[cfg_attr(feature = "noop", allow(dead_code))]
struct AsyncIteratorRequest {
  sequence: u64,
  predecessor: Option<Receiver<()>>,
  completion: futures::channel::oneshot::Sender<()>,
}

impl AsyncIteratorState {
  fn reserve(&self, mode: AsyncIteratorRequestMode) -> AsyncIteratorRequest {
    let (completion, tail) = channel();
    let mut inner = self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let sequence = inner.next_sequence;
    inner.next_sequence = inner
      .next_sequence
      .checked_add(1)
      .expect("async iterator request sequence overflow");
    let predecessor = inner.tail.replace(tail);
    if mode.closes_immediately() && inner.terminal_sequence.is_none() {
      inner.terminal_sequence = Some(sequence);
    }
    AsyncIteratorRequest {
      sequence,
      predecessor,
      completion,
    }
  }

  #[cfg_attr(feature = "noop", allow(dead_code))]
  fn should_skip(&self, sequence: u64) -> bool {
    self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .terminal_sequence
      .is_some_and(|terminal_sequence| sequence > terminal_sequence)
  }

  #[cfg_attr(feature = "noop", allow(dead_code))]
  fn close_at(&self, sequence: u64) {
    let mut inner = self
      .inner
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    inner.terminal_sequence = Some(
      inner
        .terminal_sequence
        .map_or(sequence, |terminal_sequence| {
          terminal_sequence.min(sequence)
        }),
    );
  }
}

type AsyncIteratorFuture<T> =
  Pin<Box<dyn Future<Output = crate::Result<Option<T>>> + Send + 'static>>;

type AsyncIteratorSetup<T> =
  Box<dyn FnOnce(Env, bool) -> crate::Result<AsyncIteratorFuture<T>> + 'static>;

#[cfg(not(feature = "noop"))]
type AsyncIteratorDispatchResolver = Box<dyn FnOnce(Env) -> crate::Result<()> + Send + 'static>;

#[cfg(not(feature = "noop"))]
type AsyncIteratorDispatcher = JsDeferred<(), AsyncIteratorDispatchResolver>;

#[cfg(not(feature = "noop"))]
struct AsyncIteratorAdmissionCancellation(Arc<AtomicBool>);

#[cfg(not(feature = "noop"))]
impl Drop for AsyncIteratorAdmissionCancellation {
  fn drop(&mut self) {
    self.0.store(true, Ordering::Release);
  }
}

struct AsyncIteratorValueReference {
  reference: sys::napi_ref,
  owner: NapiValueOwner,
}

impl AsyncIteratorValueReference {
  fn new(env: sys::napi_env, value: sys::napi_value) -> crate::Result<Self> {
    let mut holder = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_object(env, &mut holder) },
      "Failed to create async iterator request value holder"
    )?;
    check_status!(
      unsafe {
        sys::napi_set_named_property(env, holder, REQUEST_VALUE_KEY.as_ptr().cast(), value)
      },
      "Failed to store async iterator request value"
    )?;
    let mut reference = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(env, holder, 1, &mut reference) },
      "Failed to retain async iterator request value"
    )?;
    Ok(Self {
      reference,
      owner: NapiValueOwner::new(env),
    })
  }

  fn value(&self, env: sys::napi_env) -> crate::Result<sys::napi_value> {
    self
      .owner
      .ensure_access(env, "async iterator request value")?;
    let mut holder = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(env, self.reference, &mut holder) },
      "Failed to get retained async iterator request value holder"
    )?;
    if holder.is_null() {
      return Err(crate::Error::from_reason(
        "Async iterator request value holder was already collected",
      ));
    }
    let mut value = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_get_named_property(env, holder, REQUEST_VALUE_KEY.as_ptr().cast(), &mut value)
      },
      "Failed to read retained async iterator request value"
    )?;
    Ok(value)
  }

  fn generator<T>(&self, env: sys::napi_env) -> crate::Result<*mut T> {
    let owner = self.value(env)?;
    let mut generator_ptr = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_unwrap(env, owner, &mut generator_ptr) },
      "Failed to unwrap retained async iterator owner"
    )?;
    if generator_ptr.is_null() {
      return Err(crate::Error::from_reason(
        "Retained async iterator owner contained no native generator",
      ));
    }
    Ok(generator_ptr.cast())
  }
}

impl Drop for AsyncIteratorValueReference {
  fn drop(&mut self) {
    let status = self.owner.release_reference(self.reference);
    debug_assert!(
      status == sys::Status::napi_ok || status == sys::Status::napi_closing,
      "Release async iterator request reference failed: {}",
      crate::Status::from(status)
    );
    self.reference = ptr::null_mut();
  }
}

impl Drop for AsyncIteratorCallbackData {
  fn drop(&mut self) {
    if !self.owner_ref.is_null() {
      unsafe {
        sys::napi_delete_reference(self.env, self.owner_ref);
      }
    }
  }
}

unsafe extern "C" fn finalize_async_iterator_callback(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    crate::bindgen_runtime::catch_unwind_safely(|| unsafe {
      drop(Box::from_raw(
        finalize_data.cast::<AsyncIteratorCallbackData>(),
      ));
    });
  });
}

fn define_instance_ref(
  env: sys::napi_env,
  target: sys::napi_value,
  instance: sys::napi_value,
) -> crate::Result<()> {
  let properties = [sys::napi_property_descriptor {
    utf8name: INSTANCE_REF_KEY.as_ptr().cast(),
    name: ptr::null_mut(),
    method: None,
    getter: None,
    setter: None,
    value: instance,
    attributes: sys::PropertyAttributes::default,
    data: ptr::null_mut(),
  }];

  check_status!(
    unsafe { sys::napi_define_properties(env, target, 1, properties.as_ptr()) },
    "Failed to retain async iterator callback owner"
  )
}

fn create_async_iterator_callback(
  env: sys::napi_env,
  owner: sys::napi_value,
  name: &CStr,
  callback: sys::napi_callback,
  state: Arc<AsyncIteratorState>,
) -> crate::Result<sys::napi_value> {
  // The hidden JS property retains `owner`; this reference stays weak so the
  // owner -> factory function -> owner cycle remains visible and collectible by GC.
  let mut owner_ref = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_reference(env, owner, 0, &mut owner_ref) },
    "Failed to create async iterator callback owner reference"
  )?;

  let mut callback_data = Box::new(AsyncIteratorCallbackData {
    env,
    owner_ref,
    state,
  });
  let callback_data_ptr = callback_data.as_mut() as *mut AsyncIteratorCallbackData;
  let mut function = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_function(
        env,
        name.as_ptr(),
        name.to_bytes().len() as isize,
        callback,
        callback_data_ptr.cast(),
        &mut function,
      )
    },
    "Failed to create async iterator callback"
  )?;

  define_instance_ref(env, function, owner)?;
  // Tie the native callback data and its weak reference to the function's lifetime.
  check_status!(
    unsafe {
      sys::napi_wrap(
        env,
        function,
        callback_data_ptr.cast(),
        Some(finalize_async_iterator_callback),
        ptr::null_mut(),
        ptr::null_mut(),
      )
    },
    "Failed to attach async iterator callback data"
  )?;

  let _ = Box::into_raw(callback_data);
  Ok(function)
}

/// Implement a Iterator for the JavaScript Class.
/// This feature is an experimental feature and is not yet stable.
pub trait AsyncGenerator {
  type Yield: ToNapiValue + Send + 'static;
  type Next: FromNapiValue;
  type Return: FromNapiValue;

  /// Handle the `AsyncGenerator.next()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator/next>
  fn next(
    &mut self,
    value: Option<Self::Next>,
  ) -> impl Future<Output = crate::Result<Option<Self::Yield>>> + Send + 'static;

  #[allow(unused_variables)]
  /// Implement complete to handle the `AsyncGenerator.return()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator/return>
  fn complete(
    &mut self,
    value: Option<Self::Return>,
  ) -> impl Future<Output = crate::Result<Option<Self::Yield>>> + Send + 'static {
    async move { Ok(None) }
  }

  #[allow(unused_variables)]
  /// Implement catch to handle the `AsyncGenerator.throw()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator/throw>
  fn catch(
    &mut self,
    env: Env,
    value: Unknown,
  ) -> impl Future<Output = crate::Result<Option<Self::Yield>>> + Send + 'static {
    let err = crate::Error::from_unknown_without_coercion(value);
    async move { Err(err) }
  }
}

#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn create_async_iterator<T: AsyncGenerator>(
  env: sys::napi_env,
  instance: sys::napi_value,
  _generator_ptr: *mut T,
) {
  if let Err(error) = catch_generator_callback(|| create_async_iterator_impl::<T>(env, instance)) {
    throw_generator_callback_error(env, error);
  }
}

fn create_async_iterator_impl<T: AsyncGenerator>(
  env: sys::napi_env,
  instance: sys::napi_value,
) -> crate::Result<()> {
  let mut global = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_global(env, &mut global) },
    "Get global object failed",
  )?;
  let mut symbol_object = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_named_property(env, global, c"Symbol".as_ptr().cast(), &mut symbol_object)
    },
    "Get global object failed",
  )?;
  let mut iterator_symbol = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_named_property(
        env,
        symbol_object,
        c"asyncIterator".as_ptr().cast(),
        &mut iterator_symbol,
      )
    },
    "Get Symbol.asyncIterator failed",
  )?;
  let generator_function = create_async_iterator_callback(
    env,
    instance,
    c"AsyncIterator",
    Some(symbol_async_generator::<T>),
    Arc::new(AsyncIteratorState::default()),
  )?;
  check_status!(
    unsafe { sys::napi_set_property(env, instance, iterator_symbol, generator_function) },
    "Failed to set Symbol.asyncIterator on class instance",
  )?;
  Ok(())
}

#[doc(hidden)]
pub unsafe extern "C" fn symbol_async_generator<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  match catch_generator_callback(|| unsafe { symbol_async_generator_impl::<T>(env, info) }) {
    Ok(value) => value,
    Err(error) => {
      throw_generator_callback_error(env, error);
      ptr::null_mut()
    }
  }
}

fn throw_generator_callback_error(env: sys::napi_env, error: crate::Error) {
  let mut is_pending = false;
  if unsafe { sys::napi_is_exception_pending(env, &mut is_pending) } != sys::Status::napi_ok
    || !is_pending
  {
    unsafe { JsError::from(error).throw_into(env) };
  }
}

unsafe fn symbol_async_generator_impl<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut argc = 0;
  let mut callback_data = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        ptr::null_mut(),
        ptr::null_mut(),
        &mut callback_data,
      )
    },
    "Get callback info from generator function failed"
  )?;
  let callback_data = unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
    .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?;
  let (owner, _generator_ptr) = callback_data.owner_and_generator::<T>(env)?;
  let state = Arc::clone(&callback_data.state);

  let mut generator_object = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_object(env, &mut generator_object) },
    "Create Generator object failed"
  )?;
  let next_function = create_async_iterator_callback(
    env,
    owner,
    c"next",
    Some(generator_next::<T>),
    Arc::clone(&state),
  )?;
  let return_function = create_async_iterator_callback(
    env,
    owner,
    c"return",
    Some(generator_return::<T>),
    Arc::clone(&state),
  )?;
  let throw_function =
    create_async_iterator_callback(env, owner, c"throw", Some(generator_throw::<T>), state)?;

  check_status!(
    unsafe {
      sys::napi_set_named_property(
        env,
        generator_object,
        c"next".as_ptr().cast(),
        next_function,
      )
    },
    "Set next function on Generator object failed"
  )?;

  check_status!(
    unsafe {
      sys::napi_set_named_property(
        env,
        generator_object,
        c"return".as_ptr().cast(),
        return_function,
      )
    },
    "Set return function on Generator object failed"
  )?;

  check_status!(
    unsafe {
      sys::napi_set_named_property(
        env,
        generator_object,
        c"throw".as_ptr().cast(),
        throw_function,
      )
    },
    "Set throw function on Generator object failed"
  )?;

  define_instance_ref(env, generator_object, owner)?;

  Ok(generator_object)
}

extern "C" fn generator_next<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  generator_callback(env, || generator_next_fn::<T>(env, info))
}

fn generator_callback(
  env: sys::napi_env,
  callback: impl FnOnce() -> crate::Result<sys::napi_value>,
) -> sys::napi_value {
  match catch_generator_callback(callback) {
    Ok(value) => value,
    Err(error) => match catch_generator_callback(|| reject_generator_callback(env, error)) {
      Ok(value) => value,
      Err(error) => unsafe {
        let js_error: JsError = error.into();
        js_error.throw_into(env);
        ptr::null_mut()
      },
    },
  }
}

fn reject_generator_callback(
  env: sys::napi_env,
  error: crate::Error,
) -> crate::Result<sys::napi_value> {
  // Promise creation is not allowed while an exception is pending. Preserve that
  // exact JS value by taking it before creating the rejected Promise.
  let mut is_pending = false;
  check_status!(
    unsafe { sys::napi_is_exception_pending(env, &mut is_pending) },
    "Failed to check for a pending async generator exception"
  )?;

  let env = Env::from_raw(env);
  let promise = if is_pending {
    let mut exception = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_and_clear_last_exception(env.0, &mut exception) },
      "Failed to get and clear a pending async generator exception"
    )?;
    PromiseRaw::<()>::reject_raw(&env, exception)?
  } else {
    PromiseRaw::<()>::reject(&env, error)?
  };

  Ok(promise.inner)
}

fn catch_generator_callback<T>(callback: impl FnOnce() -> crate::Result<T>) -> crate::Result<T> {
  std::panic::catch_unwind(AssertUnwindSafe(callback))
    .map_err(crate::bindgen_runtime::panic_to_error)?
}

#[cfg(not(feature = "noop"))]
fn take_generator_pending_exception(env: sys::napi_env) -> crate::Result<Option<crate::Error>> {
  let mut is_pending = false;
  check_status!(
    unsafe { sys::napi_is_exception_pending(env, &mut is_pending) },
    "Failed to check for a pending async generator exception"
  )?;
  if !is_pending {
    return Ok(None);
  }

  let mut exception = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_and_clear_last_exception(env, &mut exception) },
    "Failed to get and clear a pending async generator exception"
  )?;
  Ok(Some(crate::Error::from_unknown_without_coercion(Unknown(
    Value {
      env,
      value: exception,
      value_type: crate::ValueType::Unknown,
    },
    std::marker::PhantomData,
  ))))
}

#[cfg(test)]
fn generator_argument<T: FromNapiValue>(
  env: sys::napi_env,
  argc: usize,
  value: sys::napi_value,
) -> crate::Result<Option<T>> {
  if argc == 0 {
    Ok(None)
  } else {
    unsafe { T::from_napi_value(env, value) }.map(Some)
  }
}

#[cfg(test)]
fn with_generator_argument<T: FromNapiValue, U>(
  env: sys::napi_env,
  argc: usize,
  value: sys::napi_value,
  callback: impl FnOnce(Option<T>) -> U,
) -> crate::Result<U> {
  Ok(callback(generator_argument::<T>(env, argc, value)?))
}

#[cfg(not(feature = "noop"))]
fn async_iterator_result_to_napi<T: ToNapiValue>(
  env: sys::napi_env,
  value: Option<T>,
  mode: AsyncIteratorRequestMode,
) -> crate::Result<sys::napi_value> {
  let env_wrapper = Env::from_raw(env);
  let mut obj = Object::new(&env_wrapper)?;
  match mode {
    AsyncIteratorRequestMode::Next => {
      if let Some(value) = value {
        obj.set("value", value)?;
        obj.set("done", false)?;
      } else {
        obj.set("value", ())?;
        obj.set("done", true)?;
      }
    }
    AsyncIteratorRequestMode::Return => {
      if let Some(value) = value {
        obj.set("value", value)?;
      } else {
        obj.set("value", ())?;
      }
      obj.set("done", true)?;
    }
    AsyncIteratorRequestMode::Throw => {
      obj.set("value", value)?;
      obj.set("done", false)?;
    }
  }
  unsafe { ToNapiValue::to_napi_value(env, obj) }
}

#[cfg(not(feature = "noop"))]
fn spawn_async_iterator_request<T: ToNapiValue + Send + 'static>(
  env: sys::napi_env,
  state: Arc<AsyncIteratorState>,
  mode: AsyncIteratorRequestMode,
  setup: AsyncIteratorSetup<T>,
) -> crate::Result<sys::napi_value> {
  let (dispatcher, _dispatch_promise) = AsyncIteratorDispatcher::new(&Env::from_raw(env))?;
  let request = state.reserve(mode);
  let sequence = request.sequence;
  let (admission_sender, admission_receiver) = channel::<crate::Result<AsyncIteratorFuture<T>>>();
  let admission_gate = Arc::new(AtomicBool::new(false));
  let dispatch_admission_gate = Arc::clone(&admission_gate);
  let admission = SendableResolver::new_for_env(
    env,
    Box::new(move |env, should_skip| {
      if dispatch_admission_gate.swap(true, Ordering::AcqRel) {
        let _ = admission_sender.send(Err(crate::Error::new(
          crate::Status::Cancelled,
          "Async iterator request admission was cancelled because its runtime stopped",
        )));
        return Ok(ptr::null_mut());
      }
      let result = catch_generator_callback(|| setup(Env::from_raw(env), should_skip));
      let result = match take_generator_pending_exception(env) {
        Ok(Some(error)) => Err(error),
        Ok(None) => result,
        Err(error) => Err(error),
      };
      let _ = admission_sender.send(result);
      Ok(ptr::null_mut())
    }) as Box<dyn FnOnce(sys::napi_env, bool) -> crate::Result<sys::napi_value> + 'static>,
  );
  let request_state = Arc::clone(&state);
  let future = async move {
    let _admission_cancellation = AsyncIteratorAdmissionCancellation(admission_gate);
    if let Some(predecessor) = request.predecessor {
      let _ = predecessor.await;
    }

    let should_skip = request_state.should_skip(sequence);
    dispatcher.resolve(Box::new(move |env| {
      let _ = admission.resolve(env.raw(), should_skip);
      Ok(())
    }));
    let item = admission_receiver.await.map_err(|_| {
      crate::Error::new(
        crate::Status::Cancelled,
        "Async iterator request admission was cancelled because its Node environment closed",
      )
    })??;

    let result = AssertUnwindSafe(item)
      .catch_unwind()
      .await
      .map_err(crate::bindgen_runtime::panic_to_error)
      .and_then(|result| result);
    result
  };

  let request_keeps_iterator_open = Arc::new(AtomicBool::new(false));
  let resolver_keeps_iterator_open = Arc::clone(&request_keeps_iterator_open);
  let finalize_state = Arc::clone(&state);
  crate::tokio_runtime::execute_tokio_future_with_finalize_callback(
    env,
    future,
    move |env, value| {
      let keeps_iterator_open = match mode {
        AsyncIteratorRequestMode::Next => value.is_some(),
        AsyncIteratorRequestMode::Return => false,
        AsyncIteratorRequestMode::Throw => true,
      };
      let result = async_iterator_result_to_napi(env, value, mode);
      if result.is_ok() && keeps_iterator_open {
        resolver_keeps_iterator_open.store(true, Ordering::Release);
      }
      result
    },
    Some(Box::new(move |_| {
      if !request_keeps_iterator_open.load(Ordering::Acquire) {
        finalize_state.close_at(sequence);
      }
      let _ = request.completion.send(());
    })),
  )
}

#[cfg(feature = "noop")]
fn spawn_async_iterator_request<T: ToNapiValue + Send + 'static>(
  _env: sys::napi_env,
  state: Arc<AsyncIteratorState>,
  mode: AsyncIteratorRequestMode,
  setup: AsyncIteratorSetup<T>,
) -> crate::Result<sys::napi_value> {
  let request = state.reserve(mode);
  drop(setup);
  let _ = request.completion.send(());
  Ok(ptr::null_mut())
}

fn generator_next_fn<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut callback_data = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        ptr::null_mut(),
        &mut callback_data,
      )
    },
    "Get callback info from generator function failed"
  )?;

  let callback_data = unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
    .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?;
  let state = Arc::clone(&callback_data.state);
  let (owner, _generator_ptr) = callback_data.owner_and_generator::<T>(env)?;
  let owner = AsyncIteratorValueReference::new(env, owner)?;
  let argument = if argc == 0 {
    None
  } else {
    Some(AsyncIteratorValueReference::new(env, argv[0])?)
  };
  let setup: AsyncIteratorSetup<T::Yield> = Box::new(move |env, should_skip| {
    if should_skip {
      return Ok(Box::pin(async { Ok(None) }));
    }
    let value = match argument {
      Some(argument) => {
        Some(unsafe { T::Next::from_napi_value(env.raw(), argument.value(env.raw())?) }?)
      }
      None => None,
    };
    let generator_ptr = owner.generator::<T>(env.raw())?;
    let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
    let g = unsafe { &mut *generator_ptr };
    Ok(Box::pin(g.next(value)))
  });

  spawn_async_iterator_request(env, state, AsyncIteratorRequestMode::Next, setup)
}

extern "C" fn generator_return<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  generator_callback(env, || generator_return_fn::<T>(env, info))
}

fn generator_return_fn<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut callback_data = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        ptr::null_mut(),
        &mut callback_data,
      )
    },
    "Get callback info from generator function failed"
  )?;

  let callback_data = unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
    .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?;
  let state = Arc::clone(&callback_data.state);
  let (owner, _generator_ptr) = callback_data.owner_and_generator::<T>(env)?;
  let owner = AsyncIteratorValueReference::new(env, owner)?;
  let argument = if argc == 0 {
    None
  } else {
    Some(AsyncIteratorValueReference::new(env, argv[0])?)
  };
  let setup: AsyncIteratorSetup<T::Yield> = Box::new(move |env, should_skip| {
    if should_skip {
      return Ok(Box::pin(async { Ok(None) }));
    }
    let value = match argument {
      Some(argument) => {
        Some(unsafe { T::Return::from_napi_value(env.raw(), argument.value(env.raw())?) }?)
      }
      None => None,
    };
    let generator_ptr = owner.generator::<T>(env.raw())?;
    let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
    let g = unsafe { &mut *generator_ptr };
    Ok(Box::pin(g.complete(value)))
  });

  spawn_async_iterator_request(env, state, AsyncIteratorRequestMode::Return, setup)
}

extern "C" fn generator_throw<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  generator_callback(env, || generator_throw_fn::<T>(env, info))
}

fn generator_throw_fn<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut callback_data = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        ptr::null_mut(),
        &mut callback_data,
      )
    },
    "Get callback info from generator function failed"
  )?;

  let callback_data = unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
    .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?;
  let state = Arc::clone(&callback_data.state);
  let (owner, _generator_ptr) = callback_data.owner_and_generator::<T>(env)?;
  let owner = AsyncIteratorValueReference::new(env, owner)?;
  let argument = if argc == 0 {
    None
  } else {
    Some(AsyncIteratorValueReference::new(env, argv[0])?)
  };
  let setup: AsyncIteratorSetup<T::Yield> = Box::new(move |env, should_skip| {
    let value = if let Some(argument) = argument {
      Unknown(
        Value {
          env: env.raw(),
          value: argument.value(env.raw())?,
          value_type: crate::ValueType::Unknown,
        },
        std::marker::PhantomData,
      )
    } else {
      let mut undefined = ptr::null_mut();
      check_status!(
        unsafe { sys::napi_get_undefined(env.raw(), &mut undefined) },
        "Get undefined failed"
      )?;
      Unknown(
        Value {
          env: env.raw(),
          value: undefined,
          value_type: crate::ValueType::Undefined,
        },
        std::marker::PhantomData,
      )
    };
    if should_skip {
      let error = crate::Error::from_unknown_without_coercion(value);
      return Ok(Box::pin(async move { Err(error) }));
    }
    let generator_ptr = owner.generator::<T>(env.raw())?;
    let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
    let g = unsafe { &mut *generator_ptr };
    Ok(Box::pin(g.catch(env, value)))
  });

  spawn_async_iterator_request(env, state, AsyncIteratorRequestMode::Throw, setup)
}

#[cfg(test)]
mod tests {
  use std::sync::atomic::{AtomicUsize, Ordering};

  use super::*;

  struct RejectingArgument;

  impl FromNapiValue for RejectingArgument {
    unsafe fn from_napi_value(
      _env: sys::napi_env,
      _napi_val: sys::napi_value,
    ) -> crate::Result<Self> {
      Err(crate::Error::new(
        crate::Status::InvalidArg,
        "rejected async generator argument",
      ))
    }
  }

  #[test]
  fn callback_panics_become_errors() {
    let error = catch_generator_callback(|| -> crate::Result<()> {
      panic!("async generator callback panic");
    })
    .expect_err("callback panic must be converted into a napi error");

    assert!(error.reason.contains("async generator callback panic"));
  }

  #[test]
  fn invalid_next_argument_does_not_call_generator() {
    let next_calls = AtomicUsize::new(0);

    let error =
      with_generator_argument::<RejectingArgument, _>(ptr::null_mut(), 1, ptr::null_mut(), |_| {
        next_calls.fetch_add(1, Ordering::SeqCst)
      })
      .expect_err("invalid arguments must stop before calling AsyncGenerator::next");

    assert_eq!(error.status, crate::Status::InvalidArg);
    assert_eq!(next_calls.load(Ordering::SeqCst), 0);
  }
}
