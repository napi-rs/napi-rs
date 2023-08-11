use std::collections::HashMap;
use std::hash::{BuildHasher, Hash};

use crate::bindgen_prelude::{Env, Result, ToNapiValue, *};

impl<K, V, S> TypeName for HashMap<K, V, S> {
  fn type_name() -> &'static str {
    "HashMap"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl<K: From<String> + Eq + Hash, V: FromNapiValue> ValidateNapiValue for HashMap<K, V> {}

impl<K, V, S> ToNapiValue for HashMap<K, V, S>
where
  K: AsRef<str>,
  V: ToNapiValue,
{
  unsafe fn to_napi_value(raw_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let env = Env::from(raw_env);
    let mut obj = env.create_object()?;
    for (k, v) in val.into_iter() {
      obj.set(k.as_ref(), v)?;
    }

    unsafe { Object::to_napi_value(raw_env, obj) }
  }
}

impl<K, V, S> FromNapiValue for HashMap<K, V, S>
where
  K: From<String> + Eq + Hash,
  V: FromNapiValue,
  S: Default + BuildHasher,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let obj = unsafe { Object::from_napi_value(env, napi_val)? };
    let mut map = HashMap::default();
    for key in Object::keys(&obj)?.into_iter() {
      if let Some(val) = obj.get(&key)? {
        map.insert(K::from(key), val);
      }
    }

    Ok(map)
  }
}
