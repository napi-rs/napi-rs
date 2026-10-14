use napi::bindgen_prelude::*;

// Repro coverage for napi-rs#3608: a `#[napi(factory)]` creates its object with
// `napi_new_instance` on the JS `this` of the call, and generated constructors
// return early while a factory runs. So JS can get an object of one class that
// holds the Rust value of another class. Without the object type tag (builds
// without `napi8`, and every wasm build) the methods, accessors and `&T`
// arguments of the first class then cast the value to the wrong Rust type.

#[napi]
pub struct Issue3608Holder {
  payload: Vec<u8>,
}

#[napi]
impl Issue3608Holder {
  #[napi(factory)]
  pub fn create() -> Self {
    Self {
      payload: vec![1, 2, 3],
    }
  }

  #[napi]
  pub fn len(&self) -> u32 {
    self.payload.len() as u32
  }

  /// `Reference<T>` argument of another class.
  #[napi]
  pub fn read_other_reference(other: Reference<Issue3608Other>) -> Vec<f64> {
    other.read()
  }
}

#[napi]
pub struct Issue3608Other {
  pub a: u32,
  b: u32,
  c: f64,
}

#[napi]
impl Issue3608Other {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      a: 11,
      b: 22,
      c: 3.5,
    }
  }

  #[napi]
  pub fn read(&self) -> Vec<f64> {
    vec![self.a as f64, self.b as f64, self.c]
  }

  #[napi]
  pub fn bump(&mut self) -> u32 {
    self.a += 1;
    self.a
  }
}

#[napi]
pub struct Issue3608Wide {
  x: f64,
  y: f64,
  z: f64,
  w: f64,
}

#[napi]
impl Issue3608Wide {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      x: 1.25,
      y: 2.5,
      z: 0.0,
      w: 0.0,
    }
  }

  #[napi]
  pub fn sum(&self) -> f64 {
    self.x + self.y + self.z + self.w
  }
}

#[napi]
pub fn issue3608_read_other(other: &Issue3608Other) -> Vec<f64> {
  other.read()
}

#[napi]
pub fn issue3608_bump_other(other: &mut Issue3608Other) -> u32 {
  other.bump()
}

#[napi]
pub fn issue3608_read_other_instance(other: ClassInstance<Issue3608Other>) -> Vec<f64> {
  other.read()
}
