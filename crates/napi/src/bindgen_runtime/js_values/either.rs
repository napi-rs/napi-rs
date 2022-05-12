use super::{FromNapiValue, ToNapiValue, TypeName};
use crate::{
  bindgen_runtime::{Null, Undefined},
  sys, type_of, JsUndefined, NapiRaw, Status, ValueType,
};

const ERROR_MSG: &str = "The return value of typeof(T) should not be equal in Either";

#[derive(Debug, Clone, Copy)]
pub enum Either<A, B> {
  A(A),
  B(B),
}

impl<A: NapiRaw, B: NapiRaw> Either<A, B> {
  /// # Safety
  /// Backward compatible with `Either` in **v1**
  pub unsafe fn raw(&self) -> sys::napi_value {
    match &self {
      Self::A(a) => unsafe { a.raw() },
      Self::B(b) => unsafe { b.raw() },
    }
  }
}

impl<A: TypeName, B: TypeName> TypeName for Either<A, B> {
  fn type_name() -> &'static str {
    "Either"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

// Backwards compatibility with v1
impl<T> From<Either<T, JsUndefined>> for Option<T> {
  fn from(value: Either<T, JsUndefined>) -> Option<T> {
    match value {
      Either::A(v) => Some(v),
      Either::B(_) => None,
    }
  }
}

impl<T> From<Option<T>> for Either<T, Undefined> {
  fn from(value: Option<T>) -> Self {
    match value {
      Some(v) => Either::A(v),
      None => Either::B(()),
    }
  }
}

impl<T> From<Either<T, Null>> for Option<T> {
  fn from(value: Either<T, Null>) -> Option<T> {
    match value {
      Either::A(v) => Some(v),
      Either::B(_) => None,
    }
  }
}

impl<A: TypeName + FromNapiValue, B: TypeName + FromNapiValue> FromNapiValue for Either<A, B> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    debug_assert!(A::value_type() != B::value_type(), "{}", ERROR_MSG);
    let js_type = type_of!(env, napi_val)?;
    if js_type == A::value_type() {
      unsafe { A::from_napi_value(env, napi_val).map(Self::A) }
    } else if js_type == B::value_type() {
      unsafe { B::from_napi_value(env, napi_val).map(Self::B) }
    } else {
      Err(crate::Error::new(
        Status::InvalidArg,
        format!(
          "Expect type {} or {}, but got {}",
          A::value_type(),
          B::value_type(),
          js_type
        ),
      ))
    }
  }
}

impl<A: ToNapiValue, B: ToNapiValue> ToNapiValue for Either<A, B> {
  unsafe fn to_napi_value(
    env: sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => unsafe { A::to_napi_value(env, a) },
      Self::B(b) => unsafe { B::to_napi_value(env, b) },
    }
  }
}

#[derive(Debug, Clone, Copy)]
pub enum Either3<A, B, C> {
  A(A),
  B(B),
  C(C),
}

impl<A: TypeName, B: TypeName, C: TypeName> TypeName for Either3<A, B, C> {
  fn type_name() -> &'static str {
    "Either3"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl<A: TypeName + FromNapiValue, B: TypeName + FromNapiValue, C: TypeName + FromNapiValue>
  FromNapiValue for Either3<A, B, C>
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    debug_assert!(
      {
        let mut types = vec![A::value_type(), B::value_type(), C::value_type()];
        types.dedup();
        types.len() == 3
      },
      "{}",
      ERROR_MSG
    );
    let js_type = type_of!(env, napi_val)?;
    if js_type == A::value_type() {
      unsafe { A::from_napi_value(env, napi_val).map(Self::A) }
    } else if js_type == B::value_type() {
      unsafe { B::from_napi_value(env, napi_val).map(Self::B) }
    } else if js_type == C::value_type() {
      unsafe { C::from_napi_value(env, napi_val).map(Self::C) }
    } else {
      Err(crate::Error::new(
        Status::InvalidArg,
        format!(
          "Expect type {} or {} or {}, but got {}",
          A::value_type(),
          B::value_type(),
          C::value_type(),
          js_type
        ),
      ))
    }
  }
}

impl<A: ToNapiValue, B: ToNapiValue, C: ToNapiValue> ToNapiValue for Either3<A, B, C> {
  unsafe fn to_napi_value(
    env: sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => unsafe { A::to_napi_value(env, a) },
      Self::B(b) => unsafe { B::to_napi_value(env, b) },
      Self::C(c) => unsafe { C::to_napi_value(env, c) },
    }
  }
}

#[derive(Debug, Clone, Copy)]
pub enum Either4<A, B, C, D> {
  A(A),
  B(B),
  C(C),
  D(D),
}

