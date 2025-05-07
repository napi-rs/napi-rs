use std::fmt::{self, Display};

use crate::sys;

use super::ValueType;

#[derive(Debug, Clone, Copy)]
pub struct Value {
  pub env: sys::napi_env,
  pub value: sys::napi_value,
  pub value_type: ValueType,
}

impl Display for Value {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "Value({:?})", self.value_type)
  }
}
