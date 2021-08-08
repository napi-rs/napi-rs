use crate::sys;

pub trait JsClassRuntimeHelper {
  fn napi_set_ctor(ctor: sys::napi_ref);
  fn napi_get_ctor() -> sys::napi_ref;
}
