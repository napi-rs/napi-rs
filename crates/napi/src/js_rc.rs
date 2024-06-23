use once_cell::unsync::{Lazy, OnceCell};
use std::cell::RefCell;
use std::ops::Deref;
use std::rc::Rc;

use super::Value;
use crate::{sys, Env, JsNumber, JsObject, NapiValue, Result};

thread_local! {
  /// Basic unique key generation
  static COUNT: Lazy<RefCell<u32>> = Lazy::new(|| Default::default());
  static CACHE_KEY: OnceCell<u32> = OnceCell::default();
}

/// Reference counted JavaScript value with a static lifetime for use in async closures
pub struct JsRc<T> {
  pub(crate) raw_env: sys::napi_env,
  pub(crate) count: Rc<RefCell<u32>>,
  pub(crate) inner_key: Rc<u32>,
  pub(crate) inner: T,
}

#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl<T> Send for JsRc<T> {}
unsafe impl<T> Sync for JsRc<T> {}

impl<T: NapiValue> JsRc<T> {
  pub(crate) fn new(js_value: Value) -> Result<JsRc<T>> {
    let env = unsafe { Env::from_raw(js_value.env) };
    let value = unsafe { T::from_raw(js_value.env, js_value.value) }?;
    let value_container = unsafe { T::from_raw(js_value.env, js_value.value) }?;
    let inner_key = set_ref(&env, value_container)?;

    Ok(Self {
      raw_env: js_value.env,
      count: Rc::new(RefCell::new(1)),
      inner_key: Rc::new(inner_key),
      inner: value,
    })
  }

  pub fn clone(&self, env: &Env) -> Result<JsRc<T>> {
    let mut count = self.count.borrow_mut();
    *count += 1;

    Ok(Self {
      raw_env: env.0,
      count: self.count.clone(),
      inner_key: self.inner_key.clone(),
      inner: get_ref(&env, &self.inner_key)?,
    })
  }
}

impl<T> Drop for JsRc<T> {
  fn drop(&mut self) {
    let mut count = self.count.borrow_mut();
    *count -= 1;
    if *count == 0 {
      let env = unsafe { Env::from_raw(self.raw_env) };
      remove_ref(&env, *self.inner_key).unwrap();
    }
  }
}

impl<T: NapiValue> Deref for JsRc<T> {
  type Target = T;

  fn deref(&self) -> &T {
    &self.inner
  }
}

/*
  globalThis = {
    __napi_cache: {
      __instance_count: number,
      [key: number]: Record<number, any>
    }
  }

  Note: Is there a way to store this privately in the module scope?
*/
fn get_cache(env: &Env) -> crate::Result<JsObject> {
  let mut g = env.get_global()?;

  // Init global cache if it doesn't exist
  if !g.has_named_property("__napi_cache")? {
    let mut cache = env.create_object()?;
    cache.set_named_property("__instance_count", env.create_uint32(0)?)?;
    g.set_named_property("__napi_cache", cache)?;
  }

  let mut global_cache = g.get_named_property::<JsObject>("__napi_cache")?;

  // Init module instance cache if it doesn't exist
  let key = CACHE_KEY.with(|key| {
    key
      .get_or_try_init(|| -> crate::Result<u32> {
        let instance_count = (&global_cache).get_named_property::<JsNumber>("__instance_count")?;
        let instance_count = instance_count.get_uint32()? + 1;

        (&mut global_cache).set_named_property("__instance_count", instance_count)?;
        (&mut global_cache)
          .set_property(env.create_uint32(instance_count)?, env.create_object()?)?;

        Ok(instance_count)
      })
      .copied()
  })?;

  global_cache.get_property(env.create_uint32(key)?)
}

fn set_ref(env: &Env, value: impl NapiValue) -> crate::Result<u32> {
  let mut cache = get_cache(env)?;

  let key_raw = COUNT.with(|c| {
    let mut c = c.borrow_mut();
    let current = c.clone();
    *c += 1;
    current
  });

  let key = env.create_uint32(key_raw)?;
  cache.set_property(&key, value)?;
  Ok(key_raw)
}

fn get_ref<T: NapiValue>(env: &Env, key: &u32) -> crate::Result<T> {
  let cache = get_cache(env)?;
  let key = env.create_uint32(key.clone())?;
  cache.get_property(key)
}

fn remove_ref(env: &Env, key: u32) -> crate::Result<()> {
  let mut cache = get_cache(env)?;
  let key = env.create_uint32(key)?;
  cache.delete_property(&key)?;
  Ok(())
}
