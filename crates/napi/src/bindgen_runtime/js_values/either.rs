use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};
use crate::{
  bindgen_runtime::{Null, Undefined},
  sys, Error, JsUndefined, NapiRaw, Status, ValueType,
};

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

impl<
    A: TypeName + FromNapiValue + ValidateNapiValue,
    B: TypeName + FromNapiValue + ValidateNapiValue,
  > FromNapiValue for Either<A, B>
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    if unsafe { A::validate(env, napi_val) }.is_ok() {
      unsafe { A::from_napi_value(env, napi_val) }.map(Either::A)
    } else if unsafe { B::validate(env, napi_val) }.is_ok() {
      unsafe { B::from_napi_value(env, napi_val).map(Either::B) }
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Value is not either {} or {}",
          A::type_name(),
          B::type_name()
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

macro_rules! either_n {
  ( $either_name:ident, $( $parameter:ident ),+ $( , )* ) => {
    #[derive(Debug, Clone, Copy)]
    pub enum $either_name< $( $parameter ),+ > {
      $( $parameter ( $parameter ) ),+
    }

    impl< $( $parameter ),+ > TypeName for $either_name < $( $parameter ),+ >
      where $( $parameter: TypeName ),+
    {
      fn type_name() -> &'static str {
        stringify!( $either_name )
      }

      fn value_type() -> ValueType {
        ValueType::Unknown
      }
    }

    impl< $( $parameter ),+ > FromNapiValue for $either_name < $( $parameter ),+ >
      where $( $parameter: TypeName + FromNapiValue + ValidateNapiValue ),+
    {
      unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
        let mut ret = Err(Error::new(Status::InvalidArg, "Invalid value".to_owned()));
        $(
          if unsafe { $parameter::validate(env, napi_val).is_ok() && { ret = $parameter ::from_napi_value(env, napi_val).map(Self:: $parameter ); ret.is_ok() } } {
            ret
          } else
        )+
        {
          Err(crate::Error::new(
            Status::InvalidArg,
            format!(
              concat!("Value is non of these types ", $( "`{", stringify!( $parameter ), "}`, " ),+ ),
              $( $parameter = $parameter::value_type(), )+
            ),
          ))
        }
      }
    }

    impl< $( $parameter ),+ > ToNapiValue for $either_name < $( $parameter ),+ >
      where $( $parameter: ToNapiValue ),+
    {
      unsafe fn to_napi_value(
        env: sys::napi_env,
        value: Self
      ) -> crate::Result<crate::sys::napi_value> {
        match value {
          $( Self:: $parameter (v) => unsafe { $parameter ::to_napi_value(env, v) } ),+
        }
      }
    }
  };
}

either_n!(Either3, A, B, C);
either_n!(Either4, A, B, C, D);
either_n!(Either5, A, B, C, D, E);
either_n!(Either6, A, B, C, D, E, F);
either_n!(Either7, A, B, C, D, E, F, G);
either_n!(Either8, A, B, C, D, E, F, G, H);
either_n!(Either9, A, B, C, D, E, F, G, H, I);
either_n!(Either10, A, B, C, D, E, F, G, H, I, J);
either_n!(Either11, A, B, C, D, E, F, G, H, I, J, K);
either_n!(Either12, A, B, C, D, E, F, G, H, I, J, K, L);
either_n!(Either13, A, B, C, D, E, F, G, H, I, J, K, L, M);
either_n!(Either14, A, B, C, D, E, F, G, H, I, J, K, L, M, N);
either_n!(Either15, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O);
either_n!(Either16, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P);
either_n!(Either17, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q);
either_n!(Either18, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R);
either_n!(Either19, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S);
either_n!(Either20, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T);
either_n!(Either21, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U);
either_n!(Either22, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V);
either_n!(Either23, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W);
either_n!(Either24, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X);
either_n!(Either25, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y);
either_n!(Either26, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z);
