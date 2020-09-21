use crate::{sys, Env};

use super::ValueType;

#[derive(Debug, Clone, Copy)]
pub struct Value<'env> {
  pub env: &'env Env,
  pub value: sys::napi_value,
  pub value_type: ValueType,
}
