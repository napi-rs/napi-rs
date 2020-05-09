extern crate futures;

use core::fmt::Debug;
use futures::prelude::*;
use std::any::TypeId;
use std::convert::{TryFrom, TryInto};
use std::ffi::CString;
use std::marker::PhantomData;
use std::mem;
use std::ops::{Deref, DerefMut};
use std::os::raw::{c_char, c_void};
use std::ptr;
use std::slice;
use std::str;
use std::string::String as RustString;

mod call_context;
mod executor;
mod promise;
pub mod sys;
mod version;

pub use call_context::CallContext;
pub use sys::{napi_valuetype, Status};
pub use version::NodeVersion;

pub type Result<T> = std::result::Result<T, Error>;
pub type Callback = extern "C" fn(sys::napi_env, sys::napi_callback_info) -> sys::napi_value;

#[derive(Debug, Clone)]
pub struct Error {
  pub status: Status,
  pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub struct Env(sys::napi_env);

// Value types
#[derive(Clone, Copy, Debug)]
pub struct Any;

#[derive(Clone, Copy, Debug)]
pub struct Undefined;

#[derive(Clone, Copy, Debug)]
pub struct Null;

#[derive(Clone, Copy, Debug)]
pub struct Boolean {
  value: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum Number {
  Int(i64),
  Int32(i32),
  U32(u32),
  Double(f64),
}

#[derive(Clone, Copy, Debug)]
pub struct JsString;

#[derive(Clone, Copy, Debug)]
pub struct Object;

#[derive(Clone, Copy, Debug)]
pub struct Function;

#[derive(Clone, Copy, Debug)]
pub struct Buffer {
  data: *const u8,
  size: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct ArrayBuffer {
  data: *const u8,
  size: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct Value<T> {
  env: sys::napi_env,
  raw_value: sys::napi_value,
  value: T,
}

pub struct Ref<T> {
  raw_env: sys::napi_env,
  raw_ref: sys::napi_ref,
  _marker: PhantomData<T>,
}

#[derive(Clone, Debug)]
pub struct Property {
  name: RustString,
  raw_descriptor: sys::napi_property_descriptor,
}

#[repr(C)]
struct TaggedObject<T> {
  type_id: TypeId,
  object: Option<T>,
}

#[macro_export]
macro_rules! register_module {
  ($module_name:ident, $init:ident) => {
    #[no_mangle]
    #[cfg_attr(target_os = "linux", link_section = ".ctors")]
    #[cfg_attr(target_os = "macos", link_section = "__DATA,__mod_init_func")]
    #[cfg_attr(target_os = "windows", link_section = ".CRT$XCU")]
    pub static __REGISTER_MODULE: extern "C" fn() = {
      use std::io::Write;
      use std::os::raw::c_char;
      use std::ptr;
      use $crate::sys;

      extern "C" fn register_module() {
        static mut MODULE_DESCRIPTOR: Option<sys::napi_module> = None;
        unsafe {
          MODULE_DESCRIPTOR = Some(sys::napi_module {
            nm_version: 1,
            nm_flags: 0,
            nm_filename: concat!(file!(), "\0").as_ptr() as *const c_char,
            nm_register_func: Some(init_module),
            nm_modname: concat!(stringify!($module_name), "\0").as_ptr() as *const c_char,
            nm_priv: 0 as *mut _,
            reserved: [0 as *mut _; 4],
          });

          sys::napi_module_register(MODULE_DESCRIPTOR.as_mut().unwrap() as *mut sys::napi_module);
        }

        extern "C" fn init_module(
          raw_env: sys::napi_env,
          raw_exports: sys::napi_value,
        ) -> sys::napi_value {
          let env = Env::from_raw(raw_env);
          let mut exports: Value<Object> = Value::from_raw(raw_env, raw_exports).unwrap();

          let result = $init(&env, &mut exports);

          match result {
            Ok(_) => exports.into_raw(),
            Err(e) => {
              unsafe {
                sys::napi_throw_error(
                  raw_env,
                  ptr::null(),
                  format!("Error initializing module: {:?}", e).as_ptr() as *const _,
                )
              };
              ptr::null_mut()
            }
          }
        }
      }

      register_module
    };
  };
}

impl Error {
  pub fn from_status(status: Status) -> Self {
    Error {
      status: status,
      reason: None,
    }
  }
}

impl From<std::ffi::NulError> for Error {
  fn from(error: std::ffi::NulError) -> Self {
    Error {
      status: Status::StringExpected,
      reason: Some(format!("{:?}", error)),
    }
  }
}

impl Env {
  pub fn from_raw(env: sys::napi_env) -> Self {
    Env(env)
  }

  pub fn get_undefined(&self) -> Result<Value<Undefined>> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_get_undefined(self.0, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Undefined))
  }

