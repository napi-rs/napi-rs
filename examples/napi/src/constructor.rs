#[napi(constructor)]
pub struct Selector {
  pub order_by: Vec<String>,
  pub select: Vec<String>,
  pub r#struct: String,
  pub r#where: Option<String>,
}
