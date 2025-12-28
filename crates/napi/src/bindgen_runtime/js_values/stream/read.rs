use std::{
  ffi::c_void,
  marker::PhantomData,
  mem,
  pin::Pin,
  ptr,
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, RwLock,
  },
  task::{Context, Poll},
};

use tokio::sync::Mutex;

use futures_core::Stream;
use tokio_stream::StreamExt;

use crate::{
  bindgen_prelude::{
    BufferSlice, CallbackContext, FromNapiValue, Function, JsObjectValue, Object, PromiseRaw,
    ToNapiValue, TypeName, Unknown, ValidateNapiValue, NAPI_AUTO_LENGTH,
  },
  check_status, sys,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Env, Error, JsError, JsValue, Result, Status, Value, ValueType,
};

pub struct ReadableStream<'env, T> {
  pub(crate) value: sys::napi_value,
  pub(crate) env: sys::napi_env,
  _marker: PhantomData<&'env T>,
}

impl<'env, T> JsValue<'env> for ReadableStream<'env, T> {
  fn value(&self) -> Value {
    Value {
      env: self.env,
      value: self.value,
      value_type: ValueType::Object,
    }
  }
}

impl<'env, T> JsObjectValue<'env> for ReadableStream<'env, T> {}

impl<T> TypeName for ReadableStream<'_, T> {
  fn type_name() -> &'static str {
    "ReadableStream"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl<T> ValidateNapiValue for ReadableStream<'_, T> {
  unsafe fn validate(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> Result<napi_sys::napi_value> {
    let constructor = Env::from(env)
      .get_global()?
      .get_named_property_unchecked::<Function>("ReadableStream")?;
    let mut is_instance = false;
    check_status!(
      unsafe { sys::napi_instanceof(env, napi_val, constructor.value, &mut is_instance) },
      "Check ReadableStream instance failed"
    )?;
    if !is_instance {
      return Err(Error::new(
        Status::InvalidArg,
        "Value is not a ReadableStream",
      ));
    }
    Ok(ptr::null_mut())
  }
}

impl<T> FromNapiValue for ReadableStream<'_, T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Self {
      value: napi_val,
      env,
      _marker: PhantomData,
    })
  }
}

impl<T> ReadableStream<'_, T> {
  /// Returns a boolean indicating whether the readable stream is locked to a reader.
  pub fn locked(&self) -> Result<bool> {
    let mut locked = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_get_named_property(self.env, self.value, c"locked".as_ptr().cast(), &mut locked)
      },
      "Get locked property failed"
    )?;
    unsafe { FromNapiValue::from_napi_value(self.env, locked) }
  }

  /// The `cancel()` method of the `ReadableStream` interface returns a Promise that resolves when the stream is canceled.
  pub fn cancel(&mut self, reason: Option<String>) -> Result<PromiseRaw<'_, ()>> {
    let mut cancel_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_get_named_property(
          self.env,
          self.value,
          c"abort".as_ptr().cast(),
          &mut cancel_fn,
        )
      },
      "Get abort property failed"
    )?;
    let reason_value = unsafe { ToNapiValue::to_napi_value(self.env, reason)? };
    let mut promise = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_call_function(
          self.env,
          self.value,
          cancel_fn,
          1,
          [reason_value].as_ptr(),
          &mut promise,
        )
      },
      "Call abort function failed"
    )?;
    Ok(PromiseRaw::new(self.env, promise))
  }
}