  pub fn get_null(&self) -> Result<Value<Null>> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_get_null(self.0, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Null))
  }

  pub fn get_boolean(&self, value: bool) -> Result<Value<Boolean>> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_get_boolean(self.0, value, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Boolean { value }))
  }

  pub fn create_int32(&self, int: i32) -> Result<Value<Number>> {
    let mut raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_create_int32(self.0, int, (&mut raw_value) as *mut sys::napi_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Number::Int32(int)))
  }

  pub fn create_int64(&self, int: i64) -> Result<Value<Number>> {
    let mut raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_create_int64(self.0, int, (&mut raw_value) as *mut sys::napi_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Number::Int(int)))
  }

  pub fn create_uint32(&self, number: u32) -> Result<Value<Number>> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_create_uint32(self.0, number, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Number::U32(number)))
  }

  pub fn create_double(&self, double: f64) -> Result<Value<Number>> {
    let mut raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_create_double(self.0, double, (&mut raw_value) as *mut sys::napi_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(
      self,
      raw_value,
      Number::Double(double),
    ))
  }

  pub fn create_string<'a, 'b>(&'a self, s: &'b str) -> Result<Value<JsString>> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_string_utf8(
        self.0,
        s.as_ptr() as *const c_char,
        s.len() as u64,
        &mut raw_value,
      )
    };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, JsString))
  }

  pub fn create_string_utf16(&self, chars: &[u16]) -> Result<Value<JsString>> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_string_utf16(self.0, chars.as_ptr(), chars.len() as u64, &mut raw_value)
    };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, JsString))
  }

  pub fn create_object(&self) -> Result<Value<Object>> {
    let mut raw_value = ptr::null_mut();
    let status = unsafe { sys::napi_create_object(self.0, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Object))
  }

  pub fn create_array_with_length(&self, length: usize) -> Result<Value<Object>> {
    let mut raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_create_array_with_length(self.0, length as u64, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(self, raw_value, Object))
  }

  pub fn create_buffer(&self, length: u64) -> Result<Value<Buffer>> {
    let mut raw_value = ptr::null_mut();
    let mut data = ptr::null_mut();
    let status = unsafe { sys::napi_create_buffer(self.0, length, &mut data, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(
      self,
      raw_value,
      Buffer {
        data: data as *const u8,
        size: length,
      },
    ))
  }

  pub fn create_buffer_with_data(&self, data: Vec<u8>) -> Result<Value<Buffer>> {
    let length = data.len() as u64;
    let mut raw_value = ptr::null_mut();
    let data_ptr = data.as_ptr();
    let status = unsafe {
      sys::napi_create_external_buffer(
        self.0,
        length,
        data_ptr as *mut c_void,
        Some(drop_buffer),
        Box::into_raw(Box::from(length)) as *mut c_void,
        &mut raw_value,
      )
    };
    check_status(status)?;
    let mut changed = 0;
    let ajust_external_memory_status =
      unsafe { sys::napi_adjust_external_memory(self.0, length as i64, &mut changed) };
    check_status(ajust_external_memory_status)?;
    mem::forget(data);
    Ok(Value::from_raw_value(
      self,
      raw_value,
      Buffer {
        data: data_ptr,
        size: length,
      },
    ))
  }

  pub fn create_arraybuffer(&self, length: u64) -> Result<Value<ArrayBuffer>> {
    let mut raw_value = ptr::null_mut();
    let mut data = ptr::null_mut();
    let status = unsafe { sys::napi_create_arraybuffer(self.0, length, &mut data, &mut raw_value) };
    check_status(status)?;
    Ok(Value::from_raw_value(
      self,
      raw_value,
      ArrayBuffer {
        data: data as *const u8,
        size: length,
      },
    ))
  }

  pub fn create_arraybuffer_with_data(&self, data: Vec<u8>) -> Result<Value<ArrayBuffer>> {
    let length = data.len() as u64;
    let mut raw_value = ptr::null_mut();
    let data_ptr = data.as_ptr();
    let status = unsafe {
      sys::napi_create_external_arraybuffer(
        self.0,
        data_ptr as *mut c_void,
        length,
        Some(drop_buffer),
        Box::into_raw(Box::from(length)) as *mut c_void,
        &mut raw_value,
      )
    };
    check_status(status)?;
    let mut changed = 0;
    let ajust_external_memory_status =
      unsafe { sys::napi_adjust_external_memory(self.0, length as i64, &mut changed) };
    check_status(ajust_external_memory_status)?;
    mem::forget(data);
    Ok(Value::from_raw_value(
      self,
      raw_value,
      ArrayBuffer {
        data: data_ptr,
        size: length,
      },
    ))
  }

  pub fn create_function(&self, name: &str, callback: Callback) -> Result<Value<Function>> {
    let mut raw_result = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_function(
        self.0,
        name.as_ptr() as *const c_char,
        name.len() as u64,
        Some(callback),
        callback as *mut c_void,
        &mut raw_result,
      )
    };

    check_status(status)?;

    Ok(Value::from_raw_value(self, raw_result, Function))
  }

  pub fn throw_error(&self, msg: &str) -> Result<()> {
    let status = unsafe { sys::napi_throw_error(self.0, ptr::null(), msg.as_ptr() as *const _) };
    check_status(status)?;
    Ok(())
  }

  pub fn create_reference<T>(&self, value: &Value<T>) -> Result<Ref<T>> {
    let mut raw_ref = ptr::null_mut();
    unsafe {
      let status = sys::napi_create_reference(self.0, value.raw_value, 1, &mut raw_ref);
      check_status(status)?;
    };

    Ok(Ref {
      raw_env: self.0,
      raw_ref,
      _marker: PhantomData,
    })
  }

  pub fn get_reference_value<T: ValueType>(&self, reference: &Ref<T>) -> Result<Value<T>> {
    let mut raw_value = ptr::null_mut();
    unsafe {
      let status = sys::napi_get_reference_value(self.0, reference.raw_ref, &mut raw_value);
      check_status(status)?;
    };

    Value::from_raw(self.0, raw_value)
  }

  pub fn define_class<'a, 'b>(
    &'a self,
    name: &'b str,
    constructor_cb: Callback,
    properties: Vec<Property>,
  ) -> Result<Value<Function>> {
    let mut raw_result = ptr::null_mut();
    let raw_properties = properties
      .into_iter()
      .map(|prop| prop.into_raw(self))
      .collect::<Result<Vec<sys::napi_property_descriptor>>>()?;

    let status = unsafe {
      sys::napi_define_class(
        self.0,
        name.as_ptr() as *const c_char,
        name.len() as u64,
        Some(constructor_cb),
        ptr::null_mut(),
        raw_properties.len() as u64,
        raw_properties.as_ptr(),
        &mut raw_result,
      )
    };

    check_status(status)?;

    Ok(Value::from_raw_value(self, raw_result, Function))
  }

  pub fn wrap<T: 'static>(&self, js_object: &mut Value<Object>, native_object: T) -> Result<()> {
    let status = unsafe {
      sys::napi_wrap(
        self.0,
        js_object.raw_value,
        Box::into_raw(Box::new(TaggedObject::new(native_object))) as *mut c_void,
        Some(raw_finalize::<T>),
        ptr::null_mut(),
        ptr::null_mut(),
      )
    };

    check_status(status).or(Ok(()))
  }

  pub fn unwrap<T: 'static>(&self, js_object: &Value<Object>) -> Result<&mut T> {
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      let status = sys::napi_unwrap(self.0, js_object.raw_value, &mut unknown_tagged_object);
      check_status(status)?;

      let type_id: *const TypeId = mem::transmute(unknown_tagged_object);
      if *type_id == TypeId::of::<T>() {
        let tagged_object: *mut TaggedObject<T> = mem::transmute(unknown_tagged_object);
        (*tagged_object).object.as_mut().ok_or(Error {
          status: Status::InvalidArg,
          reason: Some("Invalid argument, nothing attach to js_object".to_owned()),
        })
      } else {
        Err(Error {
          status: Status::InvalidArg,
          reason: Some(
            "Invalid argument, T on unrwap is not the type of wrapped object".to_owned(),
          ),
        })
      }
    }
  }

  pub fn drop_wrapped<T: 'static>(&self, js_object: Value<Object>) -> Result<()> {
    unsafe {
      let mut unknown_tagged_object: *mut c_void = ptr::null_mut();
      let status = sys::napi_unwrap(self.0, js_object.raw_value, &mut unknown_tagged_object);
      check_status(status)?;

      let type_id: *const TypeId = mem::transmute(unknown_tagged_object);
      if *type_id == TypeId::of::<T>() {
        let tagged_object: *mut TaggedObject<T> = mem::transmute(unknown_tagged_object);
        (*tagged_object).object = None;
        Ok(())
      } else {
        Err(Error {
          status: Status::InvalidArg,
          reason: Some(
            "Invalid argument, T on drop_wrapped is not the type of wrapped object".to_owned(),
          ),
        })
      }
    }
  }

  pub fn create_error(&self, e: Error) -> Result<Value<Object>> {
    let reason = e.reason.unwrap_or("".to_owned());
    let reason_string = self.create_string(reason.as_str())?;
    let mut result = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_error(
        self.0,
        ptr::null_mut(),
        reason_string.into_raw(),
        &mut result,
      )
    };
    check_status(status)?;
    Ok(Value::from_raw_value(self, result, Object))
  }

  pub fn perform_async_operation<
    T: 'static,
    V: 'static + ValueType,
    F: 'static + Future<Output = Result<T>>,
    R: 'static + FnOnce(&mut Env, T) -> Result<Value<V>>,
  >(
    &self,
    deferred: F,
    resolver: R,
  ) -> Result<Value<Object>> {
    let mut raw_promise = ptr::null_mut();
    let mut raw_deferred = ptr::null_mut();

    unsafe {
      let status = sys::napi_create_promise(self.0, &mut raw_deferred, &mut raw_promise);
      check_status(status)?;
    }

    let event_loop = unsafe { sys::uv_default_loop() };
    let raw_env = self.0;
    executor::execute(
      event_loop,
      promise::resolve(self.0, deferred, resolver, raw_deferred).map(move |v| match v {
        Ok(value) => value,
        Err(e) => {
          let cloned_error = e.clone();
          unsafe {
            sys::napi_throw_error(
              raw_env,
              ptr::null(),
              e.reason.unwrap_or(format!("{:?}", e.status)).as_ptr() as *const _,
            );
          };
          eprintln!("{:?}", &cloned_error);
          panic!(cloned_error);
        }
      }),
    )?;

    Ok(Value::from_raw_value(self, raw_promise, Object))
  }

  pub fn get_node_version(&self) -> Result<NodeVersion> {
    let mut result = ptr::null();
    check_status(unsafe { sys::napi_get_node_version(self.0, &mut result) })?;
    let version = unsafe { *result };
    version.try_into()
  }
}

