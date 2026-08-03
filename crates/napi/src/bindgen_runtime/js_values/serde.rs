use std::marker::PhantomData;
#[cfg(feature = "napi6")]
use std::ptr;

use serde_json::{Map, Number, Value};

use crate::{
  bindgen_runtime::{Null, Object, Unknown},
  check_status, sys, type_of, Env, Error, Result, Status, ValueType,
};

#[cfg(feature = "napi6")]
use super::BigInt;
use super::{FromNapiValue, ToNapiValue};

impl ToNapiValue for &Value {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Value::Null => unsafe { Null::to_napi_value(env, Null) },
      Value::Bool(b) => unsafe { ToNapiValue::to_napi_value(env, b) },
      Value::Number(n) => unsafe { ToNapiValue::to_napi_value(env, n) },
      Value::String(s) => unsafe { ToNapiValue::to_napi_value(env, s) },
      Value::Array(arr) => unsafe { ToNapiValue::to_napi_value(env, arr) },
      Value::Object(obj) => unsafe { ToNapiValue::to_napi_value(env, obj) },
    }
  }
}

impl ToNapiValue for Value {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, &val)
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
      ValueType::BigInt => {
        let n = unsafe { BigInt::from_napi_value(env, napi_val)? };
        // negative
        if n.sign_bit {
          let (v, lossless) = n.get_i64();
          if lossless {
            Value::Number(v.into())
          } else {
            Value::String(to_string(env, napi_val)?)
          }
        } else {
          let (_, v, lossless) = n.get_u64();
          if lossless {
            Value::Number(v.into())
          } else {
            Value::String(to_string(env, napi_val)?)
          }
        }
      }
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

#[cfg(feature = "napi6")]
fn to_string(env: sys::napi_env, napi_val: sys::napi_value) -> Result<String> {
  let mut string = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_coerce_to_string(env, napi_val, &mut string) },
    "Failed to coerce to string"
  )?;
  let s = unsafe { String::from_napi_value(env, string) }?;
  Ok(s)
}

impl ToNapiValue for &Map<String, Value> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let mut obj = Object::new(&Env::from(env))?;

    for (k, v) in val.into_iter() {
      obj.set(k, v)?;
    }

    unsafe { Object::to_napi_value(env, obj) }
  }
}

impl ToNapiValue for Map<String, Value> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, &val)
  }
}

impl FromNapiValue for Map<String, Value> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let obj = Object(
      crate::Value {
        env,
        value: napi_val,
        value_type: ValueType::Object,
      },
      PhantomData,
    );

    let mut map = Map::new();
    for key in Object::keys(&obj)?.into_iter() {
      if let Some(val) = obj.get(&key)? {
        map.insert(key, val);
      }
    }

    Ok(map)
  }
}

impl ToNapiValue for &Number {
  unsafe fn to_napi_value(env: sys::napi_env, n: Self) -> Result<sys::napi_value> {
    #[cfg(feature = "napi6")]
    const MAX_SAFE_INT: i64 = 9007199254740991i64; // 2 ^ 53 - 1
    if n.is_i64() {
      let n = n.as_i64().unwrap();
      #[cfg(feature = "napi6")]
      {
        if !(-MAX_SAFE_INT..=MAX_SAFE_INT).contains(&n) {
          return unsafe { BigInt::to_napi_value(env, BigInt::from(n)) };
        }
      }

      unsafe { i64::to_napi_value(env, n) }
    } else if n.is_f64() {
      unsafe { f64::to_napi_value(env, n.as_f64().unwrap()) }
    } else {
      let n = n.as_u64().unwrap();
      if n > u32::MAX as u64 {
        #[cfg(feature = "napi6")]
        {
          unsafe { BigInt::to_napi_value(env, BigInt::from(n)) }
        }

        #[cfg(not(feature = "napi6"))]
        return unsafe { String::to_napi_value(env, n.to_string()) };
      } else {
        unsafe { u32::to_napi_value(env, n as u32) }
      }
    }
  }
}

impl ToNapiValue for Number {
  unsafe fn to_napi_value(env: sys::napi_env, n: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, &n)
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

#[cfg(feature = "napi6")]
impl Object<'_> {
  /// Convert this object into an owned [`serde_json::Value`] using napi-rs's
  /// serde bridge (the same [`FromNapiValue`] path a `serde_json::Value`
  /// function argument takes).
  ///
  /// This is **not** JavaScript's `JSON.stringify`/`JSON.parse`: it never calls a
  /// `toJSON` method, and several inputs behave differently from the ECMAScript
  /// JSON algorithm. "Safe" here means memory-safe and error-checked — it is
  /// **not** side-effect-free: reading a value can run JS getters / Proxy traps.
  /// An object is walked with `napi_get_property_names` — its **enumerable**
  /// properties, own **and inherited** (like a `for…in` loop), not own-only.
  /// Exact, tested semantics:
  ///
  /// | JS input | Result |
  /// |----------|--------|
  /// | object / array / string / boolean / `null` | converted structurally |
  /// | number | `Number` (integers narrow to `i32`/`u32` when exact) |
  /// | `undefined` | `Err(InvalidArg)` — JSON has no `undefined` (differs from `JSON.stringify`, which silently drops it) |
  /// | function | `Err(InvalidArg)` |
  /// | symbol | `Err(InvalidArg)` |
  /// | `External` | `Err(InvalidArg)` |
  /// | `BigInt` | `Number` when it fits `i64`/`u64` losslessly, otherwise its decimal `String` |
  /// | `Date` | `{}` — only enumerable own properties are read (a `Date` has none); the instant is lost. Call `.getTime()` first if you need it. |
  /// | typed array (`Uint8Array`, …) | index-keyed **object** (`{"0":…}`), never a JSON array |
  /// | native `#[napi]` class instance | typically `Err` — a napi class's methods are *enumerable* prototype members, and a method is a function (unrepresentable); the native-wrapped state is never visible either way |
  /// | a getter / Proxy trap that throws | `Err` — the thrown JS exception propagates |
  ///
  /// # Cycles are not handled
  ///
  /// There is **no cycle detection**. A self-referential object (`a.self = a`)
  /// recurses until the stack is exhausted — a hard abort, not a catchable
  /// `Err`, because the conversion is depth-first with no visited set. The caller
  /// must not pass cyclic input. (`JSON.stringify` throws a `TypeError` on cycles;
  /// this bridge cannot.)
  ///
  /// # Feature gate
  ///
  /// Requires `serde-json` **and** `napi6`. The `napi6` gate — stricter than the
  /// `serde-json` the bridge itself needs — keeps the `BigInt` row above always
  /// true: without `napi6` a `BigInt` would instead hit the catch-all error arm,
  /// and offering a method whose documented semantics silently changed with a
  /// feature is worse than not offering it on that build.
  pub fn to_serde_json_value(&self) -> Result<Value> {
    unsafe { Value::from_napi_value(self.0.env, self.0.value) }
  }
}

#[cfg(feature = "napi6")]
impl Unknown<'_> {
  /// Convert this value into an owned [`serde_json::Value`].
  ///
  /// Unlike [`Object::to_serde_json_value`], this accepts any JS value — so it is
  /// the entry point for the non-object cases (`undefined`, functions, symbols,
  /// `BigInt`, primitives) that an [`Object`] parameter would reject before the
  /// conversion ever runs. See [`Object::to_serde_json_value`] for the full,
  /// tested semantics table (including the cycle-handling caveat and feature
  /// gate), which apply identically here.
  pub fn to_serde_json_value(&self) -> Result<Value> {
    unsafe { Value::from_napi_value(self.0.env, self.0.value) }
  }
}
