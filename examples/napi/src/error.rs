use napi::bindgen_prelude::*;

#[napi]
pub fn throw_error() -> Result<()> {
  Err(Error::new(Status::InvalidArg, "Manual Error".to_owned()))
}

#[napi]
pub fn throw_error_with_cause() -> Result<()> {
  let mut err = Error::new(Status::GenericFailure, "Manual Error".to_owned());
  err.set_cause(Error::new(Status::InvalidArg, "Inner Error".to_owned()));
  Err(err)
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

/// A struct that intentionally fails during conversion to JS value.
/// Used to test error handling in async functions when ToNapiValue::to_napi_value returns an error.
/// Note: This struct is not exported to JS and cannot be used directly from JavaScript.
pub struct FailToNapiValue;

impl ToNapiValue for FailToNapiValue {
  unsafe fn to_napi_value(_: napi::sys::napi_env, _: Self) -> napi::Result<napi::sys::napi_value> {
    Err(napi::Error::from_reason("Fail in to_napi_value"))
  }
}

/// Test function that returns a type which fails during to_napi_value conversion.
/// This tests that errors from ToNapiValue::to_napi_value properly reject the promise
/// instead of throwing synchronously.
///
/// The promise will always be rejected with "Fail in to_napi_value" error.
#[napi(ts_return_type = "Promise<never>")]
pub async fn async_fail_in_to_napi_value() -> FailToNapiValue {
  FailToNapiValue
}