pub trait ValueType: Copy + Debug {
  fn from_raw(env: sys::napi_env, raw: sys::napi_value) -> Result<Self>;
  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool>;
}

impl ValueType for Any {
  fn from_raw(_env: sys::napi_env, _raw: sys::napi_value) -> Result<Self> {
    Ok(Any)
  }

  fn matches_raw_type(_env: sys::napi_env, _raw: sys::napi_value) -> Result<bool> {
    Ok(true)
  }
}

impl ValueType for Undefined {
  fn from_raw(_env: sys::napi_env, _raw: sys::napi_value) -> Result<Self> {
    Ok(Undefined)
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    Ok(get_raw_type(env, raw)? == sys::napi_valuetype::napi_undefined)
  }
}

impl ValueType for Null {
  fn from_raw(_env: sys::napi_env, _raw: sys::napi_value) -> Result<Self> {
    Ok(Null)
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    Ok(get_raw_type(env, raw)? == sys::napi_valuetype::napi_null)
  }
}

impl ValueType for Boolean {
  fn from_raw(env: sys::napi_env, raw: sys::napi_value) -> Result<Self> {
    let mut value = true;
    let status = unsafe { sys::napi_get_value_bool(env, raw, &mut value) };
    check_status(status)?;
    Ok(Boolean { value })
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    Ok(get_raw_type(env, raw)? == sys::napi_valuetype::napi_boolean)
  }
}

