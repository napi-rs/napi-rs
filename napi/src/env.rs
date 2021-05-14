use std::any::TypeId;
use std::convert::TryInto;
use std::ffi::CString;
use std::mem;
use std::os::raw::{c_char, c_void};
use std::ptr;

#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
use once_cell::sync::Lazy;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
use tokio::{runtime::Handle, sync::mpsc};

use crate::{
  async_work::{self, AsyncWorkPromise},
  check_status,
  js_values::*,
  sys,
  task::Task,
  Error, ExtendedErrorInfo, NodeVersion, Result, Status,
};

#[cfg(feature = "napi8")]
use crate::async_cleanup_hook::AsyncCleanupHook;
#[cfg(feature = "napi3")]
use crate::cleanup_env::{CleanupEnvHook, CleanupEnvHookData};
#[cfg(all(feature = "serde-json"))]
use crate::js_values::{De, Ser};
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
use crate::promise;
#[cfg(feature = "napi4")]
use crate::threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction};
#[cfg(all(feature = "serde-json"))]
use serde::de::DeserializeOwned;
#[cfg(all(feature = "serde-json"))]
use serde::Serialize;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
use std::future::Future;

pub type Callback = extern "C" fn(sys::napi_env, sys::napi_callback_info) -> sys::napi_value;

#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
static RT: Lazy<(Handle, mpsc::Sender<()>)> = Lazy::new(|| {
  let rt = tokio::runtime::Runtime::new();
  let (tx, mut rx) = mpsc::channel::<()>(1);
  rt.map(|rt| {
    let h = rt.handle();
    let handle = h.clone();
    handle.spawn(async move {
      if rx.recv().await.is_some() {
        rt.shutdown_background();
      }
    });

    (handle, tx)
  })
  .expect("Create tokio runtime failed")
});

#[doc(hidden)]
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
#[inline(never)]
pub fn shutdown_tokio_rt() {
  let sender = &RT.1;
  sender
    .clone()
    .try_send(())
    .expect("Shutdown tokio runtime failed");
}

#[derive(Clone, Copy)]
/// `Env` is used to represent a context that the underlying N-API implementation can use to persist VM-specific state.
///
/// Specifically, the same `Env` that was passed in when the initial native function was called must be passed to any subsequent nested N-API calls.
///
/// Caching the `Env` for the purpose of general reuse, and passing the `Env` between instances of the same addon running on different Worker threads is not allowed.
///
/// The `Env` becomes invalid when an instance of a native addon is unloaded.
///
/// Notification of this event is delivered through the callbacks given to `Env::add_env_cleanup_hook` and `Env::set_instance_data`.
pub struct Env(pub(crate) sys::napi_env);

impl Env {
  #[inline]
  #[allow(clippy::missing_safety_doc)]
  pub unsafe fn from_raw(env: sys::napi_env) -> Self {
    Env(env)
  }

