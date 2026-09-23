#[napi]
mod xxh3 {
  use napi::bindgen_prelude::{BigInt, Buffer};

  #[napi]
  pub const ALIGNMENT: u32 = 16;

  #[napi(js_name = "xxh3_64")]
  pub fn xxh64(input: Buffer) -> u64 {
    let mut h: u64 = 0;
    for i in input.as_ref() {
      h = h.wrapping_add(*i as u64);
    }
    h
  }

  #[napi]
  /// xxh128 function
  pub fn xxh128(input: Buffer) -> u128 {
    let mut h: u128 = 0;
    for i in input.as_ref() {
      h = h.wrapping_add(*i as u128);
    }
    h
  }

  #[napi]
  /// Xxh3 class
  pub struct Xxh3 {
    inner: BigInt,
  }

  #[napi]
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

  #[napi]
  pub fn xxh2_plus(a: u32, b: u32) -> u32 {
    a + b
  }

  #[napi]
  pub fn xxh3_xxh64_alias(input: Buffer) -> u64 {
    super::xxh3::xxh64(input)
  }
}

use napi::bindgen_prelude::Buffer;

#[napi]
pub fn xxh64_alias(input: Buffer) -> u64 {
  xxh3::xxh64(input)
}

// A dotted namespace nests one object inside another. `xxh3.nested` hangs off
// the `xxh3` object above; `nested.inner` has no parent of its own, so both
// levels are created at registration.
#[napi(namespace = "xxh3.nested")]
pub fn xxh3_nested_plus(a: u32, b: u32) -> u32 {
  a + b
}

#[napi(namespace = "nested.inner")]
pub const NESTED_ANSWER: u32 = 42;

#[napi(namespace = "nested.inner")]
pub fn nested_double(input: u32) -> u32 {
  input * 2
}

#[napi(namespace = "nested.inner")]
pub struct NestedCounter {
  count: u32,
}

#[napi(namespace = "nested.inner")]
impl NestedCounter {
  #[napi(constructor)]
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    NestedCounter { count: 0 }
  }

  #[napi]
  pub fn increment(&mut self) -> u32 {
    self.count += 1;
    self.count
  }
}
