use std::{ffi::CString, ptr};

use crate::{check_status, sys};

use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};

pub struct Symbol {
  desc: Option<String>,
}

impl TypeName for Symbol {
  fn type_name() -> &'static str {
    "Symbol"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Symbol
  }
}

impl ValidateNapiValue for Symbol {}

impl Symbol {
  pub fn new(desc: String) -> Self {
    Self { desc: Some(desc) }
  }

  pub fn identity() -> Self {
    Self { desc: None }
  }
}

impl ToNapiValue for Symbol {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let mut symbol_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_symbol(
        env,
        match val.desc {
          Some(desc) => {
            let mut desc_string = ptr::null_mut();
            let desc_len = desc.len();
            let desc_c_string = CString::new(desc)?;
            check_status!(sys::napi_create_string_utf8(
              env,
              desc_c_string.as_ptr(),
              desc_len,
              &mut desc_string
            ))?;
            desc_string
          }
          None => ptr::null_mut(),
        },
        &mut symbol_value,
      )
    })?;
    Ok(symbol_value)
  }
}

impl FromNapiValue for Symbol {
  unsafe fn from_napi_value(
    _env: sys::napi_env,
    _napi_val: sys::napi_value,
  ) -> crate::Result<Self> {
    Ok(Self { desc: None })
  }
}
