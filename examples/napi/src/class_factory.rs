#[napi]
pub struct ClassWithFactory {
  pub name: String,
}

#[napi]
impl ClassWithFactory {
  #[napi(factory)]
  pub fn with_name(name: String) -> Self {
    Self { name }
  }

  #[napi]
  pub fn set_name(&mut self, name: String) -> &Self {
    self.name = name;
    self
  }
}