impl<T: FromNapiValue> ReadableStream<'_, T> {
  pub fn read(&self) -> Result<Reader<T>> {
    let mut reader_function = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_get_named_property(
          self.env,
          self.value,
          c"getReader".as_ptr().cast(),
          &mut reader_function,
        )
      },
      "Get getReader on ReadableStream failed"
    )?;
    let mut reader = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_call_function(
          self.env,
          self.value,
          reader_function,
          0,
          ptr::null_mut(),
          &mut reader,
        )
      },
      "Call getReader on ReadableStreamReader failed"
    )?;
    let mut read_function = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_get_named_property(
          self.env,
          reader,
          c"read".as_ptr().cast(),
          &mut read_function,
        )
      },
      "Get read from ReadableStreamDefaultReader failed"
    )?;
    let mut bind_function = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_get_named_property(
          self.env,
          read_function,
          c"bind".as_ptr().cast(),
          &mut bind_function,
        )
      },
      "Get bind from ReadableStreamDefaultReader::read failed"
    )?;
    let mut bind_read = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_call_function(
          self.env,
          read_function,
          bind_function,
          1,
          [reader].as_ptr(),
          &mut bind_read,
        )
      },
      "Call bind from ReadableStreamDefaultReader::read failed"
    )?;
    let read_function = unsafe {
      Function::<(), PromiseRaw<IteratorValue<T>>>::from_napi_value(self.env, bind_read)?
    }
    .build_threadsafe_function()
    .callee_handled::<true>()
    .weak::<true>()
    .build()?;
    Ok(Reader {
      inner: read_function,
      state: Arc::new((RwLock::new(Ok(None)), AtomicBool::new(false))),
    })
  }
}

impl<T: ToNapiValue + Send + 'static> ReadableStream<'_, T> {
  pub fn new<S: Stream<Item = Result<T>> + Unpin + Send + 'static>(
    env: &Env,
    inner: S,
  ) -> Result<Self> {
    let global = env.get_global()?;
    let constructor = global.get_named_property_unchecked::<Unknown>("ReadableStream")?;
    if constructor.get_type()? == ValueType::Undefined {
      return Err(Error::new(
        Status::GenericFailure,
        "ReadableStream is not supported in this Node.js version",
      ));
    }

    // Create shared state for the stream
    let state = StreamState::new(inner);
    let state_ptr = Arc::into_raw(state) as *mut c_void;

    let mut underlying_source = Object::new(env)?;

    // Create pull callback
    let mut pull_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"pull".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(pull_callback::<T, S>),
          state_ptr,
          &mut pull_fn,
        )
      },
      "Failed to create pull function"
    )?;
    underlying_source.set_named_property("pull", pull_fn)?;

    // Create cancel callback for cleanup
    let mut cancel_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"cancel".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(cancel_callback::<S>),
          state_ptr,
          &mut cancel_fn,
        )
      },
      "Failed to create cancel function"
    )?;
    underlying_source.set_named_property("cancel", cancel_fn)?;

    let mut stream = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_new_instance(
          env.0,
          constructor.0.value,
          1,
          [underlying_source.0.value].as_ptr(),
          &mut stream,
        )
      },
      "Create ReadableStream instance failed"
    )?;
    Ok(Self {
      value: stream,
      env: env.0,
      _marker: PhantomData,
    })
  }

  /// Creates a new `ReadableStream` with the given `stream` and `ReadableStream` class.
  ///
  /// This is useful if the runtime only supports Node-API 4 but doesn't support the WebStream API.
  ///
  /// Node-API 4 was initially introduced in `v10.16.0` and WebStream was introduced in `v16.5.0`.
  pub fn with_readable_stream_class<S: Stream<Item = Result<T>> + Unpin + Send + 'static>(
    env: &Env,
    readable_stream_class: &Unknown,
    inner: S,
  ) -> Result<Self> {
    if readable_stream_class.get_type()? == ValueType::Undefined {
      return Err(Error::new(
        Status::GenericFailure,
        "ReadableStream is not supported in this Node.js version",
      ));
    }

    // Create shared state for the stream
    let state = StreamState::new(inner);
    let state_ptr = Arc::into_raw(state) as *mut c_void;

    let mut underlying_source = Object::new(env)?;

    // Create pull callback
    let mut pull_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"pull".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(pull_callback::<T, S>),
          state_ptr,
          &mut pull_fn,
        )
      },
      "Failed to create pull function"
    )?;
    underlying_source.set_named_property("pull", pull_fn)?;

    // Create cancel callback for cleanup
    let mut cancel_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"cancel".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(cancel_callback::<S>),
          state_ptr,
          &mut cancel_fn,
        )
      },
      "Failed to create cancel function"
    )?;
    underlying_source.set_named_property("cancel", cancel_fn)?;

    let mut stream = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_new_instance(
          env.0,
          readable_stream_class.0.value,
          1,
          [underlying_source.0.value].as_ptr(),
          &mut stream,
        )
      },
      "Create ReadableStream instance failed"
    )?;
    Ok(Self {
      value: stream,
      env: env.0,
      _marker: PhantomData,
    })
  }
}

