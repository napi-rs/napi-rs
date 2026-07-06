use napi::{
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Error, Status,
};

struct LocalStatus(*const ());

impl AsRef<str> for LocalStatus {
  fn as_ref(&self) -> &str {
    "local"
  }
}

impl From<Status> for LocalStatus {
  fn from(_value: Status) -> Self {
    Self(std::ptr::null())
  }
}

fn enqueue_non_send_error(tsfn: &ThreadsafeFunction<(), (), (), LocalStatus, true>) {
  tsfn.call(
    Err(Error::new(LocalStatus(std::ptr::null()), "local error")),
    ThreadsafeFunctionCallMode::NonBlocking,
  );
}

fn main() {}
