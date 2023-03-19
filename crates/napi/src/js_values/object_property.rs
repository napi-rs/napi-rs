use std::convert::From;
use std::ffi::{c_void, CString};
use std::ptr;

use bitflags::bitflags;

use crate::{sys, Callback, NapiRaw, Result, JsError, Status, Env};

#[derive(Clone)]
pub struct Property {
  pub name: CString,
  getter: sys::napi_callback,
  setter: sys::napi_callback,
  method: sys::napi_callback,
  attrs: PropertyAttributes,
  value: sys::napi_value,
  pub(crate) is_ctor: bool,
  closures: (*mut c_void, *mut c_void),
}

impl Default for Property {
  fn default() -> Self {
    Property {
      name: Default::default(),
      getter: Default::default(),
      setter: Default::default(),
      method: Default::default(),
      attrs: Default::default(),
      value: ptr::null_mut(),
      is_ctor: Default::default(),
      closures: (ptr::null_mut(), ptr::null_mut()),
    }
  }
}

bitflags! {
  #[derive(Debug, Copy, Clone)]
  pub struct PropertyAttributes: i32 {
    const Default = sys::PropertyAttributes::default;
    const Writable = sys::PropertyAttributes::writable;
    const Enumerable = sys::PropertyAttributes::enumerable;
    const Configurable = sys::PropertyAttributes::configurable;
    const Static = sys::PropertyAttributes::static_;
  }
}

impl Default for PropertyAttributes {
  fn default() -> Self {
    PropertyAttributes::Configurable | PropertyAttributes::Enumerable | PropertyAttributes::Writable
  }
}

impl From<PropertyAttributes> for sys::napi_property_attributes {
  fn from(value: PropertyAttributes) -> Self {
    value.bits()
  }
}

impl Property {
  pub fn new(name: &str) -> Result<Self> {
    Ok(Property {
      name: CString::new(name)?,
      ..Default::default()
    })
  }

  pub fn with_name(mut self, name: &str) -> Self {
    self.name = CString::new(name).unwrap();
    self
  }

  pub fn with_method(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self
  }

  pub fn with_getter(mut self, callback: Callback) -> Self {
    self.getter = Some(callback);
    self
  }

  pub fn with_getter_closure<R, F>(mut self, callback: F) -> Self where
    F: 'static + Fn(crate::CallContext<'_>) -> Result<R>,
    R: NapiRaw
  {
    use crate::CallContext;
    let boxed_callback = Box::new(callback);
    let closure_data_ptr: *mut F = Box::into_raw(boxed_callback);
    self.closures.0 = closure_data_ptr as * mut c_void;

    let fun = {
      unsafe extern "C" fn trampoline<R: NapiRaw, F: Fn(CallContext<'_>) -> Result<R>>(
        raw_env: sys::napi_env,
        cb_info: sys::napi_callback_info,
      ) -> sys::napi_value {
        use ::std::panic::{self, AssertUnwindSafe};
        panic::catch_unwind(AssertUnwindSafe(|| {
          let (raw_this, ref raw_args, getter_setter_data_pointer) = {
            let argc = {
              let mut argc = 0;
              let status = unsafe {
                sys::napi_get_cb_info(
                  raw_env,
                  cb_info,
                  &mut argc,
                  ptr::null_mut(),
                  ptr::null_mut(),
                  ptr::null_mut(),
                )
              };
              debug_assert!(
                Status::from(status) == Status::Ok,
                "napi_get_cb_info failed"
              );
              argc
            };
            let mut raw_args = vec![ptr::null_mut(); argc];
            let mut raw_this = ptr::null_mut();
            let mut getter_setter_data_pointer = ptr::null_mut();

            let status = unsafe {
              sys::napi_get_cb_info(
                raw_env,
                cb_info,
                &mut { argc },
                raw_args.as_mut_ptr(),
                &mut raw_this,
                &mut getter_setter_data_pointer,
              )
            };
            debug_assert!(
              Status::from(status) == Status::Ok,
              "napi_get_cb_info failed"
            );
            (raw_this, raw_args, getter_setter_data_pointer)
          };
          let setter_getter_pointers: * mut (*mut c_void, *mut c_void) = getter_setter_data_pointer.cast::<(*mut c_void, *mut c_void)>();
          let setter_getter = unsafe { *setter_getter_pointers };
          let closure: &F = unsafe { setter_getter.0.cast::<F>().as_ref().expect("cannot cast") };
          let env = &mut unsafe { Env::from_raw(raw_env) };
          let ctx = CallContext::new(env, cb_info, raw_this, raw_args, raw_args.len());
          closure(ctx).map(|ret: R| unsafe { ret.raw() })
        }))
          .map_err(|e| {
            crate::Error::from_reason(format!(
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
            unsafe { JsError::from(e).throw_into(raw_env) };
            ptr::null_mut()
          })
      }

      trampoline::<R, F>
    };
    self.getter = Some(fun);
    self
  }

  pub fn with_setter(mut self, callback: Callback) -> Self {
    self.setter = Some(callback);
    self
  }

  pub fn with_property_attributes(mut self, attributes: PropertyAttributes) -> Self {
    self.attrs = attributes;
    self
  }

  pub fn with_value<T: NapiRaw>(mut self, value: &T) -> Self {
    self.value = unsafe { T::raw(value) };
    self
  }

  pub(crate) fn raw(&self) -> sys::napi_property_descriptor {
    sys::napi_property_descriptor {
      utf8name: self.name.as_ptr(),
      name: ptr::null_mut(),
      method: self.method,
      getter: self.getter,
      setter: self.setter,
      value: self.value,
      attributes: self.attrs.into(),
      data: unsafe {
        let immut = &self.closures as * const (*mut c_void, *mut c_void);
        let immut2 = immut as * const c_void;
        let mut_ = immut2 as * mut c_void;
        mut_
      },
    }
  }

  pub fn with_ctor(mut self, callback: Callback) -> Self {
    self.method = Some(callback);
    self.is_ctor = true;
    self
  }
}