impl ValueType for Number {
  fn from_raw(env: sys::napi_env, raw: sys::napi_value) -> Result<Self> {
    let mut double: f64 = 0.0;
    let status = unsafe { sys::napi_get_value_double(env, raw, &mut double) };
    check_status(status)?;
    Ok(Number::Double(double))
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    Ok(get_raw_type(env, raw)? == sys::napi_valuetype::napi_number)
  }
}

impl ValueType for JsString {
  fn from_raw(_env: sys::napi_env, _raw: sys::napi_value) -> Result<Self> {
    Ok(JsString {})
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    Ok(get_raw_type(env, raw)? == sys::napi_valuetype::napi_string)
  }
}

impl ValueType for Object {
  fn from_raw(_env: sys::napi_env, _raw: sys::napi_value) -> Result<Self> {
    Ok(Object {})
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    Ok(get_raw_type(env, raw)? == sys::napi_valuetype::napi_object)
  }
}

impl ValueType for Buffer {
  fn from_raw(env: sys::napi_env, raw: sys::napi_value) -> Result<Self> {
    let mut data = ptr::null_mut();
    let mut size: u64 = 0;
    let status = unsafe { sys::napi_get_buffer_info(env, raw, &mut data, &mut size) };
    check_status(status)?;
    Ok(Buffer {
      data: data as *const u8,
      size,
    })
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    let mut result = false;
    unsafe {
      let status = sys::napi_is_buffer(env, raw, &mut result);
      check_status(status)?;
    }
    Ok(result)
  }
}

