//! Test-only fixture addon (issue #1164) built WITHOUT `napi8`.
//!
//! `#[napi(extends)]` still wires the instance prototype chain here (that is
//! pure `Object.setPrototypeOf`, not gated on `napi8`), so `sub instanceof Base`
//! holds and an inherited plain method *resolves* through the prototype chain.
//! But the P8 rebuild that strips a BorrowedUpcast plain method's V8 receiver
//! signature — the piece that actually lets a descendant *call* it — is
//! `napi8`-only. So calling an inherited plain method on a descendant must still
//! be rejected by V8's signature check ("Illegal invocation"): the pre-feature
//! status quo this fixture pins.

use napi_derive::napi;

/// Root class with a BorrowedUpcast plain method (`&self`, no `Reference<Self>`).
#[napi]
pub struct NoNapi8Base {
  value: i32,
}

#[napi]
impl NoNapi8Base {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    NoNapi8Base { value }
  }

  /// A plain method: reachable on a descendant only once P8 (napi8) routes
  /// around the V8 signature. Without napi8 it must throw on a descendant.
  #[napi]
  pub fn doubled(&self) -> i32 {
    self.value * 2
  }
}

/// Child of [`NoNapi8Base`].
#[napi(extends = NoNapi8Base)]
#[repr(C)]
pub struct NoNapi8Sub {
  base: NoNapi8Base,
  extra: i32,
}

#[napi]
impl NoNapi8Sub {
  #[napi(factory)]
  pub fn create(value: i32, extra: i32) -> Self {
    NoNapi8Sub {
      base: NoNapi8Base::new(value),
      extra,
    }
  }

  #[napi(getter)]
  pub fn get_extra(&self) -> i32 {
    self.extra
  }
}