  #[inline]
  /// Get [JsUndefined](./struct.JsUndefined.html) value
  pub fn get_undefined(&self) -> Result<JsUndefined> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_undefined(self.0, &mut raw_value) })?;
    Ok(unsafe { JsUndefined::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn get_null(&self) -> Result<JsNull> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_null(self.0, &mut raw_value) })?;
    Ok(unsafe { JsNull::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn get_boolean(&self, value: bool) -> Result<JsBoolean> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_boolean(self.0, value, &mut raw_value) })?;
    Ok(unsafe { JsBoolean::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_int32(&self, int: i32) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_int32(self.0, int, (&mut raw_value) as *mut sys::napi_value)
    })?;
    Ok(unsafe { JsNumber::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_int64(&self, int: i64) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_int64(self.0, int, (&mut raw_value) as *mut sys::napi_value)
    })?;
    Ok(unsafe { JsNumber::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_uint32(&self, number: u32) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_uint32(self.0, number, &mut raw_value) })?;
    Ok(unsafe { JsNumber::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_double(&self, double: f64) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_double(self.0, double, (&mut raw_value) as *mut sys::napi_value)
    })?;
    Ok(unsafe { JsNumber::from_raw_unchecked(self.0, raw_value) })
  }

  /// [n_api_napi_create_bigint_int64](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_int64)
  #[cfg(feature = "napi6")]
  #[inline]
  pub fn create_bigint_from_i64(&self, value: i64) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_bigint_int64(self.0, value, &mut raw_value) })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  #[cfg(feature = "napi6")]
  #[inline]
  pub fn create_bigint_from_u64(&self, value: u64) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_bigint_uint64(self.0, value, &mut raw_value) })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  #[cfg(feature = "napi6")]
  #[inline]
  pub fn create_bigint_from_i128(&self, value: i128) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    let sign_bit = if value > 0 { 0 } else { 1 };
    let words = &value as *const i128 as *const u64;
    check_status!(unsafe {
      sys::napi_create_bigint_words(self.0, sign_bit, 2, words, &mut raw_value)
    })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  #[cfg(feature = "napi6")]
  #[inline]
  pub fn create_bigint_from_u128(&self, value: u128) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    let words = &value as *const u128 as *const u64;
    check_status!(unsafe { sys::napi_create_bigint_words(self.0, 0, 2, words, &mut raw_value) })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  /// [n_api_napi_create_bigint_words](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_words)
  ///
  /// The resulting BigInt will be negative when sign_bit is true.
  #[cfg(feature = "napi6")]
  #[inline]
  pub fn create_bigint_from_words(&self, sign_bit: bool, words: Vec<u64>) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    let len = words.len();
    check_status!(unsafe {
      sys::napi_create_bigint_words(
        self.0,
        match sign_bit {
          true => 1,
          false => 0,
        },
        len,
        words.as_ptr(),
        &mut raw_value,
      )
    })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, len))
  }

  #[inline]
  pub fn create_string(&self, s: &str) -> Result<JsString> {
    unsafe { self.create_string_from_c_char(s.as_ptr() as *const c_char, s.len()) }
  }

  #[inline]
  pub fn create_string_from_std(&self, s: String) -> Result<JsString> {
    unsafe { self.create_string_from_c_char(s.as_ptr() as *const c_char, s.len()) }
  }

  #[inline]
  /// This API is used for C ffi scenario.
  /// Convert raw *const c_char into JsString
  ///
  /// # Safety
  ///
  /// Create JsString from known valid utf-8 string
  pub unsafe fn create_string_from_c_char(
    &self,
    data_ptr: *const c_char,
    len: usize,
  ) -> Result<JsString> {
    let mut raw_value = ptr::null_mut();
    check_status!(sys::napi_create_string_utf8(
      self.0,
      data_ptr,
      len,
      &mut raw_value
    ))?;
    Ok(JsString::from_raw_unchecked(self.0, raw_value))
  }

  #[inline]
  pub fn create_string_utf16(&self, chars: &[u16]) -> Result<JsString> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_string_utf16(self.0, chars.as_ptr(), chars.len(), &mut raw_value)
    })?;
    Ok(unsafe { JsString::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_string_latin1(&self, chars: &[u8]) -> Result<JsString> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_string_latin1(
        self.0,
        chars.as_ptr() as *const _,
        chars.len(),
        &mut raw_value,
      )
    })?;
    Ok(unsafe { JsString::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_symbol_from_js_string(&self, description: JsString) -> Result<JsSymbol> {
    let mut result = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_symbol(self.0, description.0.value, &mut result) })?;
    Ok(unsafe { JsSymbol::from_raw_unchecked(self.0, result) })
  }

  #[inline]
  pub fn create_symbol(&self, description: Option<&str>) -> Result<JsSymbol> {
    let mut result = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_symbol(
        self.0,
        description
          .and_then(|desc| self.create_string(desc).ok())
          .map(|string| string.0.value)
          .unwrap_or(ptr::null_mut()),
        &mut result,
      )
    })?;
    Ok(unsafe { JsSymbol::from_raw_unchecked(self.0, result) })
  }

  #[inline]
  pub fn create_object(&self) -> Result<JsObject> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_object(self.0, &mut raw_value) })?;
    Ok(unsafe { JsObject::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_array(&self) -> Result<JsObject> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_array(self.0, &mut raw_value) })?;
    Ok(unsafe { JsObject::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  pub fn create_array_with_length(&self, length: usize) -> Result<JsObject> {
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_array_with_length(self.0, length, &mut raw_value) })?;
    Ok(unsafe { JsObject::from_raw_unchecked(self.0, raw_value) })
  }

  #[inline]
  /// This API allocates a node::Buffer object. While this is still a fully-supported data structure, in most cases using a TypedArray will suffice.
  pub fn create_buffer(&self, length: usize) -> Result<JsBufferValue> {
    let mut raw_value = ptr::null_mut();
    let mut data: Vec<u8> = Vec::with_capacity(length);
    let mut data_ptr = data.as_mut_ptr() as *mut c_void;
    check_status!(unsafe {
      sys::napi_create_buffer(self.0, length, &mut data_ptr, &mut raw_value)
    })?;

    Ok(JsBufferValue::new(
      JsBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      mem::ManuallyDrop::new(data),
    ))
  }

  #[inline]
  /// This API allocates a node::Buffer object and initializes it with data backed by the passed in buffer.
  ///
  /// While this is still a fully-supported data structure, in most cases using a TypedArray will suffice.
  pub fn create_buffer_with_data(&self, mut data: Vec<u8>) -> Result<JsBufferValue> {
    let length = data.len();
    let mut raw_value = ptr::null_mut();
    let data_ptr = data.as_mut_ptr();
    check_status!(unsafe {
      sys::napi_create_external_buffer(
        self.0,
        length,
        data_ptr as *mut c_void,
        Some(drop_buffer),
        Box::into_raw(Box::new((length, data.capacity()))) as *mut c_void,
        &mut raw_value,
      )
    })?;
    Ok(JsBufferValue::new(
      JsBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      mem::ManuallyDrop::new(data),
    ))
  }

  #[inline]
  /// # Safety
  /// Mostly the same with `create_buffer_with_data`
  ///
  /// Provided `finalize_callback` will be called when `Buffer` got dropped.
  ///
  /// You can pass in `noop_finalize` if you have nothing to do in finalize phase.
  pub unsafe fn create_buffer_with_borrowed_data<Hint, Finalize>(
    &self,
    data: *const u8,
    length: usize,
    hint: Hint,
    finalize_callback: Finalize,
  ) -> Result<JsBufferValue>
  where
    Finalize: FnOnce(Hint, Env),
  {
    let mut raw_value = ptr::null_mut();
    check_status!(sys::napi_create_external_buffer(
      self.0,
      length,
      data as *mut c_void,
      Some(
        raw_finalize_with_custom_callback::<Hint, Finalize>
          as unsafe extern "C" fn(
            env: sys::napi_env,
            finalize_data: *mut c_void,
            finalize_hint: *mut c_void,
          )
      ),
      Box::into_raw(Box::new((hint, finalize_callback))) as *mut c_void,
      &mut raw_value,
    ))?;
    Ok(JsBufferValue::new(
      JsBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      mem::ManuallyDrop::new(Vec::from_raw_parts(data as *mut u8, length, length)),
    ))
  }

  #[inline]
  /// This function gives V8 an indication of the amount of externally allocated memory that is kept alive by JavaScript objects (i.e. a JavaScript object that points to its own memory allocated by a native module).
  ///
  /// Registering externally allocated memory will trigger global garbage collections more often than it would otherwise.
  ///
  /// ***ATTENTION ⚠️***, do not use this with `create_buffer_with_data/create_arraybuffer_with_data`, since these two functions already called the `adjust_external_memory` internal.
  pub fn adjust_external_memory(&mut self, size: i64) -> Result<i64> {
    let mut changed = 0i64;
    check_status!(unsafe { sys::napi_adjust_external_memory(self.0, size, &mut changed) })?;
    Ok(changed)
  }

  #[inline]
  /// This API allocates a node::Buffer object and initializes it with data copied from the passed-in buffer.
  ///
  /// While this is still a fully-supported data structure, in most cases using a TypedArray will suffice.
  pub fn create_buffer_copy<D>(&self, data_to_copy: D) -> Result<JsBufferValue>
  where
    D: AsRef<[u8]>,
  {
    let length = data_to_copy.as_ref().len();
    let data_ptr = data_to_copy.as_ref().as_ptr();
    let mut copy_data = ptr::null_mut();
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_buffer_copy(
        self.0,
        length,
        data_ptr as *mut c_void,
        &mut copy_data,
        &mut raw_value,
      )
    })?;
    Ok(JsBufferValue::new(
      JsBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      mem::ManuallyDrop::new(unsafe { Vec::from_raw_parts(copy_data as *mut u8, length, length) }),
    ))
  }

  #[inline]
  pub fn create_arraybuffer(&self, length: usize) -> Result<JsArrayBufferValue> {
    let mut raw_value = ptr::null_mut();
    let mut data: Vec<u8> = Vec::with_capacity(length as usize);
    let mut data_ptr = data.as_mut_ptr() as *mut c_void;
    check_status!(unsafe {
      sys::napi_create_arraybuffer(self.0, length, &mut data_ptr, &mut raw_value)
    })?;

    Ok(JsArrayBufferValue::new(
      unsafe { JsArrayBuffer::from_raw_unchecked(self.0, raw_value) },
      data_ptr as *mut c_void,
      length,
    ))
  }

  #[inline]
  pub fn create_arraybuffer_with_data(&self, data: Vec<u8>) -> Result<JsArrayBufferValue> {
    let length = data.len();
    let mut raw_value = ptr::null_mut();
    let data_ptr = data.as_ptr();
    check_status!(unsafe {
      sys::napi_create_external_arraybuffer(
        self.0,
        data_ptr as *mut c_void,
        length,
        Some(drop_buffer),
        Box::into_raw(Box::new((length, data.capacity()))) as *mut c_void,
        &mut raw_value,
      )
    })?;

    mem::forget(data);
    Ok(JsArrayBufferValue::new(
      JsArrayBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      data_ptr as *mut c_void,
      length,
    ))
  }

  #[inline]
  /// # Safety
  /// Mostly the same with `create_arraybuffer_with_data`
  ///
  /// Provided `finalize_callback` will be called when `Buffer` got dropped.
  ///
  /// You can pass in `noop_finalize` if you have nothing to do in finalize phase.
  pub unsafe fn create_arraybuffer_with_borrowed_data<Hint, Finalize>(
    &self,
    data: *const u8,
    length: usize,
    hint: Hint,
    finalize_callback: Finalize,
  ) -> Result<JsArrayBufferValue>
  where
    Finalize: FnOnce(Hint, Env),
  {
    let mut raw_value = ptr::null_mut();
    check_status!(sys::napi_create_external_arraybuffer(
      self.0,
      data as *mut c_void,
      length,
      Some(
        raw_finalize_with_custom_callback::<Hint, Finalize>
          as unsafe extern "C" fn(
            env: sys::napi_env,
            finalize_data: *mut c_void,
            finalize_hint: *mut c_void,
          )
      ),
      Box::into_raw(Box::new((hint, finalize_callback))) as *mut c_void,
      &mut raw_value,
    ))?;
    Ok(JsArrayBufferValue::new(
      JsArrayBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      data as *mut c_void,
      length,
    ))
  }

  #[inline]
  /// This API allows an add-on author to create a function object in native code.
  ///
  /// This is the primary mechanism to allow calling into the add-on's native code from JavaScript.
  ///
  /// The newly created function is not automatically visible from script after this call.
  ///
  /// Instead, a property must be explicitly set on any object that is visible to JavaScript, in order for the function to be accessible from script.
  pub fn create_function(&self, name: &str, callback: Callback) -> Result<JsFunction> {
    let mut raw_result = ptr::null_mut();
    let len = name.len();
    let name = CString::new(name)?;
    check_status!(unsafe {
      sys::napi_create_function(
        self.0,
        name.as_ptr(),
        len,
        Some(callback),
        ptr::null_mut(),
        &mut raw_result,
      )
    })?;

    Ok(unsafe { JsFunction::from_raw_unchecked(self.0, raw_result) })
  }

  #[cfg(feature = "napi5")]
  pub fn create_function_from_closure<R, F>(&self, name: &str, callback: F) -> Result<JsFunction>
  where
    F: 'static + Send + Sync + Fn(crate::CallContext<'_>) -> Result<R>,
    R: NapiRaw,
  {
    use crate::CallContext;
    let boxed_callback = Box::new(callback);
    let closure_data_ptr: *mut F = Box::into_raw(boxed_callback);

    let mut raw_result = ptr::null_mut();
    let len = name.len();
    let name = CString::new(name)?;
    check_status!(unsafe {
      sys::napi_create_function(
        self.0,
        name.as_ptr(),
        len,
        Some({
          unsafe extern "C" fn trampoline<R: NapiRaw, F: Fn(CallContext<'_>) -> Result<R>>(
            raw_env: sys::napi_env,
            cb_info: sys::napi_callback_info,
          ) -> sys::napi_value {
            use ::std::panic::{self, AssertUnwindSafe};
            panic::catch_unwind(AssertUnwindSafe(|| {
              let (raw_this, ref raw_args, closure_data_ptr) = {
                let argc = {
                  let mut argc = 0;
                  let status = sys::napi_get_cb_info(
                    raw_env,
                    cb_info,
                    &mut argc,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                  );
                  debug_assert!(
                    Status::from(status) == Status::Ok,
                    "napi_get_cb_info failed"
                  );
                  argc
                };
                let mut raw_args = vec![ptr::null_mut(); argc];
                let mut raw_this = ptr::null_mut();
                let mut closure_data_ptr = ptr::null_mut();

                let status = sys::napi_get_cb_info(
                  raw_env,
                  cb_info,
                  &mut { argc },
                  raw_args.as_mut_ptr(),
                  &mut raw_this,
                  &mut closure_data_ptr,
                );
                debug_assert!(
                  Status::from(status) == Status::Ok,
                  "napi_get_cb_info failed"
                );
                (raw_this, raw_args, closure_data_ptr)
              };

              let closure: &F = closure_data_ptr
                .cast::<F>()
                .as_ref()
                .expect("`napi_get_cb_info` should have yielded non-`NULL` assoc data");
              let ref mut env = Env::from_raw(raw_env);
              let ctx = CallContext::new(env, cb_info, raw_this, raw_args, raw_args.len());
              closure(ctx).map(|ret: R| ret.raw())
            }))
            .map_err(|e| {
              Error::from_reason(format!(
                "panic from Rust code: {}",
                if let Some(s) = e.downcast_ref::<String>() {
                  s
                } else if let Some(s) = e.downcast_ref::<&str>() {
                  s
                } else {
                  "<no error message>"
                },
              ))
            })
            .and_then(|v| v)
            .unwrap_or_else(|e| {
              JsError::from(e).throw_into(raw_env);
              ptr::null_mut()
            })
          }

          trampoline::<R, F>
        }),
        closure_data_ptr.cast(), // We let it borrow the data here
        &mut raw_result,
      )
    })?;

    // Note: based on N-API docs, at this point, we have created an effective
    // `&'static dyn Fn…` in Rust parlance, in that thanks to `Box::into_raw()`
    // we are sure the context won't be freed, and thus the callback may use
    // it to call the actual method thanks to the trampoline…
    // But we thus have a data leak: there is nothing yet reponsible for
    // running the `drop(Box::from_raw(…))` cleanup code.
    //
    // To solve that, according to the docs, we need to attach a finalizer:
    check_status!(unsafe {
      sys::napi_add_finalizer(
        self.0,
        raw_result,
        closure_data_ptr.cast(),
        Some({
          unsafe extern "C" fn finalize_box_trampoline<F>(
            _raw_env: sys::napi_env,
            closure_data_ptr: *mut c_void,
            _finalize_hint: *mut c_void,
          ) {
            drop(Box::<F>::from_raw(closure_data_ptr.cast()))
          }

          finalize_box_trampoline::<F>
        }),
        ptr::null_mut(),
        ptr::null_mut(),
      )
    })?;

    Ok(unsafe { JsFunction::from_raw_unchecked(self.0, raw_result) })
  }

  #[inline]
  /// This API retrieves a napi_extended_error_info structure with information about the last error that occurred.
  ///
  /// The content of the napi_extended_error_info returned is only valid up until an n-api function is called on the same env.
  ///
  /// Do not rely on the content or format of any of the extended information as it is not subject to SemVer and may change at any time. It is intended only for logging purposes.
  ///
  /// This API can be called even if there is a pending JavaScript exception.
  pub fn get_last_error_info(&self) -> Result<ExtendedErrorInfo> {
    let mut raw_extended_error = ptr::null();
    check_status!(unsafe { sys::napi_get_last_error_info(self.0, &mut raw_extended_error) })?;
    unsafe { ptr::read(raw_extended_error) }.try_into()
  }

  #[inline]
  /// This API throws a JavaScript Error with the text provided.
  pub fn throw_error(&self, msg: &str, code: Option<&str>) -> Result<()> {
    check_status!(unsafe {
      sys::napi_throw_error(
        self.0,
        match code {
          Some(s) => CString::new(s)?.as_ptr(),
          None => ptr::null_mut(),
        },
        CString::new(msg)?.as_ptr(),
      )
    })
  }

  #[inline]
  /// This API throws a JavaScript RangeError with the text provided.
  pub fn throw_range_error(&self, msg: &str, code: Option<&str>) -> Result<()> {
    check_status!(unsafe {
      sys::napi_throw_range_error(
        self.0,
        match code {
          Some(s) => CString::new(s)?.as_ptr(),
          None => ptr::null_mut(),
        },
        CString::new(msg)?.as_ptr(),
      )
    })
  }

  #[inline]
  /// This API throws a JavaScript TypeError with the text provided.
  pub fn throw_type_error(&self, msg: &str, code: Option<&str>) -> Result<()> {
    check_status!(unsafe {
      sys::napi_throw_type_error(
        self.0,
        match code {
          Some(s) => CString::new(s)?.as_ptr(),
          None => ptr::null_mut(),
        },
        CString::new(msg)?.as_ptr(),
      )
    })
  }

  #[inline]
  #[allow(clippy::expect_fun_call)]
  /// In the event of an unrecoverable error in a native module
  ///
  /// A fatal error can be thrown to immediately terminate the process.
  pub fn fatal_error(self, location: &str, message: &str) {
    let location_len = location.len();
    let message_len = message.len();
    let location =
      CString::new(location).expect(format!("Convert [{}] to CString failed", location).as_str());
    let message =
      CString::new(message).expect(format!("Convert [{}] to CString failed", message).as_str());

    unsafe {
      sys::napi_fatal_error(
        location.as_ptr(),
        location_len,
        message.as_ptr(),
        message_len,
      )
    }
  }

  #[cfg(feature = "napi3")]
  #[inline]
  /// Trigger an 'uncaughtException' in JavaScript.
  ///
  /// Useful if an async callback throws an exception with no way to recover.
  pub fn fatal_exception(&self, err: Error) {
    unsafe {
      let js_error = JsError::from(err).into_value(self.0);
      debug_assert!(sys::napi_fatal_exception(self.0, js_error) == sys::Status::napi_ok);
    };
  }

  #[inline]
  /// Create JavaScript class
  pub fn define_class(
    &self,
    name: &str,
    constructor_cb: Callback,
    properties: &[Property],
  ) -> Result<JsFunction> {
    let mut raw_result = ptr::null_mut();
    let raw_properties = properties
      .iter()
      .map(|prop| prop.raw())
      .collect::<Vec<sys::napi_property_descriptor>>();

    check_status!(unsafe {
      sys::napi_define_class(
        self.0,
        name.as_ptr() as *const c_char,
        name.len(),
        Some(constructor_cb),
        ptr::null_mut(),
        raw_properties.len(),
        raw_properties.as_ptr(),
        &mut raw_result,
      )
    })?;

    Ok(unsafe { JsFunction::from_raw_unchecked(self.0, raw_result) })
  }

  #[inline]
  pub fn wrap<T: 'static>(&self, js_object: &mut JsObject, native_object: T) -> Result<()> {
    check_status!(unsafe {
      sys::napi_wrap(
        self.0,
        js_object.0.value,
        Box::into_raw(Box::new(TaggedObject::new(native_object))) as *mut c_void,
        Some(raw_finalize::<T>),
        ptr::null_mut(),
        ptr::null_mut(),
      )
    })
  }

  #[inline]
  pub fn unwrap<T: 'static>(&self, js_object: &JsObject) -> Result<&mut T> {
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      check_status!(sys::napi_unwrap(
        self.0,
        js_object.0.value,
        &mut unknown_tagged_object,
      ))?;

      let type_id = unknown_tagged_object as *const TypeId;
      if *type_id == TypeId::of::<T>() {
        let tagged_object = unknown_tagged_object as *mut TaggedObject<T>;
        (*tagged_object).object.as_mut().ok_or(Error {
          status: Status::InvalidArg,
          reason: "Invalid argument, nothing attach to js_object".to_owned(),
        })
      } else {
        Err(Error {
          status: Status::InvalidArg,
          reason: "Invalid argument, T on unrwap is not the type of wrapped object".to_owned(),
        })
      }
    }
  }

  #[inline]
  pub fn unwrap_from_ref<T: 'static>(&self, js_ref: &Ref<()>) -> Result<&'static mut T> {
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      check_status!(sys::napi_unwrap(
        self.0,
        js_ref.raw_value,
        &mut unknown_tagged_object,
      ))?;

      let type_id = unknown_tagged_object as *const TypeId;
      if *type_id == TypeId::of::<T>() {
        let tagged_object = unknown_tagged_object as *mut TaggedObject<T>;
        (*tagged_object).object.as_mut().ok_or(Error {
          status: Status::InvalidArg,
          reason: "Invalid argument, nothing attach to js_object".to_owned(),
        })
      } else {
        Err(Error {
          status: Status::InvalidArg,
          reason: "Invalid argument, T on unrwap is not the type of wrapped object".to_owned(),
        })
      }
    }
  }

  #[inline]
  pub fn drop_wrapped<T: 'static>(&self, js_object: JsObject) -> Result<()> {
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      check_status!(sys::napi_unwrap(
        self.0,
        js_object.0.value,
        &mut unknown_tagged_object,
      ))?;

      let type_id = unknown_tagged_object as *const TypeId;
      if *type_id == TypeId::of::<T>() {
        let tagged_object = unknown_tagged_object as *mut TaggedObject<T>;
        (*tagged_object).object = None;
        Ok(())
      } else {
        Err(Error {
          status: Status::InvalidArg,
          reason: "Invalid argument, T on drop_wrapped is not the type of wrapped object"
            .to_owned(),
        })
      }
    }
  }

  #[inline]
  /// This API create a new reference with the specified reference count to the Object passed in.
  pub fn create_reference<T>(&self, value: T) -> Result<Ref<()>>
  where
    T: NapiRaw,
  {
    let mut raw_ref = ptr::null_mut();
    let initial_ref_count = 1;
    let raw_value = unsafe { value.raw() };
    check_status!(unsafe {
      sys::napi_create_reference(self.0, raw_value, initial_ref_count, &mut raw_ref)
    })?;
    Ok(Ref {
      raw_ref,
      count: 1,
      inner: (),
      raw_value,
    })
  }

  #[inline]
  /// Get reference value from `Ref` with type check
  ///
  /// Return error if the type of `reference` provided is mismatched with `T`
  pub fn get_reference_value<T>(&self, reference: &Ref<()>) -> Result<T>
  where
    T: NapiValue,
  {
    let mut js_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_get_reference_value(self.0, reference.raw_ref, &mut js_value)
    })?;
    unsafe { T::from_raw(self.0, js_value) }
  }

  #[inline]
  /// Get reference value from `Ref` without type check
  ///
  /// Using this API if you are sure the type of `T` is matched with provided `Ref<()>`.
  ///
  /// If type mismatched, calling `T::method` would return `Err`.
  pub fn get_reference_value_unchecked<T>(&self, reference: &Ref<()>) -> Result<T>
  where
    T: NapiValue,
  {
    let mut js_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_get_reference_value(self.0, reference.raw_ref, &mut js_value)
    })?;
    Ok(unsafe { T::from_raw_unchecked(self.0, js_value) })
  }

  #[inline]
  /// If `size_hint` provided, `Env::adjust_external_memory` will be called under the hood.
  ///
  /// If no `size_hint` provided, global garbage collections will be triggered less times than expected.
  ///
  /// If getting the exact `native_object` size is difficult, you can provide an approximate value, it's only effect to the GC.
  pub fn create_external<T: 'static>(
    &self,
    native_object: T,
    size_hint: Option<i64>,
  ) -> Result<JsExternal> {
    let mut object_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_external(
        self.0,
        Box::into_raw(Box::new(TaggedObject::new(native_object))) as *mut c_void,
        Some(raw_finalize::<T>),
        Box::into_raw(Box::new(size_hint)) as *mut c_void,
        &mut object_value,
      )
    })?;
    if let Some(changed) = size_hint {
      let mut adjusted_value = 0i64;
      check_status!(unsafe {
        sys::napi_adjust_external_memory(self.0, changed, &mut adjusted_value)
      })?;
    };
    Ok(unsafe { JsExternal::from_raw_unchecked(self.0, object_value) })
  }

  #[inline]
  pub fn get_value_external<T: 'static>(&self, js_external: &JsExternal) -> Result<&mut T> {
    unsafe {
      let mut unknown_tagged_object = ptr::null_mut();
      check_status!(sys::napi_get_value_external(
        self.0,
        js_external.0.value,
        &mut unknown_tagged_object,
      ))?;

      let type_id = unknown_tagged_object as *const TypeId;
      if *type_id == TypeId::of::<T>() {
        let tagged_object = unknown_tagged_object as *mut TaggedObject<T>;
        (*tagged_object).object.as_mut().ok_or(Error {
          status: Status::InvalidArg,
          reason: "nothing attach to js_external".to_owned(),
        })
      } else {
        Err(Error {
          status: Status::InvalidArg,
          reason: "T on get_value_external is not the type of wrapped object".to_owned(),
        })
      }
    }
  }

  #[inline]
  pub fn create_error(&self, e: Error) -> Result<JsObject> {
    let reason = e.reason;
    let reason_string = self.create_string(reason.as_str())?;
    let mut result = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_error(self.0, ptr::null_mut(), reason_string.0.value, &mut result)
    })?;
    Ok(unsafe { JsObject::from_raw_unchecked(self.0, result) })
  }

  #[inline]
  /// Run [Task](./trait.Task.html) in libuv thread pool, return [AsyncWorkPromise](./struct.AsyncWorkPromise.html)
  pub fn spawn<T: 'static + Task>(&self, task: T) -> Result<AsyncWorkPromise> {
    async_work::run(self, task)
  }

  #[inline]
  pub fn run_in_scope<T, F>(&self, executor: F) -> Result<T>
  where
    F: FnOnce() -> Result<T>,
  {
    let mut handle_scope = ptr::null_mut();
    check_status!(unsafe { sys::napi_open_handle_scope(self.0, &mut handle_scope) })?;

    let result = executor();

    check_status!(unsafe { sys::napi_close_handle_scope(self.0, handle_scope) })?;
    result
  }

  #[inline]
  pub fn get_global(&self) -> Result<JsGlobal> {
    let mut raw_global = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_global(self.0, &mut raw_global) })?;
    Ok(unsafe { JsGlobal::from_raw_unchecked(self.0, raw_global) })
  }

  #[inline]
  pub fn get_napi_version(&self) -> Result<u32> {
    let global = self.get_global()?;
    let process: JsObject = global.get_named_property("process")?;
    let versions: JsObject = process.get_named_property("versions")?;
    let napi_version: JsString = versions.get_named_property("napi")?;
    napi_version
      .into_utf8()?
      .as_str()?
      .parse()
      .map_err(|e| Error::new(Status::InvalidArg, format!("{}", e)))
  }

  #[cfg(feature = "napi2")]
  #[inline]
  pub fn get_uv_event_loop(&self) -> Result<*mut sys::uv_loop_s> {
    let mut uv_loop: *mut sys::uv_loop_s = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_uv_event_loop(self.0, &mut uv_loop) })?;
    Ok(uv_loop)
  }

  #[cfg(feature = "napi3")]
  pub fn add_env_cleanup_hook<T, F>(
    &mut self,
    cleanup_data: T,
    cleanup_fn: F,
  ) -> Result<CleanupEnvHook<T>>
  where
    T: 'static,
    F: 'static + FnOnce(T),
  {
    let hook = CleanupEnvHookData {
      data: cleanup_data,
      hook: Box::new(cleanup_fn),
    };
    let hook_ref = Box::leak(Box::new(hook));
    check_status!(unsafe {
      sys::napi_add_env_cleanup_hook(
        self.0,
        Some(cleanup_env::<T>),
        hook_ref as *mut CleanupEnvHookData<T> as *mut _,
      )
    })?;
    Ok(CleanupEnvHook(hook_ref))
  }

  #[cfg(feature = "napi3")]
  #[inline]
  pub fn remove_env_cleanup_hook<T>(&mut self, hook: CleanupEnvHook<T>) -> Result<()>
  where
    T: 'static,
  {
    check_status!(unsafe {
      sys::napi_remove_env_cleanup_hook(self.0, Some(cleanup_env::<T>), hook.0 as *mut _)
    })
  }

  #[cfg(feature = "napi4")]
  #[inline]
  pub fn create_threadsafe_function<
    T: Send,
    V: NapiRaw,
    R: 'static + Send + FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>,
  >(
    &self,
    func: &JsFunction,
    max_queue_size: usize,
    callback: R,
  ) -> Result<ThreadsafeFunction<T>> {
    ThreadsafeFunction::create(self.0, func, max_queue_size, callback)
  }

  #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
  #[inline]
  pub fn execute_tokio_future<
    T: 'static + Send,
    V: 'static + NapiValue,
    F: 'static + Send + Future<Output = Result<T>>,
    R: 'static + Send + Sync + FnOnce(&mut Env, T) -> Result<V>,
  >(
    &self,
    fut: F,
    resolver: R,
  ) -> Result<JsObject> {
    let handle = &RT.0;

    let mut raw_promise = ptr::null_mut();
    let mut raw_deferred = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_promise(self.0, &mut raw_deferred, &mut raw_promise)
    })?;

    let raw_env = self.0;
    let future_promise = promise::FuturePromise::create(raw_env, raw_deferred, resolver)?;
    let future_to_resolve = promise::resolve_from_future(future_promise.start()?, fut);
    handle.spawn(future_to_resolve);
    Ok(unsafe { JsObject::from_raw_unchecked(self.0, raw_promise) })
  }

  #[cfg(feature = "napi5")]
  #[inline]
  /// This API does not observe leap seconds; they are ignored, as ECMAScript aligns with POSIX time specification.
  ///
  /// This API allocates a JavaScript Date object.
  ///
  /// JavaScript Date objects are described in [Section 20.3](https://tc39.github.io/ecma262/#sec-date-objects) of the ECMAScript Language Specification.
  pub fn create_date(&self, time: f64) -> Result<JsDate> {
    let mut js_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_create_date(self.0, time, &mut js_value) })?;
    Ok(unsafe { JsDate::from_raw_unchecked(self.0, js_value) })
  }

  #[cfg(feature = "napi6")]
  /// This API associates data with the currently running Agent. data can later be retrieved using `Env::get_instance_data()`.
  ///
  /// Any existing data associated with the currently running Agent which was set by means of a previous call to `Env::set_instance_data()` will be overwritten.
  ///
  /// If a `finalize_cb` was provided by the previous call, it will not be called.
  pub fn set_instance_data<T, Hint, F>(&self, native: T, hint: Hint, finalize_cb: F) -> Result<()>
  where
    T: 'static,
    Hint: 'static,
    F: FnOnce(FinalizeContext<T, Hint>),
  {
    check_status!(unsafe {
      sys::napi_set_instance_data(
        self.0,
        Box::leak(Box::new((TaggedObject::new(native), finalize_cb))) as *mut (TaggedObject<T>, F)
          as *mut c_void,
        Some(
          set_instance_finalize_callback::<T, Hint, F>
            as unsafe extern "C" fn(
              env: sys::napi_env,
              finalize_data: *mut c_void,
              finalize_hint: *mut c_void,
            ),
        ),
        Box::leak(Box::new(hint)) as *mut Hint as *mut c_void,
      )
    })
  }

  #[cfg(feature = "napi6")]
  #[inline]
  /// This API retrieves data that was previously associated with the currently running Agent via `Env::set_instance_data()`.
  ///
  /// If no data is set, the call will succeed and data will be set to NULL.
  pub fn get_instance_data<T>(&self) -> Result<Option<&'static mut T>>
  where
    T: 'static,
  {
    let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
    unsafe {
      check_status!(sys::napi_get_instance_data(
        self.0,
        &mut unknown_tagged_object
      ))?;
      let type_id = unknown_tagged_object as *const TypeId;
      if unknown_tagged_object.is_null() {
        return Ok(None);
      }
      if *type_id == TypeId::of::<T>() {
        let tagged_object = unknown_tagged_object as *mut TaggedObject<T>;
        (*tagged_object).object.as_mut().map(Some).ok_or(Error {
          status: Status::InvalidArg,
          reason: "Invalid argument, nothing attach to js_object".to_owned(),
        })
      } else {
        Err(Error {
          status: Status::InvalidArg,
          reason: "Invalid argument, T on unrwap is not the type of wrapped object".to_owned(),
        })
      }
    }
  }

  #[cfg(feature = "napi8")]
  /// Registers hook, which is a function of type `FnOnce(Arg)`, as a function to be run with the `arg` parameter once the current Node.js environment exits.
  ///
  /// Unlike [`add_env_cleanup_hook`](https://docs.rs/napi/latest/napi/struct.Env.html#method.add_env_cleanup_hook), the hook is allowed to be asynchronous.
  ///
  /// Otherwise, behavior generally matches that of [`add_env_cleanup_hook`](https://docs.rs/napi/latest/napi/struct.Env.html#method.add_env_cleanup_hook).
  pub fn add_removable_async_cleanup_hook<Arg, F>(
    &self,
    arg: Arg,
    cleanup_fn: F,
  ) -> Result<AsyncCleanupHook>
  where
    F: FnOnce(Arg),
    Arg: 'static,
  {
    let mut handle = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_add_async_cleanup_hook(
        self.0,
        Some(
          async_finalize::<Arg, F>
            as unsafe extern "C" fn(handle: sys::napi_async_cleanup_hook_handle, data: *mut c_void),
        ),
        Box::leak(Box::new((arg, cleanup_fn))) as *mut (Arg, F) as *mut c_void,
        &mut handle,
      )
    })?;
    Ok(AsyncCleanupHook(handle))
  }

  #[cfg(feature = "napi8")]
  /// This API is very similar to [`add_removable_async_cleanup_hook`](https://docs.rs/napi/latest/napi/struct.Env.html#method.add_removable_async_cleanup_hook)
  ///
  /// Use this one if you don't want remove the cleanup hook anymore.
  pub fn add_async_cleanup_hook<Arg, F>(&self, arg: Arg, cleanup_fn: F) -> Result<()>
  where
    F: FnOnce(Arg),
    Arg: 'static,
  {
    check_status!(unsafe {
      sys::napi_add_async_cleanup_hook(
        self.0,
        Some(
          async_finalize::<Arg, F>
            as unsafe extern "C" fn(handle: sys::napi_async_cleanup_hook_handle, data: *mut c_void),
        ),
        Box::leak(Box::new((arg, cleanup_fn))) as *mut (Arg, F) as *mut c_void,
        ptr::null_mut(),
      )
    })
  }

  /// # Serialize `Rust Struct` into `JavaScript Value`
  ///
  /// ```
  /// #[derive(Serialize, Debug, Deserialize)]
  /// struct AnObject {
  ///     a: u32,
  ///     b: Vec<f64>,
  ///     c: String,
  /// }
  ///
  /// #[js_function]
  /// fn serialize(ctx: CallContext) -> Result<JsUnknown> {
  ///     let value = AnyObject { a: 1, b: vec![0.1, 2.22], c: "hello" };
  ///     ctx.env.to_js_value(&value)
  /// }
  /// ```
  #[cfg(feature = "serde-json")]
  #[allow(clippy::wrong_self_convention)]
  #[inline]
  pub fn to_js_value<T>(&self, node: &T) -> Result<JsUnknown>
  where
    T: Serialize,
  {
    let s = Ser(self);
    node.serialize(s).map(JsUnknown)
  }

  /// # Deserialize data from `JsValue`
  /// ```
  /// #[derive(Serialize, Debug, Deserialize)]
  /// struct AnObject {
  ///     a: u32,
  ///     b: Vec<f64>,
  ///     c: String,
  /// }
  ///
  /// #[js_function(1)]
  /// fn deserialize_from_js(ctx: CallContext) -> Result<JsUndefined> {
  ///     let arg0 = ctx.get::<JsUnknown>(0)?;
  ///     let de_serialized: AnObject = ctx.env.from_js_value(arg0)?;
  ///     ...
  /// }
  ///
  #[cfg(feature = "serde-json")]
  pub fn from_js_value<T, V>(&self, value: V) -> Result<T>
  where
    T: DeserializeOwned + ?Sized,
    V: NapiRaw,
  {
    let value = Value {
      env: self.0,
      value: unsafe { value.raw() },
      value_type: ValueType::Unknown,
    };
    let mut de = De(&value);
    T::deserialize(&mut de)
  }

  #[inline]
  /// This API represents the invocation of the Strict Equality algorithm as defined in [Section 7.2.14](https://tc39.es/ecma262/#sec-strict-equality-comparison) of the ECMAScript Language Specification.
  pub fn strict_equals<A: NapiRaw, B: NapiRaw>(&self, a: A, b: B) -> Result<bool> {
    let mut result = false;
    check_status!(unsafe { sys::napi_strict_equals(self.0, a.raw(), b.raw(), &mut result) })?;
    Ok(result)
  }

  #[inline]
  pub fn get_node_version(&self) -> Result<NodeVersion> {
    let mut result = ptr::null();
    check_status!(unsafe { sys::napi_get_node_version(self.0, &mut result) })?;
    let version = unsafe { *result };
    version.try_into()
  }

  /// get raw env ptr
  #[inline]
  pub fn raw(&self) -> sys::napi_env {
    self.0
  }
}