impl ValueType for ArrayBuffer {
  fn from_raw(env: sys::napi_env, raw: sys::napi_value) -> Result<Self> {
    let mut data = ptr::null_mut();
    let mut size: u64 = 0;
    let status = unsafe { sys::napi_get_arraybuffer_info(env, raw, &mut data, &mut size) };
    check_status(status)?;
    Ok(ArrayBuffer {
      data: data as *const u8,
      size,
    })
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    let mut result = false;
    unsafe {
      let status = sys::napi_is_arraybuffer(env, raw, &mut result);
      check_status(status)?;
    }
    Ok(result)
  }
}

impl Value<Buffer> {
  #[inline]
  pub fn from_value(env: &Env, value: &Value<Any>) -> Result<Value<Buffer>> {
    Ok(Value {
      env: env.0,
      raw_value: value.raw_value,
      value: Buffer::from_raw(env.0, value.into_raw())?,
    })
  }
}

impl ValueType for Function {
  fn from_raw(_env: sys::napi_env, _raw: sys::napi_value) -> Result<Self> {
    Ok(Function {})
  }

  fn matches_raw_type(env: sys::napi_env, raw: sys::napi_value) -> Result<bool> {
    Ok(get_raw_type(env, raw)? == sys::napi_valuetype::napi_function)
  }
}

impl<T: ValueType> Value<T> {
  pub fn from_raw_value(env: &Env, raw_value: sys::napi_value, value: T) -> Self {
    Self {
      env: env.0,
      raw_value,
      value,
    }
  }

  pub fn from_raw(env: sys::napi_env, raw_value: sys::napi_value) -> Result<Self> {
    Ok(Self {
      env,
      raw_value,
      value: T::from_raw(env, raw_value)?,
    })
  }

  pub fn into_raw(self) -> sys::napi_value {
    self.raw_value
  }

  pub fn coerce_to_number(self) -> Result<Value<Number>> {
    let mut new_raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_coerce_to_number(self.env, self.raw_value, &mut new_raw_value) };
    check_status(status)?;
    Ok(Value {
      env: self.env,
      raw_value: self.raw_value,
      value: Number::from_raw(self.env, self.raw_value)?,
    })
  }

  pub fn coerce_to_string(self) -> Result<Value<JsString>> {
    let mut new_raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_coerce_to_string(self.env, self.raw_value, &mut new_raw_value) };
    check_status(status)?;
    Ok(Value {
      env: self.env,
      raw_value: self.raw_value,
      value: JsString,
    })
  }

  pub fn coerce_to_object(self) -> Result<Value<Object>> {
    let mut new_raw_value = ptr::null_mut();
    let status = unsafe {
      sys::napi_coerce_to_object(
        self.env,
        self.raw_value,
        (&mut new_raw_value) as *mut sys::napi_value,
      )
    };
    check_status(status)?;
    Ok(Value {
      env: self.env,
      raw_value: self.raw_value,
      value: Object,
    })
  }

  #[inline]
  pub fn into_any(self) -> Value<Any> {
    Value {
      env: self.env,
      raw_value: self.raw_value,
      value: Any,
    }
  }
}

