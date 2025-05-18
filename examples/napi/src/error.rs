use napi::bindgen_prelude::*;

#[napi]
pub fn throw_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Manual Error".to_owned()))
}

#[napi(catch_unwind)]
pub fn panic() {
  panic!("Don't panic");
}

#[napi]
pub fn receive_string(s: String) -> String {
  s
}

pub enum CustomError {
  NapiError(Error<Status>),
  Panic,
}

impl AsRef<str> for CustomError {
  fn as_ref(&self) -> &str {
    match self {
      CustomError::Panic => "Panic",
      CustomError::NapiError(e) => e.status.as_ref(),
    }
  }
}

#[napi]
pub fn custom_status_code() -> Result<(), CustomError> {
  Err(Error::new(CustomError::Panic, "don't panic"))
}

#[napi]
pub fn error_message_contains_null_byte(msg: Utf16String) -> Result<()> {
  Err(Error::new(Status::InvalidArg, msg))
}

#[napi]
pub async fn throw_async_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Async Error".to_owned()))
}

#[napi]
pub struct CustomStruct();

#[napi]
impl CustomStruct {
  #[napi(factory)]
  pub fn custom_status_code_for_factory() -> Result<Self, CustomError> {
    Err(Error::new(CustomError::Panic, "don't panic"))
  }

  #[napi(constructor)]
  pub fn custom_status_code_for_constructor() -> Result<Self, CustomError> {
    Err(Error::new(CustomError::Panic, "don't panic"))
  }
}

#[napi]
pub fn js_error_callback(value: Unknown) -> Result<Vec<JsError>> {
  let error: Error = value.into();
  Ok(vec![error.try_clone()?.into(), error.into()])
}

#[napi]
pub fn extends_javascript_error(env: Env, error_class: Function<String>) -> Result<()> {
  let instance = error_class.new_instance("Error message in Rust".to_owned())?;
  let mut error_object = instance.coerce_to_object()?;
  error_object.set("name", "RustError")?;
  error_object.set(
    "nativeStackTrace",
    std::backtrace::Backtrace::capture().to_string(),
  )?;
  env.throw(error_object)?;
  Ok(())
}