/// This function could be used for `create_buffer_with_borrowed_data` and want do noting when Buffer finalized.
pub fn noop_finalize<Hint>(_hint: Hint, _env: Env) {}

unsafe extern "C" fn drop_buffer(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  hint: *mut c_void,
) {
  let length_ptr = hint as *mut (usize, usize);
  let (length, cap) = *Box::from_raw(length_ptr);
  mem::drop(Vec::from_raw_parts(finalize_data as *mut u8, length, cap));
}

unsafe extern "C" fn raw_finalize<T>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let tagged_object = finalize_data as *mut TaggedObject<T>;

  println!("External finalize: {}", tagged_object.is_null());
  Box::from_raw(tagged_object);
  if !finalize_hint.is_null() {
    let size_hint = *Box::from_raw(finalize_hint as *mut Option<i64>);
    if let Some(changed) = size_hint {
      let mut adjusted = 0i64;
      let status = sys::napi_adjust_external_memory(env, -changed, &mut adjusted);
      debug_assert!(
        status == sys::Status::napi_ok,
        "Calling napi_adjust_external_memory failed"
      );
    };
  }
}

#[cfg(feature = "napi6")]
unsafe extern "C" fn set_instance_finalize_callback<T, Hint, F>(
  raw_env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) where
  T: 'static,
  Hint: 'static,
  F: FnOnce(FinalizeContext<T, Hint>),
{
  println!(
    "Finalize data in instance finalize callback {}",
    finalize_data.is_null()
  );
  let (value, callback) = *Box::from_raw(finalize_data as *mut (TaggedObject<T>, F));
  let hint = *Box::from_raw(finalize_hint as *mut Hint);
  let env = Env::from_raw(raw_env);
  callback(FinalizeContext {
    value: value.object.unwrap(),
    hint,
    env,
  });
}

#[cfg(feature = "napi3")]
unsafe extern "C" fn cleanup_env<T: 'static>(hook_data: *mut c_void) {
  let cleanup_env_hook = Box::from_raw(hook_data as *mut CleanupEnvHookData<T>);
  (cleanup_env_hook.hook)(cleanup_env_hook.data);
}

unsafe extern "C" fn raw_finalize_with_custom_callback<Hint, Finalize>(
  env: sys::napi_env,
  _finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) where
  Finalize: FnOnce(Hint, Env),
{
  let (hint, callback) = *Box::from_raw(finalize_hint as *mut (Hint, Finalize));
  callback(hint, Env::from_raw(env));
}

#[cfg(feature = "napi8")]
unsafe extern "C" fn async_finalize<Arg, F>(
  handle: sys::napi_async_cleanup_hook_handle,
  data: *mut c_void,
) where
  Arg: 'static,
  F: FnOnce(Arg),
{
  let (arg, callback) = *Box::from_raw(data as *mut (Arg, F));
  callback(arg);
  if !handle.is_null() {
    let status = sys::napi_remove_async_cleanup_hook(handle);
    assert!(
      status == sys::Status::napi_ok,
      "Remove async cleanup hook failed after async cleanup callback"
    );
  }
}
