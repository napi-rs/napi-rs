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
}
