use crate::sys::napi_status;

#[derive(Eq, PartialEq, Debug, Clone, Copy)]
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
  #[cfg(napi4)]
  QueueFull,
  #[cfg(napi4)]
  Closing,
  #[cfg(napi6)]
  BigintExpected,
  Unknown,
}

impl From<napi_status> for Status {
  fn from(code: napi_status) -> Self {
    use Status::*;

    match code {
      napi_status::napi_ok => Ok,
      napi_status::napi_invalid_arg => InvalidArg,
      napi_status::napi_object_expected => ObjectExpected,
      napi_status::napi_string_expected => StringExpected,
      napi_status::napi_name_expected => NameExpected,
      napi_status::napi_function_expected => FunctionExpected,
      napi_status::napi_number_expected => NumberExpected,
      napi_status::napi_boolean_expected => BooleanExpected,
      napi_status::napi_array_expected => ArrayExpected,
      napi_status::napi_generic_failure => GenericFailure,
      napi_status::napi_pending_exception => PendingException,
      napi_status::napi_cancelled => Cancelled,
      napi_status::napi_escape_called_twice => EscapeCalledTwice,
      napi_status::napi_handle_scope_mismatch => HandleScopeMismatch,
      napi_status::napi_callback_scope_mismatch => CallbackScopeMismatch,
      #[cfg(napi4)]
      napi_status::napi_queue_full => QueueFull,
      #[cfg(napi4)]
      napi_status::napi_closing => Closing,
      #[cfg(napi6)]
      napi_status::napi_bigint_expected => BigintExpected,
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
      #[cfg(napi4)]
      Self::QueueFull => napi_status::napi_queue_full,
      #[cfg(napi4)]
      Self::Closing => napi_status::napi_closing,
      #[cfg(napi6)]
      Self::BigintExpected => napi_status::napi_bigint_expected,
      Self::Unknown => napi_status::napi_generic_failure,
    }
  }
}