impl<'env> ReadableStream<'env, BufferSlice<'env>> {
  /// Creates a new `ReadableStream` with the given `stream` that emits bytes.
  pub fn create_with_stream_bytes<
    B: Into<Vec<u8>>,
    S: Stream<Item = Result<B>> + Unpin + Send + 'static,
  >(
    env: &Env,
    inner: S,
  ) -> Result<Self> {
    let global = env.get_global()?;
    let constructor = global.get_named_property_unchecked::<Function>("ReadableStream")?;

    // Create shared state for the stream
    let state = StreamState::new(inner);
    let state_ptr = Arc::into_raw(state) as *mut c_void;

    let mut underlying_source = Object::new(env)?;

    // Create pull callback
    let mut pull_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"pull".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(pull_callback_bytes::<B, S>),
          state_ptr,
          &mut pull_fn,
        )
      },
      "Failed to create pull function"
    )?;
    underlying_source.set_named_property("pull", pull_fn)?;

    // Create cancel callback for cleanup
    let mut cancel_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"cancel".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(cancel_callback::<S>),
          state_ptr,
          &mut cancel_fn,
        )
      },
      "Failed to create cancel function"
    )?;
    underlying_source.set_named_property("cancel", cancel_fn)?;

    underlying_source.set("type", "bytes")?;
    let mut stream = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_new_instance(
          env.0,
          constructor.value,
          1,
          [underlying_source.0.value].as_ptr(),
          &mut stream,
        )
      },
      "Create ReadableStream instance failed"
    )?;
    Ok(Self {
      value: stream,
      env: env.0,
      _marker: PhantomData,
    })
  }

  /// create a new `ReadableStream` with the given `stream` that emits bytes and `ReadableStream` class.
  pub fn with_stream_bytes_and_readable_stream_class<
    B: Into<Vec<u8>>,
    S: Stream<Item = Result<B>> + Unpin + Send + 'static,
  >(
    env: &Env,
    readable_stream_class: &Unknown,
    inner: S,
  ) -> Result<Self> {
    if readable_stream_class.get_type()? == ValueType::Undefined {
      return Err(Error::new(
        Status::GenericFailure,
        "ReadableStream is not supported in this Node.js version",
      ));
    }

    // Create shared state for the stream
    let state = StreamState::new(inner);
    let state_ptr = Arc::into_raw(state) as *mut c_void;

    let mut underlying_source = Object::new(env)?;

    // Create pull callback
    let mut pull_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"pull".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(pull_callback_bytes::<B, S>),
          state_ptr,
          &mut pull_fn,
        )
      },
      "Failed to create pull function"
    )?;
    underlying_source.set_named_property("pull", pull_fn)?;

    // Create cancel callback for cleanup
    let mut cancel_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"cancel".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(cancel_callback::<S>),
          state_ptr,
          &mut cancel_fn,
        )
      },
      "Failed to create cancel function"
    )?;
    underlying_source.set_named_property("cancel", cancel_fn)?;

    underlying_source.set("type", "bytes")?;
    let mut stream = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_new_instance(
          env.0,
          readable_stream_class.0.value,
          1,
          [underlying_source.0.value].as_ptr(),
          &mut stream,
        )
      },
      "Create ReadableStream instance failed"
    )?;
    Ok(Self {
      value: stream,
      env: env.0,
      _marker: PhantomData,
    })
  }
}

pub struct IteratorValue<'env, T: FromNapiValue> {
  _marker: PhantomData<&'env ()>,
  value: Option<T>,
  done: bool,
}

