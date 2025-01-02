use std::{
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

use futures_core::Stream;
use tokio_stream::StreamExt;

use crate::{
  bindgen_prelude::{
    CallbackContext, FromNapiValue, Function, PromiseRaw, ToNapiValue, TypeName, Unknown,
    ValidateNapiValue,
  },
  bindgen_runtime::{BufferSlice, Null, Object, NAPI_AUTO_LENGTH},
  check_status, sys,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Env, Error, JsError, NapiRaw, Result, Status, ValueType,
};

pub struct ReadableStream<'env, T> {
  pub(crate) value: sys::napi_value,
  pub(crate) env: sys::napi_env,
  _marker: PhantomData<&'env T>,
}

impl<T> NapiRaw for ReadableStream<'_, T> {
  unsafe fn raw(&self) -> sys::napi_value {
    self.value
  }
}

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
  /// Returns a boolean indicating whether or not the readable stream is locked to a reader.
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
  pub fn cancel(&mut self, reason: Option<String>) -> Result<PromiseRaw<()>> {
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
    let constructor = global.get_named_property_unchecked::<Function>("ReadableStream")?;
    let mut underlying_source = Object::new(env.raw())?;
    let mut pull_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"pull".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(pull_callback::<T, S>),
          Box::into_raw(Box::new(inner)).cast(),
          &mut pull_fn,
        )
      },
      "Failed to create pull function"
    )?;
    underlying_source.set_named_property("pull", pull_fn)?;
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
}

impl<'env> ReadableStream<'env, BufferSlice<'env>> {
  pub fn create_with_stream_bytes<
    B: Into<Vec<u8>>,
    S: Stream<Item = Result<B>> + Unpin + Send + 'static,
  >(
    env: &Env,
    inner: S,
  ) -> Result<Self> {
    let global = env.get_global()?;
    let constructor = global.get_named_property_unchecked::<Function>("ReadableStream")?;
    let mut underlying_source = Object::new(env.raw())?;
    let mut pull_fn = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_function(
          env.raw(),
          c"pull".as_ptr().cast(),
          NAPI_AUTO_LENGTH,
          Some(pull_callback_bytes::<B, S>),
          Box::into_raw(Box::new(inner)).cast(),
          &mut pull_fn,
        )
      },
      "Failed to create pull function"
    )?;
    underlying_source.set_named_property("pull", pull_fn)?;
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
  inner: ThreadsafeFunction<(), PromiseRaw<'static, IteratorValue<'static, T>>, (), true, true>,
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
              maybe_raw: error_ref,
              maybe_env: cx.env.0,
              raw: true,
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
  let mut data = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        ptr::null_mut(),
        ptr::null_mut(),
        ptr::null_mut(),
        &mut data,
      )
    },
    "Get ReadableStream.pull callback info failed"
  )?;
  let mut stream: Pin<&mut S> = Pin::new(Box::leak(unsafe { Box::from_raw(data.cast()) }));
  let env = Env::from_raw(env);
  let promise = env.spawn_future_with_callback(
    async move { stream.next().await.transpose() },
    |env, val| {
      let mut output = Object::new(env.raw())?;
      if let Some(val) = val {
        output.set("value", val)?;
        output.set("done", false)?;
      } else {
        output.set("value", Null)?;
        output.set("done", true)?;
      }
      unsafe {
        crate::__private::log_js_value("log", env.0, [output.0.value]);
      };
      Ok(output.0.value)
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
  let [controller] = args;

  let controller = unsafe { Object::from_napi_value(env, controller)? };
  let enqueue = controller
    .get_named_property_unchecked::<Function<BufferSlice, ()>>("enqueue")?
    .bind(&controller)?
    .create_ref()?;
  let close = controller
    .get_named_property_unchecked::<Function<(), ()>>("close")?
    .bind(&controller)?
    .create_ref()?;

  let mut stream: Pin<&mut S> = Pin::new(Box::leak(unsafe { Box::from_raw(data.cast()) }));
  let env = Env::from_raw(env);
  let promise = env.spawn_future_with_callback(
    async move {
      stream
        .next()
        .await
        .transpose()
        .map(|v| v.map(|v| Into::<Vec<u8>>::into(v)))
    },
    move |env, val| {
      if let Some(val) = val {
        let enqueue_fn = enqueue.borrow_back(&env)?;
        enqueue_fn.call(BufferSlice::from_data(&env, val)?)?;
      } else {
        let close_fn = close.borrow_back(&env)?;
        close_fn.call(())?;
      }
      drop(enqueue);
      drop(close);
      Ok(())
    },
  )?;
  Ok(promise.inner)
}
