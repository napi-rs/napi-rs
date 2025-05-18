use std::ptr;

use crate::{check_status, sys, Env, JsValue, Result};

pub struct HandleScope {
  pub(crate) scope: sys::napi_handle_scope,
}

impl HandleScope {
  pub fn create(env: &Env) -> Result<Self> {
    let mut scope = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_open_handle_scope(env.0, &mut scope) },
      "Failed to open handle scope"
    )?;
    Ok(Self { scope })
  }

  pub fn run<A, T>(self, arg: A, f: impl FnOnce(A) -> Result<T>) -> Result<T>
  where
    A: JsValuesTuple,
  {
    let env = arg.env();
    let ret = f(arg);
    check_status!(
      unsafe { sys::napi_close_handle_scope(env, self.scope) },
      "Failed to close handle scope"
    )?;
    ret
  }
}

pub trait JsValuesTuple {
  fn env(&self) -> sys::napi_env;
}

impl<'env, T: JsValue<'env>> JsValuesTuple for T {
  fn env(&self) -> sys::napi_env {
    self.value().env
  }
}

impl<'env, T1: JsValue<'env>, T2: JsValue<'env>> JsValuesTuple for (T1, T2) {
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<'env, T1: JsValue<'env>, T2: JsValue<'env>, T3: JsValue<'env>> JsValuesTuple for (T1, T2, T3) {
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<'env, T1: JsValue<'env>, T2: JsValue<'env>, T3: JsValue<'env>, T4: JsValue<'env>> JsValuesTuple
  for (T1, T2, T3, T4)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
    T6: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5, T6)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
    T6: JsValue<'env>,
    T7: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5, T6, T7)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
    T6: JsValue<'env>,
    T7: JsValue<'env>,
    T8: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5, T6, T7, T8)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
    T6: JsValue<'env>,
    T7: JsValue<'env>,
    T8: JsValue<'env>,
    T9: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5, T6, T7, T8, T9)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
    T6: JsValue<'env>,
    T7: JsValue<'env>,
    T8: JsValue<'env>,
    T9: JsValue<'env>,
    T10: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5, T6, T7, T8, T9, T10)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
    T6: JsValue<'env>,
    T7: JsValue<'env>,
    T8: JsValue<'env>,
    T9: JsValue<'env>,
    T10: JsValue<'env>,
    T11: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}

impl<
    'env,
    T1: JsValue<'env>,
    T2: JsValue<'env>,
    T3: JsValue<'env>,
    T4: JsValue<'env>,
    T5: JsValue<'env>,
    T6: JsValue<'env>,
    T7: JsValue<'env>,
    T8: JsValue<'env>,
    T9: JsValue<'env>,
    T10: JsValue<'env>,
    T11: JsValue<'env>,
    T12: JsValue<'env>,
  > JsValuesTuple for (T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12)
{
  fn env(&self) -> sys::napi_env {
    self.0.value().env
  }
}
