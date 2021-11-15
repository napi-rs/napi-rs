use std::cell::RefCell;
use std::ptr;

use crate::{check_status, sys, JsGlobal, JsNull, JsUndefined, NapiValue, Result};

use super::Array;

pub use crate::Env;

thread_local! {
  static JS_UNDEFINED: RefCell<Option<JsUndefined>> = RefCell::default();
  static JS_NULL: RefCell<Option<JsNull>> = RefCell::default();
}

impl Env {
  pub fn create_array(&self, len: u32) -> Result<Array> {
    Array::new(self.0, len)
  }

  /// Get [JsUndefined](./struct.JsUndefined.html) value
  pub fn get_undefined(&self) -> Result<JsUndefined> {
    if let Some(js_undefined) = JS_UNDEFINED.with(|x| *x.borrow()) {
      return Ok(js_undefined);
    }
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_undefined(self.0, &mut raw_value) })?;
    let js_undefined = unsafe { JsUndefined::from_raw_unchecked(self.0, raw_value) };
    JS_UNDEFINED.with(|x| x.borrow_mut().replace(js_undefined));
    Ok(js_undefined)
  }

  pub fn get_null(&self) -> Result<JsNull> {
    if let Some(js_null) = JS_NULL.with(|cell| *cell.borrow()) {
      return Ok(js_null);
    }
    let mut raw_value = ptr::null_mut();
    check_status!(unsafe { sys::napi_get_null(self.0, &mut raw_value) })?;
    let js_null = unsafe { JsNull::from_raw_unchecked(self.0, raw_value) };
    JS_NULL.with(|js_null_cell| {
      js_null_cell.borrow_mut().replace(js_null);
    });
    Ok(js_null)
  }

  pub fn get_global(&self) -> Result<JsGlobal> {
    let mut global = std::ptr::null_mut();
    crate::check_status!(
      unsafe { sys::napi_get_global(self.0, &mut global) },
      "Get global object from Env failed"
    )?;
    Ok(JsGlobal(crate::Value {
      value: global,
      env: self.0,
      value_type: crate::ValueType::Object,
    }))
  }
}
