use super::{FromNapiValue, ToNapiValue, TypeName};
use crate::{type_of, JsNull, JsUndefined, NapiRaw, Status, ValueType};

const ERROR_MSG: &str = "The return value of typeof(T) should not be equal in Either";

#[derive(Debug, Clone, Copy)]
pub enum Either<
  A: TypeName + FromNapiValue + ToNapiValue,
  B: TypeName + FromNapiValue + ToNapiValue,
> {
  A(A),
  B(B),
}

impl<
    A: TypeName + FromNapiValue + ToNapiValue + NapiRaw,
    B: TypeName + FromNapiValue + ToNapiValue + NapiRaw,
  > Either<A, B>
{
  /// # Safety
  /// Backward compatible with `Either` in **v1**
  pub unsafe fn raw(&self) -> napi_sys::napi_value {
    match &self {
      Self::A(a) => a.raw(),
      Self::B(b) => b.raw(),
    }
  }
}

impl<A: TypeName + FromNapiValue + ToNapiValue, B: TypeName + FromNapiValue + ToNapiValue> TypeName
  for Either<A, B>
{
  fn type_name() -> &'static str {
    "Either"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

// Backwards compatibility with v1
impl<T: TypeName + FromNapiValue + ToNapiValue> From<Either<T, JsUndefined>> for Option<T> {
  fn from(value: Either<T, JsUndefined>) -> Option<T> {
    match value {
      Either::A(v) => Some(v),
      Either::B(_) => None,
    }
  }
}

impl<T: TypeName + FromNapiValue + ToNapiValue> From<Either<T, JsNull>> for Option<T> {
  fn from(value: Either<T, JsNull>) -> Option<T> {
    match value {
      Either::A(v) => Some(v),
      Either::B(_) => None,
    }
  }
}

impl<A: TypeName + FromNapiValue + ToNapiValue, B: TypeName + FromNapiValue + ToNapiValue>
  FromNapiValue for Either<A, B>
{
  unsafe fn from_napi_value(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> crate::Result<Self> {
    debug_assert!(A::value_type() != B::value_type(), "{}", ERROR_MSG);
    let js_type = type_of!(env, napi_val)?;
    if js_type == A::value_type() {
      A::from_napi_value(env, napi_val).map(Self::A)
    } else if js_type == B::value_type() {
      B::from_napi_value(env, napi_val).map(Self::B)
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

impl<A: TypeName + FromNapiValue + ToNapiValue, B: TypeName + FromNapiValue + ToNapiValue>
  ToNapiValue for Either<A, B>
{
  unsafe fn to_napi_value(
    env: napi_sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => A::to_napi_value(env, a),
      Self::B(b) => B::to_napi_value(env, b),
    }
  }
}

#[derive(Debug, Clone, Copy)]
pub enum Either3<
  A: TypeName + FromNapiValue + ToNapiValue,
  B: TypeName + FromNapiValue + ToNapiValue,
  C: TypeName + FromNapiValue + ToNapiValue,
> {
  A(A),
  B(B),
  C(C),
}

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
  > TypeName for Either3<A, B, C>
{
  fn type_name() -> &'static str {
    "Either3"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
  > FromNapiValue for Either3<A, B, C>
{
  unsafe fn from_napi_value(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> crate::Result<Self> {
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
      A::from_napi_value(env, napi_val).map(Self::A)
    } else if js_type == B::value_type() {
      B::from_napi_value(env, napi_val).map(Self::B)
    } else if js_type == C::value_type() {
      C::from_napi_value(env, napi_val).map(Self::C)
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

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
  > ToNapiValue for Either3<A, B, C>
{
  unsafe fn to_napi_value(
    env: napi_sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => A::to_napi_value(env, a),
      Self::B(b) => B::to_napi_value(env, b),
      Self::C(c) => C::to_napi_value(env, c),
    }
  }
}

#[derive(Debug, Clone, Copy)]
pub enum Either4<
  A: TypeName + FromNapiValue + ToNapiValue,
  B: TypeName + FromNapiValue + ToNapiValue,
  C: TypeName + FromNapiValue + ToNapiValue,
  D: TypeName + FromNapiValue + ToNapiValue,
> {
  A(A),
  B(B),
  C(C),
  D(D),
}

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
    D: TypeName + FromNapiValue + ToNapiValue,
  > TypeName for Either4<A, B, C, D>
{
  fn type_name() -> &'static str {
    "Either4"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
    D: TypeName + FromNapiValue + ToNapiValue,
  > FromNapiValue for Either4<A, B, C, D>
{
  unsafe fn from_napi_value(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> crate::Result<Self> {
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
      A::from_napi_value(env, napi_val).map(Self::A)
    } else if js_type == B::value_type() {
      B::from_napi_value(env, napi_val).map(Self::B)
    } else if js_type == C::value_type() {
      C::from_napi_value(env, napi_val).map(Self::C)
    } else if js_type == D::value_type() {
      D::from_napi_value(env, napi_val).map(Self::D)
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

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
    D: TypeName + FromNapiValue + ToNapiValue,
  > ToNapiValue for Either4<A, B, C, D>
{
  unsafe fn to_napi_value(
    env: napi_sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => A::to_napi_value(env, a),
      Self::B(b) => B::to_napi_value(env, b),
      Self::C(c) => C::to_napi_value(env, c),
      Self::D(d) => D::to_napi_value(env, d),
    }
  }
}

#[derive(Debug, Clone, Copy)]
pub enum Either5<
  A: TypeName + FromNapiValue + ToNapiValue,
  B: TypeName + FromNapiValue + ToNapiValue,
  C: TypeName + FromNapiValue + ToNapiValue,
  D: TypeName + FromNapiValue + ToNapiValue,
  E: TypeName + FromNapiValue + ToNapiValue,
> {
  A(A),
  B(B),
  C(C),
  D(D),
  E(E),
}

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
    D: TypeName + FromNapiValue + ToNapiValue,
    E: TypeName + FromNapiValue + ToNapiValue,
  > TypeName for Either5<A, B, C, D, E>
{
  fn type_name() -> &'static str {
    "Either5"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
    D: TypeName + FromNapiValue + ToNapiValue,
    E: TypeName + FromNapiValue + ToNapiValue,
  > FromNapiValue for Either5<A, B, C, D, E>
{
  unsafe fn from_napi_value(
    env: napi_sys::napi_env,
    napi_val: napi_sys::napi_value,
  ) -> crate::Result<Self> {
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
      A::from_napi_value(env, napi_val).map(Self::A)
    } else if js_type == B::value_type() {
      B::from_napi_value(env, napi_val).map(Self::B)
    } else if js_type == C::value_type() {
      C::from_napi_value(env, napi_val).map(Self::C)
    } else if js_type == D::value_type() {
      D::from_napi_value(env, napi_val).map(Self::D)
    } else if js_type == E::value_type() {
      E::from_napi_value(env, napi_val).map(Self::E)
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

impl<
    A: TypeName + FromNapiValue + ToNapiValue,
    B: TypeName + FromNapiValue + ToNapiValue,
    C: TypeName + FromNapiValue + ToNapiValue,
    D: TypeName + FromNapiValue + ToNapiValue,
    E: TypeName + FromNapiValue + ToNapiValue,
  > ToNapiValue for Either5<A, B, C, D, E>
{
  unsafe fn to_napi_value(
    env: napi_sys::napi_env,
    value: Self,
  ) -> crate::Result<crate::sys::napi_value> {
    match value {
      Self::A(a) => A::to_napi_value(env, a),
      Self::B(b) => B::to_napi_value(env, b),
      Self::C(c) => C::to_napi_value(env, c),
      Self::D(d) => D::to_napi_value(env, d),
      Self::E(e) => E::to_napi_value(env, e),
    }
  }
}
