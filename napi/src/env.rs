use std::any::TypeId;
use std::convert::TryInto;
use std::ffi::CString;
use std::mem;
use std::os::raw::{c_char, c_void};
use std::ptr;

use super::cleanup_env::{CleanupEnvHook, CleanupEnvHookData};
use crate::async_work::{self, AsyncWorkPromise};
use crate::error::check_status;
use crate::js_values::*;
use crate::task::Task;
use crate::{sys, Error, NodeVersion, Result, Status};

#[cfg(all(feature = "serde-json"))]
use crate::js_values::{De, Ser};
#[cfg(all(any(feature = "libuv", feature = "tokio_rt"), feature = "napi4"))]
use crate::promise;
#[cfg(feature = "napi4")]
use crate::threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction};
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
use crate::tokio_rt::{get_tokio_sender, Message};
#[cfg(all(feature = "libuv", feature = "napi4"))]
use crate::uv;
#[cfg(all(feature = "serde-json"))]
use serde::de::DeserializeOwned;
#[cfg(all(feature = "serde-json"))]
use serde::Serialize;
#[cfg(all(feature = "libuv", feature = "napi4"))]
use std::future::Future;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
use tokio::sync::mpsc::error::TrySendError;

pub type Callback = extern "C" fn(sys::napi_env, sys::napi_callback_info) -> sys::napi_value;

#[repr(transparent)]
#[derive(Clone, Copy, Debug)]
pub struct Env(pub(crate) sys::napi_env);

impl Env {
  pub fn from_raw(env: sys::napi_env) -> Self {
    Env(env)
  }

