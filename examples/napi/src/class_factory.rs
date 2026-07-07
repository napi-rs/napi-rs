use napi::{bindgen_prelude::Promise, Error, Result};

async fn always_4() -> i32 {
  4
}

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

  #[napi(factory)]
  pub async fn with_4_name(name: String) -> Self {
    Self {
      name: format!("{name}-{}", always_4().await),
    }
  }

  #[napi(factory)]
  pub async fn with_4_name_result(name: String) -> Result<Self> {
    Ok(Self {
      name: format!("{name}-{}", always_4().await),
    })
  }

  #[napi(factory, skip_typescript)]
  pub async fn with_name_after(name: String, gate: Promise<()>) -> Result<Self> {
    gate.await?;
    Ok(Self { name })
  }

  #[napi(factory, skip_typescript)]
  pub async fn fail_after(gate: Promise<()>) -> Result<Self> {
    gate.await?;
    Err(Error::from_reason("intentional async factory failure"))
  }

  #[napi(factory, skip_typescript)]
  pub async fn pending() -> Self {
    std::future::pending().await
  }

  #[napi]
  pub fn set_name(&mut self, name: String) -> &Self {
    self.name = name;
    self
  }
}