#[inline]
fn get_raw_type(env: sys::napi_env, raw_value: sys::napi_value) -> Result<sys::napi_valuetype> {
  unsafe {
    let value_type = ptr::null_mut();
    check_status(sys::napi_typeof(env, raw_value, value_type))?;
    Ok(*value_type)
  }
}

impl Value<Boolean> {
  pub fn get_value(&self) -> bool {
    self.value.value
  }
}

impl Value<JsString> {
  pub fn len(&self) -> Result<usize> {
    let mut raw_length = ptr::null_mut();
    unsafe {
      let status = sys::napi_get_named_property(
        self.env,
        self.raw_value,
        "length\0".as_ptr() as *const c_char,
        &mut raw_length,
      );
      check_status(status)?;
    }
    let length: Value<Number> = Value::from_raw(self.env, raw_length)?;
    length.try_into()
  }
}

impl Value<JsString> {
  #[inline]
  pub fn get_ref(&self) -> Result<&[u8]> {
    let mut written_char_count: u64 = 0;
    let len = self.len()? + 1;
    let mut result = Vec::with_capacity(len);
    unsafe {
      let status = sys::napi_get_value_string_utf8(
        self.env,
        self.raw_value,
        result.as_mut_ptr(),
        len as u64,
        &mut written_char_count,
      );

      check_status(status)?;
      let ptr = result.as_ptr();
      mem::forget(result);
      Ok(slice::from_raw_parts(
        ptr as *const u8,
        written_char_count as usize,
      ))
    }
  }

  pub fn as_str(&self) -> Result<&str> {
    str::from_utf8(self.get_ref()?).map_err(|e| Error {
      status: Status::GenericFailure,
      reason: Some(format!("{:?}", e)),
    })
  }

  pub fn get_ref_mut(&mut self) -> Result<&mut [u8]> {
    let mut written_char_count: u64 = 0;
    let len = self.len()? + 1;
    let mut result = Vec::with_capacity(len);
    unsafe {
      let status = sys::napi_get_value_string_utf8(
        self.env,
        self.raw_value,
        result.as_mut_ptr(),
        len as u64,
        &mut written_char_count,
      );

      check_status(status)?;
      let ptr = result.as_ptr();
      mem::forget(result);
      Ok(slice::from_raw_parts_mut(
        ptr as *mut _,
        written_char_count as usize,
      ))
    }
  }
}

impl TryFrom<Value<JsString>> for Vec<u16> {
  type Error = Error;

  fn try_from(value: Value<JsString>) -> Result<Vec<u16>> {
    let mut result = Vec::with_capacity(value.len()? + 1); // Leave room for trailing null byte

    unsafe {
      let mut written_char_count = 0;
      let status = sys::napi_get_value_string_utf16(
        value.env,
        value.raw_value,
        result.as_mut_ptr(),
        result.capacity() as u64,
        &mut written_char_count,
      );
      check_status(status)?;
      result.set_len(written_char_count as usize);
    }

    Ok(result)
  }
}

impl TryFrom<Value<Number>> for usize {
  type Error = Error;

  fn try_from(value: Value<Number>) -> Result<usize> {
    let mut result = 0;
    let status = unsafe { sys::napi_get_value_int64(value.env, value.raw_value, &mut result) };
    check_status(status)?;
    Ok(result as usize)
  }
}

impl TryFrom<Value<Number>> for u32 {
  type Error = Error;

  fn try_from(value: Value<Number>) -> Result<u32> {
    let mut result = 0;
    let status = unsafe { sys::napi_get_value_uint32(value.env, value.raw_value, &mut result) };
    check_status(status)?;
    Ok(result)
  }
}

impl TryFrom<Value<Number>> for i32 {
  type Error = Error;

  fn try_from(value: Value<Number>) -> Result<i32> {
    let mut result = 0;
    let status = unsafe { sys::napi_get_value_int32(value.env, value.raw_value, &mut result) };
    check_status(status)?;
    Ok(result)
  }
}

impl TryFrom<Value<Number>> for i64 {
  type Error = Error;