  pub fn get_undefined(&self) -> Result<JsUndefined> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_get_undefined(self.0, &mut raw_value) })?;
    Ok(JsUndefined::from_raw_unchecked(self.0, raw_value))
  }

  pub fn get_null(&self) -> Result<JsNull> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_get_null(self.0, &mut raw_value) })?;
    Ok(JsNull::from_raw_unchecked(self.0, raw_value))
  }

  pub fn get_boolean(&self, value: bool) -> Result<JsBoolean> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_get_boolean(self.0, value, &mut raw_value) })?;
    Ok(JsBoolean::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_int32(&self, int: i32) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_int32(self.0, int, (&mut raw_value) as *mut sys::napi_value)
    })?;
    Ok(JsNumber::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_int64(&self, int: i64) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_int64(self.0, int, (&mut raw_value) as *mut sys::napi_value)
    })?;
    Ok(JsNumber::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_uint32(&self, number: u32) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_create_uint32(self.0, number, &mut raw_value) })?;
    Ok(JsNumber::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_double(&self, double: f64) -> Result<JsNumber> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_double(self.0, double, (&mut raw_value) as *mut sys::napi_value)
    })?;
    Ok(JsNumber::from_raw_unchecked(self.0, raw_value))
  }

  #[cfg(feature = "napi6")]
  /// [n_api_napi_create_bigint_int64](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_int64)
  pub fn create_bigint_from_i64(&self, value: i64) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_create_bigint_int64(self.0, value, &mut raw_value) })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  #[cfg(feature = "napi6")]
  pub fn create_bigint_from_u64(&self, value: u64) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_create_bigint_uint64(self.0, value, &mut raw_value) })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  #[cfg(feature = "napi6")]
  pub fn create_bigint_from_i128(&self, value: i128) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    let sign_bit = if value > 0 { 0 } else { 1 };
    let words = &value as *const i128 as *const u64;
    check_status(unsafe {
      sys::napi_create_bigint_words(self.0, sign_bit, 2, words, &mut raw_value)
    })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  #[cfg(feature = "napi6")]
  pub fn create_bigint_from_u128(&self, value: u128) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    let words = &value as *const u128 as *const u64;
    check_status(unsafe { sys::napi_create_bigint_words(self.0, 0, 2, words, &mut raw_value) })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, 1))
  }

  #[cfg(feature = "napi6")]
  /// [n_api_napi_create_bigint_words](https://nodejs.org/api/n-api.html#n_api_napi_create_bigint_words)
  /// The resulting BigInt will be negative when sign_bit is true.
  pub fn create_bigint_from_words(&self, sign_bit: bool, words: Vec<u64>) -> Result<JsBigint> {
    let mut raw_value = ptr::null_mut();
    let len = words.len();
    check_status(unsafe {
      sys::napi_create_bigint_words(
        self.0,
        match sign_bit {
          true => 1,
          false => 0,
        },
        len as _,
        words.as_ptr(),
        &mut raw_value,
      )
    })?;
    Ok(JsBigint::from_raw_unchecked(self.0, raw_value, len as _))
  }

  pub fn create_string(&self, s: &str) -> Result<JsString> {
    self.create_string_from_chars(s.as_ptr() as *const c_char, s.len())
  }

  pub fn create_string_from_std(&self, s: String) -> Result<JsString> {
    self.create_string_from_chars(s.as_ptr() as *const c_char, s.len())
  }

  pub fn create_string_from_vec_u8(&self, bytes: Vec<u8>) -> Result<JsString> {
    self.create_string_from_chars(bytes.as_ptr() as *const c_char, bytes.len())
  }

  pub fn create_string_from_vec_i8(&self, bytes: Vec<i8>) -> Result<JsString> {
    self.create_string_from_chars(bytes.as_ptr() as *const c_char, bytes.len())
  }

  fn create_string_from_chars(&self, data_ptr: *const c_char, len: usize) -> Result<JsString> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_string_utf8(self.0, data_ptr, len as _, &mut raw_value)
    })?;
    Ok(JsString::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_string_utf16(&self, chars: &[u16]) -> Result<JsString> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_string_utf16(self.0, chars.as_ptr(), chars.len() as _, &mut raw_value)
    })?;
    Ok(JsString::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_string_latin1(&self, chars: &[u8]) -> Result<JsString> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_string_latin1(
        self.0,
        chars.as_ptr() as *const _,
        chars.len() as _,
        &mut raw_value,
      )
    })?;
    Ok(JsString::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_symbol_from_js_string(&self, description: JsString) -> Result<JsSymbol> {
    let mut result = ptr::null_mut();
    check_status(unsafe { sys::napi_create_symbol(self.0, description.0.value, &mut result) })?;
    Ok(JsSymbol::from_raw_unchecked(self.0, result))
  }

  pub fn create_symbol(&self, description: Option<&str>) -> Result<JsSymbol> {
    let mut result = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_symbol(
        self.0,
        description
          .and_then(|desc| self.create_string(desc).ok())
          .map(|string| string.0.value)
          .unwrap_or(ptr::null_mut()),
        &mut result,
      )
    })?;
    Ok(JsSymbol::from_raw_unchecked(self.0, result))
  }

  pub fn create_object(&self) -> Result<JsObject> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_create_object(self.0, &mut raw_value) })?;
    Ok(JsObject::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_array(&self) -> Result<JsObject> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe { sys::napi_create_array(self.0, &mut raw_value) })?;
    Ok(JsObject::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_array_with_length(&self, length: usize) -> Result<JsObject> {
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_array_with_length(self.0, length as _, &mut raw_value)
    })?;
    Ok(JsObject::from_raw_unchecked(self.0, raw_value))
  }

  pub fn create_buffer(&self, length: usize) -> Result<JsBufferValue> {
    let mut raw_value = ptr::null_mut();
    let mut data: Vec<u8> = Vec::with_capacity(length);
    let mut data_ptr = data.as_mut_ptr() as *mut c_void;
    check_status(unsafe {
      sys::napi_create_buffer(self.0, length as _, &mut data_ptr, &mut raw_value)
    })?;

    Ok(JsBufferValue::new(
      JsBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      data,
    ))
  }

  pub fn create_buffer_with_data(&self, mut data: Vec<u8>) -> Result<JsBufferValue> {
    let mut length = data.len();
    let mut raw_value = ptr::null_mut();
    let data_ptr = data.as_mut_ptr();
    check_status(unsafe {
      sys::napi_create_external_buffer(
        self.0,
        length as _,
        data_ptr as *mut c_void,
        Some(drop_buffer),
        &mut length as *mut usize as *mut _,
        &mut raw_value,
      )
    })?;
    let mut changed = 0;
    check_status(unsafe { sys::napi_adjust_external_memory(self.0, length as i64, &mut changed) })?;
    Ok(JsBufferValue::new(
      JsBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      data,
    ))
  }

  pub fn create_buffer_copy<D>(&self, data_to_copy: D) -> Result<JsBufferValue>
  where
    D: AsRef<[u8]>,
  {
    let length = data_to_copy.as_ref().len();
    let data_ptr = data_to_copy.as_ref().as_ptr();
    let mut copy_data = ptr::null_mut();
    let mut raw_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_buffer_copy(
        self.0,
        length as _,
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
      unsafe { Vec::from_raw_parts(copy_data as *mut u8, length, length) },
    ))
  }

  pub fn create_arraybuffer(&self, length: usize) -> Result<JsArrayBufferValue> {
    let mut raw_value = ptr::null_mut();
    let mut data: Vec<u8> = Vec::with_capacity(length as usize);
    let mut data_ptr = data.as_mut_ptr() as *mut c_void;
    check_status(unsafe {
      sys::napi_create_arraybuffer(self.0, length as _, &mut data_ptr, &mut raw_value)
    })?;

    Ok(JsArrayBufferValue::new(
      JsArrayBuffer::from_raw_unchecked(self.0, raw_value),
      data,
    ))
  }

  pub fn create_arraybuffer_with_data(&self, data: Vec<u8>) -> Result<JsArrayBufferValue> {
    let mut length = data.len();
    let mut raw_value = ptr::null_mut();
    let data_ptr = data.as_ptr();
    check_status(unsafe {
      sys::napi_create_external_arraybuffer(
        self.0,
        data_ptr as *mut c_void,
        length as _,
        Some(drop_buffer),
        &mut length as *mut usize as *mut c_void,
        &mut raw_value,
      )
    })?;
    let mut changed = 0;
    check_status(unsafe { sys::napi_adjust_external_memory(self.0, length as i64, &mut changed) })?;

    Ok(JsArrayBufferValue::new(
      JsArrayBuffer(Value {
        env: self.0,
        value: raw_value,
        value_type: ValueType::Object,
      }),
      data,
    ))
  }

  pub fn create_function(&self, name: &str, callback: Callback) -> Result<JsFunction> {
    let mut raw_result = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_function(
        self.0,
        name.as_ptr() as *const c_char,
        name.len() as _,
        Some(callback),
        callback as *mut c_void,
        &mut raw_result,
      )
    })?;

    Ok(JsFunction::from_raw_unchecked(self.0, raw_result))
  }

  pub fn throw(&self, error: Error) -> Result<()> {
    let err_value = self.create_error(error)?.0.value;
    check_status(unsafe { sys::napi_throw(self.0, err_value) })?;
    Ok(())
  }

  pub fn throw_error(&self, msg: &str) -> Result<()> {
    check_status(unsafe {
      sys::napi_throw_error(
        self.0,
        ptr::null(),
        CString::from_vec_unchecked(msg.into()).as_ptr() as *const _,
      )
    })
  }

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

    check_status(unsafe {
      sys::napi_define_class(
        self.0,
        name.as_ptr() as *const c_char,
        name.len() as _,
        Some(constructor_cb),
        ptr::null_mut(),
        raw_properties.len() as _,
        raw_properties.as_ptr(),
        &mut raw_result,
      )
    })?;

    Ok(JsFunction::from_raw_unchecked(self.0, raw_result))
  }

  pub fn wrap<T: 'static>(&self, js_object: &mut JsObject, native_object: T) -> Result<()> {
    check_status(unsafe {
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

  pub fn unwrap<T: 'static>(&self, js_object: &JsObject) -> Result<&mut T> {
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      check_status(sys::napi_unwrap(
        self.0,
        js_object.0.value,
        &mut unknown_tagged_object,
      ))?;

      let type_id: *const TypeId = mem::transmute(unknown_tagged_object);
      if *type_id == TypeId::of::<T>() {
        let tagged_object: *mut TaggedObject<T> = mem::transmute(unknown_tagged_object);
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

  pub fn drop_wrapped<T: 'static>(&self, js_object: JsObject) -> Result<()> {
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      check_status(sys::napi_unwrap(
        self.0,
        js_object.0.value,
        &mut unknown_tagged_object,
      ))?;

      let type_id: *const TypeId = mem::transmute(unknown_tagged_object);
      if *type_id == TypeId::of::<T>() {
        let tagged_object: *mut TaggedObject<T> = mem::transmute(unknown_tagged_object);
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

  pub fn create_external<T: 'static>(&self, native_object: T) -> Result<JsExternal> {
    let mut object_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_external(
        self.0,
        Box::into_raw(Box::new(TaggedObject::new(native_object))) as *mut c_void,
        Some(raw_finalize::<T>),
        ptr::null_mut(),
        &mut object_value,
      )
    })?;
    Ok(JsExternal::from_raw_unchecked(self.0, object_value))
  }

  pub fn get_value_external<T: 'static>(&self, js_external: &JsExternal) -> Result<&mut T> {
    unsafe {
      let mut unknown_tagged_object = ptr::null_mut();
      check_status(sys::napi_get_value_external(
        self.0,
        js_external.0.value,
        &mut unknown_tagged_object,
      ))?;

      let type_id: *const TypeId = mem::transmute(unknown_tagged_object);
      if *type_id == TypeId::of::<T>() {
        let tagged_object: *mut TaggedObject<T> = mem::transmute(unknown_tagged_object);
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

  pub fn create_error(&self, e: Error) -> Result<JsObject> {
    let reason = e.reason;
    let reason_string = self.create_string(reason.as_str())?;
    let mut result = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_error(self.0, ptr::null_mut(), reason_string.0.value, &mut result)
    })?;
    Ok(JsObject::from_raw_unchecked(self.0, result))
  }

  pub fn spawn<T: 'static + Task>(&self, task: T) -> Result<AsyncWorkPromise> {
    async_work::run(self, task)
  }

  pub fn run_in_scope<T, F>(&self, executor: F) -> Result<T>
  where
    F: FnOnce() -> Result<T>,
  {
    let mut handle_scope = ptr::null_mut();
    check_status(unsafe { sys::napi_open_handle_scope(self.0, &mut handle_scope) })?;

    let result = executor();

    check_status(unsafe { sys::napi_close_handle_scope(self.0, handle_scope) })?;
    result
  }

  pub fn get_global(&self) -> Result<JsGlobal> {
    let mut raw_global = ptr::null_mut();
    check_status(unsafe { sys::napi_get_global(self.0, &mut raw_global) })?;
    Ok(JsGlobal::from_raw_unchecked(self.0, raw_global))
  }

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
  pub fn get_uv_event_loop(&self) -> Result<*mut sys::uv_loop_s> {
    let mut uv_loop: *mut sys::uv_loop_s = ptr::null_mut();
    check_status(unsafe { sys::napi_get_uv_event_loop(self.0, &mut uv_loop) })?;
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
    F: 'static + FnOnce(T) -> (),
  {
    let hook = CleanupEnvHookData {
      data: cleanup_data,
      hook: Box::new(cleanup_fn),
    };
    let hook_ref = Box::leak(Box::new(hook));
    check_status(unsafe {
      sys::napi_add_env_cleanup_hook(
        self.0,
        Some(cleanup_env::<T>),
        hook_ref as *mut CleanupEnvHookData<T> as *mut _,
      )
    })?;
    Ok(CleanupEnvHook(hook_ref))
  }

  #[cfg(feature = "napi3")]
  pub fn remove_env_cleanup_hook<T>(&mut self, hook: CleanupEnvHook<T>) -> Result<()>
  where
    T: 'static,
  {
    check_status(unsafe {
      sys::napi_remove_env_cleanup_hook(self.0, Some(cleanup_env::<T>), hook.0 as *mut _)
    })
  }

  #[cfg(feature = "napi4")]
  pub fn create_threadsafe_function<
    T: Send,
    V: NapiValue,
    R: 'static + Send + FnMut(ThreadSafeCallContext<T>) -> Result<Vec<V>>,
  >(
    &self,
    func: JsFunction,
    max_queue_size: usize,
    callback: R,
  ) -> Result<ThreadsafeFunction<T>> {
    ThreadsafeFunction::create(self.0, func, max_queue_size, callback)
  }

  #[cfg(all(feature = "libuv", feature = "napi4"))]
  pub fn execute<
    T: 'static + Send,
    V: 'static + NapiValue,
    F: 'static + Future<Output = Result<T>>,
    R: 'static + Send + Sync + FnOnce(&mut Env, T) -> Result<V>,
  >(
    &self,
    deferred: F,
    resolver: R,
  ) -> Result<JsObject> {
    let mut raw_promise = ptr::null_mut();
    let mut raw_deferred = ptr::null_mut();

    check_status(unsafe { sys::napi_create_promise(self.0, &mut raw_deferred, &mut raw_promise) })?;

    let event_loop = self.get_uv_event_loop()?;
    let future_promise = promise::FuturePromise::create(self.0, raw_deferred, Box::from(resolver))?;
    let future_to_execute = promise::resolve_from_future(future_promise.start()?, deferred);
    uv::execute(event_loop, Box::pin(future_to_execute))?;

    Ok(JsObject::from_raw_unchecked(self.0, raw_promise))
  }

  #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
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
    let mut raw_promise = ptr::null_mut();
    let mut raw_deferred = ptr::null_mut();
    check_status(unsafe { sys::napi_create_promise(self.0, &mut raw_deferred, &mut raw_promise) })?;

    let raw_env = self.0;
    let future_promise =
      promise::FuturePromise::create(raw_env, raw_deferred, Box::from(resolver))?;
    let future_to_resolve = promise::resolve_from_future(future_promise.start()?, fut);
    let sender = get_tokio_sender().clone();
    sender
      .try_send(Message::Task(Box::pin(future_to_resolve)))
      .map_err(|e| match e {
        TrySendError::Full(_) => Error::new(
          Status::QueueFull,
          format!("Failed to run future: no available capacity"),
        ),
        TrySendError::Closed(_) => Error::new(
          Status::Closing,
          format!("Failed to run future: receiver closed"),
        ),
      })?;
    Ok(JsObject::from_raw_unchecked(self.0, raw_promise))
  }

  #[cfg(feature = "napi5")]
  pub fn create_date(&self, time: f64) -> Result<JsDate> {
    let mut js_value = ptr::null_mut();
    check_status(unsafe { sys::napi_create_date(self.0, time, &mut js_value) })?;
    Ok(JsDate::from_raw_unchecked(self.0, js_value))
  }

  /// # Serialize `Rust Struct` into `JavaScript Value`
  /// ```
  /// #[derive(Serialize, Debug, Deserialize)]
  /// struct AnObject {
  ///   a: u32,
  ///   b: Vec<f64>,
  ///   c: String,
  /// }
  ///
  /// #[js_function]
  /// fn serialize(ctx: CallContext) -> Result<JsUnknown> {
  ///   let value = AnyObject { a: 1, b: vec![0.1, 2.22], c: "hello" };
  ///   ctx.env.to_js_value(&value)
  /// }
  /// ```
  #[cfg(feature = "serde-json")]
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
  ///  a: u32,
  ///  b: Vec<f64>,
  ///  c: String,
  /// }
  ///
  /// #[js_function(1)]
  /// fn deserialize_from_js(ctx: CallContext) -> Result<JsUndefined> {
  ///   let arg0 = ctx.get::<JsUnknown>(0)?;
  ///   let de_serialized: AnObject = ctx.env.from_js_value(arg0)?;
  ///   ...
  /// }
  ///
  #[cfg(feature = "serde-json")]
  pub fn from_js_value<T, V>(&self, value: V) -> Result<T>
  where
    T: DeserializeOwned + ?Sized,
    V: NapiValue,
  {
    let value = Value {
      env: self.0,
      value: value.raw(),
      value_type: ValueType::Unknown,
    };
    let mut de = De(&value);
    T::deserialize(&mut de)
  }

  pub fn strict_equals<A: NapiValue, B: NapiValue>(&self, a: A, b: B) -> Result<bool> {
    let mut result = false;
    check_status(unsafe { sys::napi_strict_equals(self.0, a.raw(), b.raw(), &mut result) })?;
    Ok(result)
  }

  pub fn get_node_version(&self) -> Result<NodeVersion> {
    let mut result = ptr::null();
    check_status(unsafe { sys::napi_get_node_version(self.0, &mut result) })?;
    let version = unsafe { *result };
    version.try_into()
  }
}

unsafe extern "C" fn drop_buffer(env: sys::napi_env, finalize_data: *mut c_void, len: *mut c_void) {
  let length = len as *mut u64;
  let length = *length as usize;
  let _ = Vec::from_raw_parts(finalize_data as *mut u8, length, length);
  let mut changed = 0;
  let adjust_external_memory_status =
    sys::napi_adjust_external_memory(env, -(length as i64), &mut changed);
  debug_assert!(Status::from(adjust_external_memory_status) == Status::Ok);
}

unsafe extern "C" fn raw_finalize<T>(
  _raw_env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  let tagged_object: *mut TaggedObject<T> = mem::transmute(finalize_data);
  Box::from_raw(tagged_object);
}

unsafe extern "C" fn cleanup_env<T: 'static>(hook_data: *mut c_void) {
  let cleanup_env_hook = Box::from_raw(hook_data as *mut CleanupEnvHookData<T>);
  (cleanup_env_hook.hook)(cleanup_env_hook.data);
}