impl<T: FromNapiValue> FromNapiValue for IteratorValue<'_, T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut done = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_named_property(env, napi_val, c"done".as_ptr().cast(), &mut done) },
      "Get done property failed"
    )?;
    let done = unsafe { FromNapiValue::from_napi_value(env, done)? };
    let mut value = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_named_property(env, napi_val, c"value".as_ptr().cast(), &mut value) },
      "Get value property failed"
    )?;
    let value = unsafe { FromNapiValue::from_napi_value(env, value)? };
    Ok(Self {
      value,
      done,
      _marker: PhantomData,
    })
  }
}

pub struct Reader<T: FromNapiValue + 'static> {
  inner:
    ThreadsafeFunction<(), PromiseRaw<'static, IteratorValue<'static, T>>, (), Status, true, true>,
  state: Arc<(RwLock<Result<Option<T>>>, AtomicBool)>,
}

impl<T: FromNapiValue + 'static> futures_core::Stream for Reader<T> {
  type Item = Result<T>;

  fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
    if self.state.1.load(Ordering::Relaxed) {
      let mut chunk = self
        .state
        .0
        .write()
        .map_err(|_| Error::new(Status::InvalidArg, "Poisoned lock in Reader::poll_next"))?;
      let chunk = mem::replace(&mut *chunk, Ok(None))?;
      match chunk {
        Some(chunk) => return Poll::Ready(Some(Ok(chunk))),
        None => return Poll::Ready(None),
      }
    }
    let waker = cx.waker().clone();
    let state = self.state.clone();
    let state_in_catch = state.clone();
    self.inner.call_with_return_value(
      Ok(()),
      ThreadsafeFunctionCallMode::NonBlocking,
      move |iterator, _| {
        let iterator = iterator?;
        iterator
          .then(move |cx| {
            if cx.value.done {
              state.1.store(true, Ordering::Relaxed);
            }
            if let Some(val) = cx.value.value {
              let mut chunk = state.0.write().map_err(|_| {
                Error::new(Status::InvalidArg, "Poisoned lock in Reader::poll_next")
              })?;
              *chunk = Ok(Some(val));
            };
            Ok(())
          })?
          .catch(move |cx: CallbackContext<Unknown>| {
            let mut chunk = state_in_catch
              .0
              .write()
              .map_err(|_| Error::new(Status::InvalidArg, "Poisoned lock in Reader::poll_next"))?;
            let mut error_ref = ptr::null_mut();
            check_status!(
              unsafe { sys::napi_create_reference(cx.env.0, cx.value.0.value, 0, &mut error_ref) },
              "Create error reference failed"
            )?;
            *chunk = Err(Error {
              status: Status::GenericFailure,
              reason: "".to_string(),
              cause: None,
              maybe_raw: error_ref,
              maybe_env: cx.env.0,
            });
            Ok(())
          })?
          .finally(move |_| {
            waker.wake();
            Ok(())
          })?;
        Ok(())
      },
    );
    let mut chunk = self
      .state
      .0
      .write()
      .map_err(|_| Error::new(Status::InvalidArg, "Poisoned lock in Reader::poll_next"))?;
    let chunk = mem::replace(&mut *chunk, Ok(None))?;
    match chunk {
      Some(chunk) => Poll::Ready(Some(Ok(chunk))),
      None => Poll::Pending,
    }
  }
}

/// Shared state for ReadableStream that coordinates between pull and cancel callbacks.
/// Uses Arc to share ownership between callbacks, Mutex to protect the stream,
/// and AtomicBool flags for lock-free cancellation and cleanup coordination.
struct StreamState<S> {
  stream: Mutex<Option<Pin<Box<S>>>>,
  cancelled: AtomicBool,
  /// Tracks whether cleanup has been performed to prevent double-free.
  /// Only one of cancel or pull (on stream end) should perform final Arc cleanup.
  cleanup_done: AtomicBool,
}

