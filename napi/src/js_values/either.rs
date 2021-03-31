use crate::{sys, JsUndefined, NapiValue, Result};

#[derive(Debug, Clone, Copy)]
pub enum Either<A: NapiValue, B: NapiValue> {
  A(A),
  B(B),
}

impl<T: NapiValue> From<Either<T, JsUndefined>> for Option<T> {
  fn from(value: Either<T, JsUndefined>) -> Option<T> {
    match value {
      Either::A(v) => Some(v),
      Either::B(_) => None,
    }
  }
}

impl<A: NapiValue, B: NapiValue> NapiValue for Either<A, B> {
  unsafe fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Either<A, B>> {
    A::from_raw(env, value)
      .map(Self::A)
      .or_else(|_| B::from_raw(env, value).map(Self::B))
  }

  unsafe fn from_raw_unchecked(env: sys::napi_env, value: sys::napi_value) -> Either<A, B> {
    Self::from_raw(env, value).unwrap()
  }

  unsafe fn raw(&self) -> sys::napi_value {
    match self {
      Either::A(v) => v.raw(),
      Either::B(v) => v.raw(),
    }
  }
}