impl<A: TypeName, B: TypeName, C: TypeName, D: TypeName> TypeName for Either4<A, B, C, D> {
  fn type_name() -> &'static str {
    "Either4"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl<
    A: TypeName + FromNapiValue,
    B: TypeName + FromNapiValue,
    C: TypeName + FromNapiValue,
    D: TypeName + FromNapiValue,
  > FromNapiValue for Either4<A, B, C, D>
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    debug_assert!(
      {
        let mut types = vec![
          A::value_type(),
          B::value_type(),
          C::value_type(),
          D::value_type(),
        ];
        types.dedup();
        types.len() == 4
      },
      "{}",
      ERROR_MSG
    );
    let js_type = type_of!(env, napi_val)?;
    if js_type == A::value_type() {
      unsafe { A::from_napi_value(env, napi_val).map(Self::A) }
    } else if js_type == B::value_type() {
      unsafe { B::from_napi_value(env, napi_val).map(Self::B) }
    } else if js_type == C::value_type() {
      unsafe { C::from_napi_value(env, napi_val).map(Self::C) }
    } else if js_type == D::value_type() {
      unsafe { D::from_napi_value(env, napi_val).map(Self::D) }
    } else {
      Err(crate::Error::new(
        Status::InvalidArg,
        format!(
          "Expect type {} or {} or {} or {}, but got {}",
          A::value_type(),
          B::value_type(),
          C::value_type(),
          D::value_type(),
          js_type
        ),
      ))
    }
  }
}

impl<A: ToNapiValue, B: ToNapiValue, C: ToNapiValue, D: ToNapiValue> ToNapiValue
  for Either4<A, B, C, D>
{
  unsafe fn to_napi_value(
    env: sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => unsafe { A::to_napi_value(env, a) },
      Self::B(b) => unsafe { B::to_napi_value(env, b) },
      Self::C(c) => unsafe { C::to_napi_value(env, c) },
      Self::D(d) => unsafe { D::to_napi_value(env, d) },
    }
  }
}

#[derive(Debug, Clone, Copy)]
pub enum Either5<A, B, C, D, E> {
  A(A),
  B(B),
  C(C),
  D(D),
  E(E),
}

impl<A: TypeName, B: TypeName, C: TypeName, D: TypeName, E: TypeName> TypeName
  for Either5<A, B, C, D, E>
{
  fn type_name() -> &'static str {
    "Either5"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl<
    A: TypeName + FromNapiValue,
    B: TypeName + FromNapiValue,
    C: TypeName + FromNapiValue,
    D: TypeName + FromNapiValue,
    E: TypeName + FromNapiValue,
  > FromNapiValue for Either5<A, B, C, D, E>
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    debug_assert!(
      {
        let mut types = vec![
          A::value_type(),
          B::value_type(),
          C::value_type(),
          D::value_type(),
          E::value_type(),
        ];
        types.dedup();
        types.len() == 5
      },
      "{}",
      ERROR_MSG
    );
    let js_type = type_of!(env, napi_val)?;
    if js_type == A::value_type() {
      unsafe { A::from_napi_value(env, napi_val).map(Self::A) }
    } else if js_type == B::value_type() {
      unsafe { B::from_napi_value(env, napi_val).map(Self::B) }
    } else if js_type == C::value_type() {
      unsafe { C::from_napi_value(env, napi_val).map(Self::C) }
    } else if js_type == D::value_type() {
      unsafe { D::from_napi_value(env, napi_val).map(Self::D) }
    } else if js_type == E::value_type() {
      unsafe { E::from_napi_value(env, napi_val).map(Self::E) }
    } else {
      Err(crate::Error::new(
        Status::InvalidArg,
        format!(
          "Expect type {} or {} or {} or {} or {}, but got {}",
          A::value_type(),
          B::value_type(),
          C::value_type(),
          D::value_type(),
          E::value_type(),
          js_type
        ),
      ))
    }
  }
}

impl<A: ToNapiValue, B: ToNapiValue, C: ToNapiValue, D: ToNapiValue, E: ToNapiValue> ToNapiValue
  for Either5<A, B, C, D, E>
{
  unsafe fn to_napi_value(
    env: sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => unsafe { A::to_napi_value(env, a) },
      Self::B(b) => unsafe { B::to_napi_value(env, b) },
      Self::C(c) => unsafe { C::to_napi_value(env, c) },
      Self::D(d) => unsafe { D::to_napi_value(env, d) },
      Self::E(e) => unsafe { E::to_napi_value(env, e) },
    }
  }
}