impl<S> StreamState<S> {
  fn new(stream: S) -> Arc<Self> {
    Arc::new(Self {
      stream: Mutex::new(Some(Box::pin(stream))),
      cancelled: AtomicBool::new(false),
      cleanup_done: AtomicBool::new(false),
    })
  }

  /// Attempts to claim cleanup responsibility. Returns true if this caller
  /// should perform the final Arc cleanup (consume the raw pointer).
  fn try_claim_cleanup(&self) -> bool {
    self
      .cleanup_done
      .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
      .is_ok()
  }
}

/// Helper struct to extract and bind controller methods from callback info.
struct PullController<T: ToNapiValue> {
  enqueue: crate::bindgen_prelude::FunctionRef<T, ()>,
  close: crate::bindgen_prelude::FunctionRef<(), ()>,
}

impl<T: ToNapiValue> PullController<T> {
  fn from_callback_info(
    env: sys::napi_env,
    info: sys::napi_callback_info,
  ) -> Result<(Self, *mut c_void)> {
    let mut data = ptr::null_mut();
    let mut argc = 1;
    let mut args = [ptr::null_mut(); 1];
    check_status!(
      unsafe {
        sys::napi_get_cb_info(
          env,
          info,
          &mut argc,
          args.as_mut_ptr(),
          ptr::null_mut(),
          &mut data,
        )
      },
      "Get ReadableStream.pull callback info failed"
    )?;

    let controller = unsafe { Object::from_napi_value(env, args[0])? };
    let enqueue = controller
      .get_named_property_unchecked::<Function<T, ()>>("enqueue")?
      .bind(controller)?
      .create_ref()?;
    let close = controller
      .get_named_property_unchecked::<Function<(), ()>>("close")?
      .bind(controller)?
      .create_ref()?;

    Ok((Self { enqueue, close }, data))
  }
}

extern "C" fn cancel_callback<S>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut data = ptr::null_mut();
  unsafe {
    sys::napi_get_cb_info(
      env,
      info,
      ptr::null_mut(),
      ptr::null_mut(),
      ptr::null_mut(),
      &mut data,
    );
  }
  if !data.is_null() {
    // Borrow the Arc<StreamState> temporarily (increment ref count first)
    let state = unsafe {
      Arc::increment_strong_count(data.cast::<StreamState<S>>());
      Arc::from_raw(data.cast::<StreamState<S>>())
    };

    // Mark as cancelled so pull callback knows to stop
    state.cancelled.store(true, Ordering::SeqCst);

    // Try to take the stream - use try_lock to avoid blocking the event loop.
    // If we can't get the lock (pull is in progress), that's fine - pull will
    // see the cancelled flag and handle cleanup.
    if let Ok(mut guard) = state.stream.try_lock() {
      let _ = guard.take();
    }

    // Try to claim cleanup responsibility for the original Arc
    if state.try_claim_cleanup() {
      // We're responsible for cleaning up - consume the original Arc
      drop(unsafe { Arc::from_raw(data.cast::<StreamState<S>>()) });
    }
    // The borrowed Arc (state) drops here, decrementing ref count
  }
  ptr::null_mut()
}

extern "C" fn pull_callback<
  T: ToNapiValue + Send + 'static,
  S: Stream<Item = Result<T>> + Unpin + Send + 'static,
>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  match pull_callback_impl::<T, S>(env, info) {
    Ok(val) => val,
    Err(err) => unsafe {
      let js_error: JsError = err.into();
      js_error.throw_into(env);
      ptr::null_mut()
    },
  }
}

fn pull_callback_impl<
  T: ToNapiValue + Send + 'static,
  S: Stream<Item = Result<T>> + Unpin + Send + 'static,
