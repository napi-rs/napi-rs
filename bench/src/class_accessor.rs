#[napi]
pub struct BenchFieldAccessor {
  #[napi(getter, setter)]
  pub value: u32,
}

#[napi]
impl BenchFieldAccessor {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self { value }
  }
}

#[napi]
pub struct BenchImplAccessor {
  value: u32,
}

#[napi]
impl BenchImplAccessor {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self { value }
  }

  #[napi(getter)]
  pub fn value(&self) -> u32 {
    self.value
  }

  #[napi(setter)]
  pub fn set_value(&mut self, value: u32) {
    self.value = value;
  }
}
