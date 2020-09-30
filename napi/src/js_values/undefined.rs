use super::Value;

#[repr(transparent)]
#[derive(Debug)]
pub struct JsUndefined(pub(crate) Value);