>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> Result<sys::napi_value> {
  let (controller, data) = PullController::<T>::from_callback_info(env, info)?;

  // Get the Arc<StreamState> - increment ref count so we don't drop the original
  let state = unsafe {
    Arc::increment_strong_count(data.cast::<StreamState<S>>());
    Arc::from_raw(data.cast::<StreamState<S>>())
  };

  // Check if stream was cancelled
  if state.cancelled.load(Ordering::SeqCst) {
    return Ok(ptr::null_mut());
  }

  let env_wrapper = Env::from_raw(env);
  let state_for_async = state.clone();

  let promise = env_wrapper.spawn_future_with_callback(
    async move {
      let mut guard = state_for_async.stream.lock().await;
      if let Some(ref mut stream) = *guard {
        stream.next().await.transpose()
      } else {
        Ok(None)
      }
    },
    move |env, val| {
      // Use inner closure to ensure FunctionRef cleanup on all paths (including errors)
      let result = (|| {
        if let Some(val) = val {
          let enqueue_fn = controller.enqueue.borrow_back(env)?;
          enqueue_fn.call(val)?;
        } else {
          let close_fn = controller.close.borrow_back(env)?;
          close_fn.call(())?;
          // Stream ended - try to take the stream (use try_lock to avoid blocking)
          if let Ok(mut guard) = state.stream.try_lock() {
            let _ = guard.take();
          }
          // Try to claim cleanup responsibility for the original Arc
          if state.try_claim_cleanup() {
            drop(unsafe { Arc::from_raw(data.cast::<StreamState<S>>()) });
          }
        }
        Ok::<(), Error>(())
      })();
      // Always clean up FunctionRefs regardless of success/failure
      drop(controller.enqueue);
      drop(controller.close);
      result
    },
  )?;
  Ok(promise.inner)
}

extern "C" fn pull_callback_bytes<
  B: Into<Vec<u8>>,
  S: Stream<Item = Result<B>> + Unpin + Send + 'static,
>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  match pull_callback_impl_bytes::<B, S>(env, info) {
    Ok(val) => val,
    Err(err) => unsafe {
      let js_error: JsError = err.into();
      js_error.throw_into(env);
      ptr::null_mut()
    },
  }
}

fn pull_callback_impl_bytes<
  B: Into<Vec<u8>>,
  S: Stream<Item = Result<B>> + Unpin + Send + 'static,
>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> Result<sys::napi_value> {
  let (controller, data) = PullController::<BufferSlice>::from_callback_info(env, info)?;

  // Get the Arc<StreamState> - increment ref count so we don't drop the original
  let state = unsafe {
    Arc::increment_strong_count(data.cast::<StreamState<S>>());
    Arc::from_raw(data.cast::<StreamState<S>>())
  };

  // Check if stream was cancelled
  if state.cancelled.load(Ordering::SeqCst) {
    return Ok(ptr::null_mut());
  }

  let env_wrapper = Env::from_raw(env);
  let state_for_async = state.clone();

  let promise = env_wrapper.spawn_future_with_callback(
    async move {
      let mut guard = state_for_async.stream.lock().await;
      if let Some(ref mut stream) = *guard {
        stream
          .next()
          .await
          .transpose()
          .map(|v| v.map(|v| Into::<Vec<u8>>::into(v)))
      } else {
        Ok(None)
      }
    },
    move |env, val| {
      // Use inner closure to ensure FunctionRef cleanup on all paths (including errors)
      let result = (|| {
        if let Some(val) = val {
          let enqueue_fn = controller.enqueue.borrow_back(env)?;
          enqueue_fn.call(BufferSlice::from_data(env, val)?)?;
        } else {
          let close_fn = controller.close.borrow_back(env)?;
          close_fn.call(())?;
          // Stream ended - try to take the stream (use try_lock to avoid blocking)
          if let Ok(mut guard) = state.stream.try_lock() {
            let _ = guard.take();
          }
          // Try to claim cleanup responsibility for the original Arc
          if state.try_claim_cleanup() {
            drop(unsafe { Arc::from_raw(data.cast::<StreamState<S>>()) });
          }
        }
        Ok::<(), Error>(())
      })();
      // Always clean up FunctionRefs regardless of success/failure
      drop(controller.enqueue);
      drop(controller.close);
      result
    },
  )?;
  Ok(promise.inner)
}
