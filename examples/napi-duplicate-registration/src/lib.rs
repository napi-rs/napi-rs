//! Test-only "duplicate registration" addon.
//!
//! Two distinct `#[napi]` structs are exported under the same top-level name
//! (`js_name = "Widget"`) — the exact `(namespace, name)` collision that arises
//! when two independent authors each define a class resolving to one export
//! name. N-API would resolve it by silently defining both and keeping only the
//! last, leaving one class unreachable with no error. The registration-manifest
//! pre-pass in `napi_register_module_v1` instead fails closed, so `require()`ing
//! this addon throws with a clear message.
//!
//! Built with `dyn-symbols` so a plain `cargo build` yields a loadable `.node`;
//! no napi-CLI/typegen step is involved (and typegen would not catch this — the
//! collision is a link-time/runtime fact, which is why the pre-pass exists).

use napi_derive::napi;

/// A class exported as `Widget`.
#[napi(js_name = "Widget")]
pub struct WidgetOne {
  pub value: i32,
}

/// A second, distinct class ALSO exported as `Widget` — same `(namespace, name)`
/// as `WidgetOne`.
#[napi(js_name = "Widget")]
pub struct WidgetTwo {
  pub label: String,
}
