use serde_json::{Map, Value};

use crate::{
  bindgen_runtime::Null, check_status, sys, type_of, Error, JsObject, Result, Status, ValueType,
};

use super::{FromNapiValue, Object, ToNapiValue};

impl ToNapiValue for Value {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Value::Null => unsafe { Null::to_napi_value(env, Null) },
      Value::Bool(b) => unsafe { bool::to_napi_value(env, b) },
      Value::Number(n) => {
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
      ValueType::Number => {
        return Err(Error::new(
          Status::InvalidArg,
          "Js Number is not be able to convert to rust.".to_owned(),
        ));
      }
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
      _ => Value::Null,
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
