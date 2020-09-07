use crate::{sys, JsUndefined, NapiValue, Result};

#[derive(Debug, Clone, Copy)]
pub enum Either<A: NapiValue, B: NapiValue> {
  A(A),
  B(B),
}

impl<T: NapiValue> Into<Option<T>> for Either<T, JsUndefined> {
  fn into(self) -> Option<T> {
    match self {
      Either::A(v) => Some(v),
      Either::B(_) => None,
    }
  }
}

impl<A: NapiValue, B: NapiValue> NapiValue for Either<A, B> {
  fn from_raw(env: sys::napi_env, value: sys::napi_value) -> Result<Either<A, B>> {
    A::from_raw(env, value)
      .map(Self::A)
      .or_else(|_| B::from_raw(env, value).map(Self::B))
  }

  fn from_raw_without_typecheck(env: sys::napi_env, value: sys::napi_value) -> Either<A, B> {
    Self::from_raw(env, value).unwrap()
  }

  fn raw_value(&self) -> sys::napi_value {
    match self {
      Either::A(v) => v.raw_value(),
      Either::B(v) => v.raw_value(),
    }
  }
}
