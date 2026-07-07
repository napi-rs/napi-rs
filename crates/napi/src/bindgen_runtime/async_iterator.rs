use std::ffi::{c_void, CStr};
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::ptr;

use crate::{
  bindgen_runtime::{
    acquire_native_borrow, FromNapiValue, Object, PromiseRaw, ToNapiValue, Unknown,
  },
  check_status, sys, Env, JsError, Value,
};

/// Hidden property name for the GC-visible edge from async iterator callbacks to their owner.
/// This prevents premature garbage collection without creating an uncollectable strong `napi_ref`.
/// See: https://github.com/napi-rs/napi-rs/issues/3119
const INSTANCE_REF_KEY: &CStr = c"[[InstanceRef]]";

struct AsyncIteratorCallbackData {
  env: sys::napi_env,
  owner_ref: sys::napi_ref,
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
) -> crate::Result<sys::napi_value> {
  // The hidden JS property retains `owner`; this reference stays weak so the
  // owner -> factory function -> owner cycle remains visible and collectible by GC.
  let mut owner_ref = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_reference(env, owner, 0, &mut owner_ref) },
    "Failed to create async iterator callback owner reference"
  )?;

  let mut callback_data = Box::new(AsyncIteratorCallbackData { env, owner_ref });
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
    let err = value.into();
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
  let (owner, _generator_ptr) =
    unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
      .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?
      .owner_and_generator::<T>(env)?;

  let mut generator_object = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_object(env, &mut generator_object) },
    "Create Generator object failed"
  )?;
  let next_function =
    create_async_iterator_callback(env, owner, c"next", Some(generator_next::<T>))?;
  let return_function =
    create_async_iterator_callback(env, owner, c"return", Some(generator_return::<T>))?;
  let throw_function =
    create_async_iterator_callback(env, owner, c"throw", Some(generator_throw::<T>))?;

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

fn with_generator_argument<T: FromNapiValue, U>(
  env: sys::napi_env,
  argc: usize,
  value: sys::napi_value,
  callback: impl FnOnce(Option<T>) -> U,
) -> crate::Result<U> {
  Ok(callback(generator_argument::<T>(env, argc, value)?))
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

  let (_owner, generator_ptr) =
    unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
      .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?
      .owner_and_generator::<T>(env)?;
  let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
  let g = unsafe { &mut *generator_ptr };
  let item = with_generator_argument::<T::Next, _>(env, argc, argv[0], |value| g.next(value))?;

  let env = Env::from_raw(env);
  let promise = env.spawn_future_with_callback(item, |env, value| {
    if let Some(v) = value {
      let mut obj = Object::new(env)?;
      obj.set("value", v)?;
      obj.set("done", false)?;
      Ok(obj)
    } else {
      let mut obj = Object::new(env)?;
      obj.set("value", ())?;
      obj.set("done", true)?;
      Ok(obj)
    }
  })?;
  Ok(promise.inner)
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

  let (_owner, generator_ptr) =
    unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
      .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?
      .owner_and_generator::<T>(env)?;
  let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
  let g = unsafe { &mut *generator_ptr };
  let item = g.complete(generator_argument::<T::Return>(env, argc, argv[0])?);
  let env = Env::from_raw(env);
  let promise = env.spawn_future_with_callback(item, |env, value| {
    let mut obj = Object::new(env)?;
    // Per async iterator protocol, return() must ALWAYS set done: true
    // The value (if any) is the final value, but iteration is complete
    if let Some(v) = value {
      obj.set("value", v)?;
    } else {
      obj.set("value", ())?;
    }
    obj.set("done", true)?;
    Ok(obj)
  })?;
  Ok(promise.inner)
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

  let (_owner, generator_ptr) =
    unsafe { callback_data.cast::<AsyncIteratorCallbackData>().as_ref() }
      .ok_or_else(|| crate::Error::from_reason("Async iterator callback data was null"))?
      .owner_and_generator::<T>(env)?;
  let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
  let g = unsafe { &mut *generator_ptr };
  let caught = if argc == 0 {
    let mut undefined = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_undefined(env, &mut undefined) },
      "Get undefined failed"
    )?;
    g.catch(
      Env(env),
      Unknown(
        Value {
          env,
          value: undefined,
          value_type: crate::ValueType::Undefined,
        },
        std::marker::PhantomData,
      ),
    )
  } else {
    g.catch(
      Env(env),
      Unknown(
        Value {
          env,
          value: argv[0],
          value_type: crate::ValueType::Unknown,
        },
        std::marker::PhantomData,
      ),
    )
  };
  let env = Env::from_raw(env);
  let promise = env.spawn_future_with_callback(caught, |env, value| {
    let mut obj = Object::new(env)?;
    obj.set("value", value)?;
    obj.set("done", false)?;
    Ok(obj)
  })?;
  Ok(promise.inner)
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
