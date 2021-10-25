use std::collections::HashMap;
use std::hash::Hash;

use crate::bindgen_prelude::{Env, Result, ToNapiValue, *};

impl<K, V> TypeName for HashMap<K, V> {
  fn type_name() -> &'static str {
    "HashMap"
  }
}

impl<K, V> ToNapiValue for HashMap<K, V>
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

    Object::to_napi_value(raw_env, obj)
  }
}

impl<K, V> FromNapiValue for HashMap<K, V>
where
  K: From<String> + Eq + Hash,
  V: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let obj = Object::from_napi_value(env, napi_val)?;
    let mut map = HashMap::new();
    for key in Object::keys(&obj)?.into_iter() {
      if let Some(val) = obj.get(&key)? {
        map.insert(K::from(key), val);
      }
    }

    Ok(map)
  }
}
