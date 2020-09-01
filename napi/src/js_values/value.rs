use crate::sys;

use super::ValueType;

#[derive(Debug, Clone, Copy)]
pub struct Value {
  pub env: sys::napi_env,
  pub value: sys::napi_value,
  pub value_type: ValueType,
}
