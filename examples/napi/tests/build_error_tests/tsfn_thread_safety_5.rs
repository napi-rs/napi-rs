use napi::{
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Error, Status,
};

struct BorrowedStatus<'a>(&'a str);

impl AsRef<str> for BorrowedStatus<'_> {
  fn as_ref(&self) -> &str {
    self.0
  }
}

impl From<Status> for BorrowedStatus<'_> {
  fn from(_value: Status) -> Self {
    Self("status")
  }
}

fn enqueue_borrowed_error<'a>(reason: &'a str) {
  let tsfn = Option::<ThreadsafeFunction<(), (), (), BorrowedStatus<'a>, true>>::None;
  if let Some(tsfn) = tsfn {
    tsfn.call(
      Err(Error::new(BorrowedStatus(reason), "borrowed error")),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  }
}

fn main() {}
