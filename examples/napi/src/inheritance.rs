//! Fixtures for `#[napi(extends = Parent)]` single-inheritance (issue #1164).
//!
//! `Sub` embeds `Base` as its first field under `#[repr(C)]`, so the `Base`
//! portion sits at offset 0 and a `*mut Sub` can be borrowed as `&Base`. The
//! macro wires `Object.setPrototypeOf(Sub.prototype, Base.prototype)` at module
//! registration, so `sub instanceof Base` holds and inherited field getters
//! resolve through the prototype chain.

use napi::bindgen_prelude::Reference;
use napi_derive::napi;

/// Root of the inheritance fixture chain.
#[napi]
pub struct Base {
  value: i32,
}

#[napi]
impl Base {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    Base { value }
  }

  /// A parent-defined factory (static side). Because v1 wires only the
  /// *instance* prototype chain, this must NOT be reachable as `Sub.fromValue`.
  #[napi(factory)]
  pub fn from_value(value: i32) -> Self {
    Base { value }
  }

  /// A parent-defined plain static. Same as the factory: never inherited by a
  /// descendant in v1, so `Sub.baseStatic` must be `undefined`.
  #[napi]
  pub fn base_static() -> i32 {
    42
  }

  /// A parent field getter — must be readable through a descendant instance.
  #[napi(getter)]
  pub fn get_value(&self) -> i32 {
    self.value
  }

  /// A parent field setter — must be writable through a descendant instance
  /// (BorrowedUpcast accessor: works with P5 alone, no P8 needed).
  #[napi(setter)]
  pub fn set_value(&mut self, value: i32) {
    self.value = value;
  }

  /// A parent plain method (BorrowedUpcast: plain `&self`, no `Reference<Self>`).
  /// Reachable on a descendant only once the V8 signature is routed around (P8);
  /// kept here to exercise that path and contrast with `ref_value` below.
  #[napi]
  pub fn doubled(&self) -> i32 {
    self.value * 2
  }

  /// A parent method classified `ReceiverPolicy::Exact` — it takes a
  /// `Reference<Self>`, whose `Deref`/`share_with` machinery would reconstruct a
  /// `Box<Base>` over the receiver, so it keeps the exact tag-checked receiver
  /// unwrap and is deliberately NOT rewrapped by P8. Called on a descendant it
  /// must fail (V8 `Illegal invocation` on Node; a clean tag mismatch on a
  /// runtime that does not enforce the signature), never silently read `Sub`
  /// memory as a `Base`.
  #[napi]
  pub fn ref_value(&self, _this: Reference<Base>) -> i32 {
    self.value
  }
}

/// Direct child of `Base`. Constructed via a factory (a `#[napi(constructor)]`
/// cannot be combined with `#[napi(extends)]` in v1).
#[napi(extends = Base)]
#[repr(C)]
pub struct Sub {
  base: Base,
  extra: i32,
}

#[napi]
impl Sub {
  #[napi(factory)]
  pub fn create(value: i32, extra: i32) -> Self {
    Sub {
      base: Base::new(value),
      extra,
    }
  }

  #[napi(getter)]
  pub fn get_extra(&self) -> i32 {
    self.extra
  }
}
