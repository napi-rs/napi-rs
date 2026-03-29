use napi_derive::napi;

#[napi(object)]
pub struct TypegenOptions {
  pub crate_dir: String,
  pub cargo_metadata: Option<String>,
  pub strict: Option<bool>,
}

#[napi(object)]
pub struct TypegenResult {
  pub type_defs: Vec<String>,
  pub parse_errors: u32,
}

#[napi]
pub fn generate(options: TypegenOptions) -> napi::Result<TypegenResult> {
  let cargo_metadata_path = options
    .cargo_metadata
    .as_ref()
    .map(std::path::PathBuf::from);
  let result = napi_typegen::generate_type_defs(
    &std::path::PathBuf::from(&options.crate_dir),
    cargo_metadata_path.as_deref(),
    options.strict.unwrap_or(false),
  )
  .map_err(|e| napi::Error::from_reason(format!("{:#}", e)))?;

  Ok(TypegenResult {
    type_defs: result.type_defs,
    parse_errors: result.parse_errors,
  })
}
