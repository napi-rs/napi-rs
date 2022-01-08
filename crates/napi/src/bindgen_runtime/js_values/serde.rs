use serde_json::{Map, Number, Value};

use crate::{
  bindgen_runtime::Null, check_status, sys, type_of, Error, JsObject, Result, Status, ValueType,
};

use super::{FromNapiValue, Object, ToNapiValue};

impl ToNapiValue for Value {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Value::Null => Null::to_napi_value(env, Null),
      Value::Bool(b) => bool::to_napi_value(env, b),
      Value::Number(n) => Number::to_napi_value(env, n),
      Value::String(s) => String::to_napi_value(env, s),
      Value::Array(arr) => Vec::<Value>::to_napi_value(env, arr),
      Value::Object(obj) => Map::to_napi_value(env, obj),
    }
  }
}

impl FromNapiValue for Value {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let ty = type_of!(env, napi_val)?;
    let val = match ty {
      ValueType::Boolean => Value::Bool(bool::from_napi_value(env, napi_val)?),
      ValueType::Number => Value::Number(Number::from_napi_value(env, napi_val)?),
      ValueType::String => Value::String(String::from_napi_value(env, napi_val)?),
      ValueType::Object => {
        let mut is_arr = false;
        check_status!(
          sys::napi_is_array(env, napi_val, &mut is_arr),
          "Failed to detect whether given js is an array"
        )?;

        if is_arr {
          Value::Array(Vec::<Value>::from_napi_value(env, napi_val)?)
        } else {
          Value::Object(Map::<String, Value>::from_napi_value(env, napi_val)?)
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

    Object::to_napi_value(env, obj)
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
      i64::to_napi_value(env, n.as_i64().unwrap())
    } else if n.is_f64() {
      f64::to_napi_value(env, n.as_f64().unwrap())
    } else {
      let n = n.as_u64().unwrap();
      if n > u32::MAX as u64 {
        todo!("impl BigInt")
      } else {
        u32::to_napi_value(env, n as u32)
      }
    }
  }
}

impl FromNapiValue for Number {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Number::from_f64(f64::from_napi_value(env, napi_val)?).ok_or_else(|| {
      Error::new(
        Status::InvalidArg,
        "Failed to convert js number to serde_json::Number".to_owned(),
      )
    })
  }
}
