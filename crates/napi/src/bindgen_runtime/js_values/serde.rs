use serde_json::{Map, Number, Value};

use crate::{
  bindgen_runtime::Null, check_status, sys, type_of, Error, JsObject, Result, Status, ValueType,
};

use super::{FromNapiValue, Object, ToNapiValue};

impl ToNapiValue for Value {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Value::Null => unsafe { Null::to_napi_value(env, Null) },
      Value::Bool(b) => unsafe { bool::to_napi_value(env, b) },
      Value::Number(n) => unsafe { Number::to_napi_value(env, n) },
      Value::String(s) => unsafe { String::to_napi_value(env, s) },
      Value::Array(arr) => unsafe { Vec::<Value>::to_napi_value(env, arr) },
      Value::Object(obj) => unsafe { Map::to_napi_value(env, obj) },
    }
  }
}

impl FromNapiValue for Value {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let ty = type_of!(env, napi_val)?;
    let val = match ty {
      ValueType::Boolean => Value::Bool(unsafe { bool::from_napi_value(env, napi_val)? }),
      ValueType::Number => Value::Number(unsafe { Number::from_napi_value(env, napi_val)? }),
      ValueType::String => Value::String(unsafe { String::from_napi_value(env, napi_val)? }),
      ValueType::Object => {
        let mut is_arr = false;
        check_status!(
          unsafe { sys::napi_is_array(env, napi_val, &mut is_arr) },
          "Failed to detect whether given js is an array"
        )?;

        if is_arr {
          Value::Array(unsafe { Vec::<Value>::from_napi_value(env, napi_val)? })
        } else {
          Value::Object(unsafe { Map::<String, Value>::from_napi_value(env, napi_val)? })
        }
      }
      #[cfg(feature = "napi6")]
      ValueType::BigInt => todo!(),
      ValueType::Null => Value::Null,
      ValueType::Function => {
        return Err(Error::new(
          Status::InvalidArg,
          "JS functions cannot be represented as a serde_json::Value".to_owned(),
        ))
      }
      ValueType::Undefined => {
        return Err(Error::new(
          Status::InvalidArg,
          "undefined cannot be represented as a serde_json::Value".to_owned(),
        ))
      }
      ValueType::Symbol => {
        return Err(Error::new(
          Status::InvalidArg,
          "JS symbols cannot be represented as a serde_json::Value".to_owned(),
        ))
      }
      ValueType::External => {
        return Err(Error::new(
          Status::InvalidArg,
          "External JS objects cannot be represented as a serde_json::Value".to_owned(),
        ))
      }
      _ => {
        return Err(Error::new(
          Status::InvalidArg,
          "Unknown JS variables cannot be represented as a serde_json::Value".to_owned(),
        ))
      }
    };

    Ok(val)
  }
}

impl ToNapiValue for Map<String, Value> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut obj = Object::new(env)?;

    for (k, v) in val.into_iter() {
      obj.set(k, v)?;
    }

    unsafe { Object::to_napi_value(env, obj) }
  }
}

impl FromNapiValue for Map<String, Value> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let obj = JsObject(crate::Value {
      env,
      value: napi_val,
      value_type: ValueType::Object,
    });

    let mut map = Map::new();
    for key in Object::keys(&obj)?.into_iter() {
      if let Some(val) = obj.get(&key)? {
        map.insert(key, val);
      }
    }

    Ok(map)
  }
}

impl ToNapiValue for Number {
  unsafe fn to_napi_value(env: sys::napi_env, n: Self) -> Result<sys::napi_value> {
    if n.is_i64() {
      unsafe { i64::to_napi_value(env, n.as_i64().unwrap()) }
    } else if n.is_f64() {
      unsafe { f64::to_napi_value(env, n.as_f64().unwrap()) }
    } else {
      let n = n.as_u64().unwrap();
      if n > u32::MAX as u64 {
        todo!("impl BigInt")
      } else {
        unsafe { u32::to_napi_value(env, n as u32) }
      }
    }
  }
}

impl FromNapiValue for Number {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let n = unsafe { f64::from_napi_value(env, napi_val)? };
    // Try to auto-convert to integers
    let n = if n.trunc() == n {
      if n >= 0.0f64 && n <= u32::MAX as f64 {
        // This can be represented as u32
        Some(Number::from(n as u32))
      } else if n < 0.0f64 && n >= i32::MIN as f64 {
        Some(Number::from(n as i32))
      } else {
        // must be a float
        Number::from_f64(n)
      }
    } else {
      // must be a float
      Number::from_f64(n)
    };

    let n = n.ok_or_else(|| {
      Error::new(
        Status::InvalidArg,
        "Failed to convert js number to serde_json::Number".to_owned(),
      )
    })?;

    Ok(n)
  }
}
