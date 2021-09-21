#[doc(hidden)]
#[macro_export]
macro_rules! check_status_or_throw {
  ($env:expr, $code:expr, $($msg:tt)*) => {
    if let Err(e) = $crate::check_status!($code, $($msg)*) {
      $crate::JsError::from(e).throw_into($env);
      return;
    }
  };
}