  fn try_from(value: Value<Number>) -> Result<i64> {
    let mut result = 0;
    let status = unsafe { sys::napi_get_value_int64(value.env, value.raw_value, &mut result) };
    check_status(status)?;
    Ok(result)
  }
}

impl TryFrom<Value<Number>> for f64 {
  type Error = Error;

  fn try_from(value: Value<Number>) -> Result<f64> {
    let mut result = 0_f64;
    let status = unsafe { sys::napi_get_value_double(value.env, value.raw_value, &mut result) };
    check_status(status)?;
    Ok(result)
  }
}

impl Value<Object> {
  pub fn set_property<K, V>(&mut self, key: Value<K>, value: Value<V>) -> Result<()> {
    let status = unsafe {
      sys::napi_set_property(
        self.raw_env(),
        self.raw_value(),
        key.raw_value,
        value.raw_value,
      )
    };
    check_status(status)?;
    Ok(())
  }

  pub fn set_named_property<T, V: Into<Value<T>>>(&mut self, name: &str, value: V) -> Result<()> {
    let key = CString::new(name)?;
    let status = unsafe {
      sys::napi_set_named_property(
        self.raw_env(),
        self.raw_value(),
        key.as_ptr(),
        value.into().raw_value,
      )
    };
    check_status(status)?;
    Ok(())
  }

  pub fn get_named_property<T: ValueType>(&self, name: &str) -> Result<Value<T>> {
    let key = CString::new(name)?;
    let mut raw_value = ptr::null_mut();
    let status = unsafe {
      sys::napi_get_named_property(
        self.raw_env(),
        self.raw_value(),
        key.as_ptr(),
        &mut raw_value,
      )
    };
    check_status(status)?;
    Value::<T>::from_raw(self.env, raw_value)
  }

  pub fn get_property_names<T: ValueType>(&self) -> Result<Value<T>> {
    let mut raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_get_property_names(self.raw_env(), self.raw_value(), &mut raw_value) };
    check_status(status)?;
    Value::<T>::from_raw(self.env, raw_value)
  }

  pub fn set_index<'a, T>(&mut self, index: usize, value: Value<T>) -> Result<()> {
    self.set_property(Env::from_raw(self.env).create_int64(index as i64)?, value)
  }

  pub fn get_index<T: ValueType>(&self, index: u32) -> Result<Value<T>> {
    let mut raw_value = ptr::null_mut();
    let status =
      unsafe { sys::napi_get_element(self.raw_env(), self.raw_value(), index, &mut raw_value) };
    check_status(status)?;
    Value::<T>::from_raw(self.env, raw_value)
  }

  pub fn is_array(&self) -> Result<bool> {
    let mut is_array = false;
    let status = unsafe { sys::napi_is_array(self.raw_env(), self.raw_value(), &mut is_array) };
    check_status(status)?;
    Ok(is_array)
  }

  pub fn is_buffer(&self) -> Result<bool> {
    let mut is_buffer = false;
    let status = unsafe { sys::napi_is_buffer(self.raw_env(), self.raw_value(), &mut is_buffer) };
    check_status(status)?;
    Ok(is_buffer)
  }

  pub fn to_buffer(&self) -> Result<Value<Buffer>> {
    Value::from_raw(self.env, self.raw_value)
  }

  pub fn get_array_length(&self) -> Result<u32> {
    if self.is_array()? != true {
      return Err(Error {
        status: Status::ArrayExpected,
        reason: Some("Object is not array".to_owned()),
      });
    }
    let mut length: u32 = 0;
    let status =
      unsafe { sys::napi_get_array_length(self.raw_env(), self.raw_value(), &mut length) };
    check_status(status)?;
    Ok(length)
  }

  fn raw_value(&self) -> sys::napi_value {
    self.raw_value
  }

  fn raw_env(&self) -> sys::napi_env {
    self.env
  }
}

impl AsRef<[u8]> for Value<Buffer> {
  fn as_ref(&self) -> &[u8] {
    self.deref()
  }
}

impl Deref for Value<Buffer> {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    unsafe { slice::from_raw_parts(self.value.data, self.value.size as usize) }
  }
}

impl DerefMut for Value<Buffer> {
  fn deref_mut(&mut self) -> &mut [u8] {
    unsafe { slice::from_raw_parts_mut(self.value.data as *mut _, self.value.size as usize) }
  }
}

