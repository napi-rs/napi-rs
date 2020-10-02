use super::Value;

#[repr(transparent)]
#[derive(Debug)]
pub struct JsObject(pub(crate) Value);
