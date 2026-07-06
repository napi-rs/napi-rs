use napi::{
  bindgen_prelude::ThreadsafeFunctionBuilder,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Status,
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

fn consume_builder<'env, 'status>(
  _builder: ThreadsafeFunctionBuilder<'env, (), (), (), BorrowedStatus<'status>>,
  _status: BorrowedStatus<'status>,
) {
}

fn configure_builder(builder: ThreadsafeFunctionBuilder<'_, (), (), (), Status>) {
  let reason = String::from("borrowed");
  consume_builder(
    builder
      .error_status::<BorrowedStatus<'_>>()
      .callee_handled::<false>(),
    BorrowedStatus(&reason),
  );
}

fn call_fatal_mode_with_borrowed_status<'a>(
  tsfn: &ThreadsafeFunction<(), (), (), BorrowedStatus<'a>, false>,
) {
  tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
}

fn main() {}
