use super::napi_status;

#[derive(Eq, PartialEq, Debug)]
pub enum Status {
  Ok,
  InvalidArg,
  ObjectExpected,
  StringExpected,
  NameExpected,
  FunctionExpected,
  NumberExpected,
  BooleanExpected,
  ArrayExpected,
  GenericFailure,
  PendingException,
  Cancelled,
  EscapeCalledTwice,
  HandleScopeMismatch,
  CallbackScopeMismatch,
  QueueFull,
  Closing,
  BigintExpected,
  Unknown,
}

impl From<napi_status> for Status {
  fn from(code: napi_status) -> Self {
    use self::napi_status::*;
    use Status::*;

    match code {
      napi_ok => Ok,
      napi_invalid_arg => InvalidArg,
      napi_object_expected => ObjectExpected,
      napi_string_expected => StringExpected,
      napi_name_expected => NameExpected,
      napi_function_expected => FunctionExpected,
      napi_number_expected => NumberExpected,
      napi_boolean_expected => BooleanExpected,
      napi_array_expected => ArrayExpected,
      napi_generic_failure => GenericFailure,
      napi_pending_exception => PendingException,
      napi_cancelled => Cancelled,
      napi_escape_called_twice => EscapeCalledTwice,
      napi_handle_scope_mismatch => HandleScopeMismatch,
      napi_callback_scope_mismatch => CallbackScopeMismatch,
      napi_queue_full => QueueFull,
      napi_closing => Closing,
      napi_bigint_expected => BigintExpected,
      _ => Unknown,
    }
  }
}

impl Into<self::napi_status> for Status {
  fn into(self) -> napi_status {
    match self {
      Self::Ok => napi_status::napi_ok,
      Self::InvalidArg => napi_status::napi_invalid_arg,
      Self::ObjectExpected => napi_status::napi_object_expected,
      Self::StringExpected => napi_status::napi_string_expected,
      Self::NameExpected => napi_status::napi_name_expected,
      Self::FunctionExpected => napi_status::napi_function_expected,
      Self::NumberExpected => napi_status::napi_number_expected,
      Self::BooleanExpected => napi_status::napi_boolean_expected,
      Self::ArrayExpected => napi_status::napi_array_expected,
      Self::GenericFailure => napi_status::napi_generic_failure,
      Self::PendingException => napi_status::napi_pending_exception,
      Self::Cancelled => napi_status::napi_cancelled,
      Self::EscapeCalledTwice => napi_status::napi_escape_called_twice,
      Self::HandleScopeMismatch => napi_status::napi_handle_scope_mismatch,
      Self::CallbackScopeMismatch => napi_status::napi_callback_scope_mismatch,
      Self::QueueFull => napi_status::napi_queue_full,
      Self::Closing => napi_status::napi_closing,
      Self::BigintExpected => napi_status::napi_bigint_expected,
      Self::Unknown => napi_status::napi_generic_failure,
    }
  }
}
