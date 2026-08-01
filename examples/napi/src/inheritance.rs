//! Fixtures for `#[napi(extends = Parent)]` single-inheritance (issue #1164).
//!
//! `Sub` embeds `Base` as its first field under `#[repr(C)]`, so the `Base`
//! portion sits at offset 0 and a `*mut Sub` can be borrowed as `&Base`. The
//! macro wires `Object.setPrototypeOf(Sub.prototype, Base.prototype)` at module
//! registration, so `sub instanceof Base` holds and inherited field getters
//! resolve through the prototype chain.

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

  /// A parent field getter — must be readable through a descendant instance.
  #[napi(getter)]
  pub fn get_value(&self) -> i32 {
    self.value
  }

  /// A parent plain method — reachable on a descendant only once the V8
  /// signature is routed around (P8); kept here to exercise that path.
  #[napi]
  pub fn doubled(&self) -> i32 {
    self.value * 2
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