impl Deref for Value<ArrayBuffer> {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    unsafe { slice::from_raw_parts(self.value.data, self.value.size as usize) }
  }
}

impl DerefMut for Value<ArrayBuffer> {
  fn deref_mut(&mut self) -> &mut [u8] {
    unsafe { slice::from_raw_parts_mut(self.value.data as *mut _, self.value.size as usize) }
  }
}

impl Value<Function> {
  pub fn call(&self, this: Option<&Value<Object>>, args: &[Value<Any>]) -> Result<Value<Any>> {
    let raw_this = this
      .map(|v| v.into_raw())
      .or_else(|| {
        Env::from_raw(self.env)
          .get_undefined()
          .ok()
          .map(|u| u.into_raw())
      })
      .ok_or(Error {
        status: Status::Unknown,
        reason: Some("Get raw this failed".to_owned()),
      })?;
    let mut raw_args = unsafe { mem::MaybeUninit::<[sys::napi_value; 8]>::uninit().assume_init() };
    for (i, arg) in args.into_iter().enumerate() {
      raw_args[i] = arg.raw_value;
    }
    let mut return_value = ptr::null_mut();
    let status = unsafe {
      sys::napi_call_function(
        self.env,
        raw_this,
        self.raw_value,
        args.len() as u64,
        &raw_args[0],
        &mut return_value,
      )
    };
    check_status(status)?;

    Value::from_raw(self.env, return_value)
  }
}

impl Value<Any> {
  pub fn get_type(&self) -> Result<sys::napi_valuetype> {
    get_raw_type(self.env, self.raw_value)
  }
}

impl<T> Drop for Ref<T> {
  fn drop(&mut self) {
    unsafe {
      let mut ref_count = 0;
      let status = sys::napi_reference_unref(self.raw_env, self.raw_ref, &mut ref_count);
      debug_assert!(Status::from(status) == Status::Ok);

      if ref_count == 0 {
        let status = sys::napi_delete_reference(self.raw_env, self.raw_ref);
        debug_assert!(Status::from(status) == Status::Ok);
      }
    }
  }
}

impl Property {
  pub fn new(name: &str) -> Self {
    Property {
      name: RustString::from(name),
      raw_descriptor: sys::napi_property_descriptor {
        utf8name: ptr::null_mut(),
        name: ptr::null_mut(),
        method: None,
        getter: None,
        setter: None,
        value: ptr::null_mut(),
        attributes: sys::napi_property_attributes::napi_default,
        data: ptr::null_mut(),
      },
    }
  }

  pub fn with_value<T>(mut self, value: Value<T>) -> Self {
    self.raw_descriptor.value = value.raw_value;
    self
  }

  pub fn with_method(mut self, callback: Callback) -> Self {
    self.raw_descriptor.method = Some(callback);
    self
  }

  pub fn with_getter(mut self, callback: Callback) -> Self {
    self.raw_descriptor.getter = Some(callback);
    self
  }

  fn into_raw(mut self, env: &Env) -> Result<sys::napi_property_descriptor> {
    self.raw_descriptor.name = env.create_string(&self.name)?.into_raw();
    Ok(self.raw_descriptor)
  }
}

impl<T: 'static> TaggedObject<T> {
  fn new(object: T) -> Self {
    TaggedObject {
      type_id: TypeId::of::<T>(),
      object: Some(object),
    }
  }
}

#[inline]
fn check_status(code: sys::napi_status) -> Result<()> {
  let status = Status::from(code);
  match status {
    Status::Ok => Ok(()),
    _ => Err(Error::from_status(status)),
  }
}

unsafe extern "C" fn raw_finalize<T>(
  _raw_env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  let tagged_object: *mut TaggedObject<T> = mem::transmute(finalize_data);
  Box::from_raw(tagged_object);
}

unsafe extern "C" fn drop_buffer(env: sys::napi_env, finalize_data: *mut c_void, len: *mut c_void) {
  let length = Box::from_raw(len as *mut u64);
  let length = length.as_ref();
  let length = *length as usize;
  let _ = Vec::from_raw_parts(finalize_data as *mut u8, length, length);
  let mut changed = 0;
  let ajust_external_memory_status =
    sys::napi_adjust_external_memory(env, -(length as i64), &mut changed);
  debug_assert!(Status::from(ajust_external_memory_status) == Status::Ok);
}
