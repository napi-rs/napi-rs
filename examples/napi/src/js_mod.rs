#[napi_derive::napi]
mod xxh3 {
  use napi::bindgen_prelude::{BigInt, Buffer};

  #[::napi_derive::napi()]
  pub const ALIGNMENT: u32 = 16;

  // Preserve the trailing comma to exercise module attribute parsing.
  #[rustfmt::skip]
  #[napi_derive::napi(js_name = "xxh3_64",)]
  pub fn xxh64(input: Buffer) -> u64 {
    let mut h: u64 = 0;
    for i in input.as_ref() {
      h = h.wrapping_add(*i as u64);
    }
    h
  }

  #[napi()]
  /// xxh128 function
  pub fn xxh128(input: Buffer) -> u128 {
    let mut h: u128 = 0;
    for i in input.as_ref() {
      h = h.wrapping_add(*i as u128);
    }
    h
  }

  #[napi_derive::napi()]
  /// Xxh3 class
  pub struct Xxh3 {
    inner: BigInt,
  }

  #[napi_derive::napi]
  impl Xxh3 {
    #[napi(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Xxh3 {
      Xxh3 {
        inner: BigInt {
          sign_bit: false,
          words: vec![0],
        },
      }
    }

    #[napi]
    /// update
    pub fn update(&mut self, input: Buffer) {
      for i in input.as_ref() {
        self.inner = BigInt {
          sign_bit: false,
          words: vec![self.inner.get_u64().1.wrapping_add(*i as u64)],
        };
      }
    }
    #[napi]
    pub fn digest(&self) -> BigInt {
      self.inner.clone()
    }
  }
}

#[napi]
mod xxh2 {
  use napi::bindgen_prelude::*;

  #[rustfmt::skip]
  #[::napi_derive::napi(js_name = "xxh2Plus",)]
  pub fn xxh2_plus(a: u32, b: u32) -> u32 {
    a + b
  }

  #[rustfmt::skip]
  #[napi(js_name = "xxh3Xxh64Alias",)]
  pub fn xxh3_xxh64_alias(input: Buffer) -> u64 {
    super::xxh3::xxh64(input)
  }
}

use napi::bindgen_prelude::Buffer;

#[napi]
pub fn xxh64_alias(input: Buffer) -> u64 {
  xxh3::xxh64(input)
}

#[napi(namespace = "xxh3.nested")]
pub fn xxh3_nested_plus(a: u32, b: u32) -> u32 {
  a + b
}

/// `deep` is also the root of the `deep.*` namespaces, which are set on this function.
#[napi(js_name = "deep")]
pub fn deep_root() -> String {
  "root".to_owned()
}

#[napi(namespace = "deep.left")]
pub fn deep_left() -> String {
  "left".to_owned()
}

/// Uses `DeepRight` before it is declared, from another namespace: the d.ts
/// must name it `deep.right.DeepRight`.
#[napi(namespace = "deep.left")]
pub fn deep_left_to_right(value: u32) -> DeepRight {
  DeepRight { value }
}

#[napi(namespace = "deep.left.inner")]
pub const DEEP_DEPTH: u32 = 3;

#[napi(namespace = "deep.right")]
pub struct DeepRight {
  value: u32,
}

#[napi(namespace = "deep.right")]
impl DeepRight {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    DeepRight { value }
  }

  #[napi]
  pub fn value(&self) -> u32 {
    self.value
  }
}

/// Set on the `DeepRight` class, next to its statics.
#[napi(namespace = "deep.right.DeepRight")]
pub fn describe() -> String {
  "DeepRight".to_owned()
}
