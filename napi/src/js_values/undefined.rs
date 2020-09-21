use super::Value;

#[derive(Debug)]
pub struct JsUndefined<'env>(pub(crate) Value<'env>);
