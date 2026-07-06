#![cfg(feature = "napi4")]

use napi::{
  bindgen_prelude::ThreadsafeFunctionBuilder,
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
  fn from(_status: Status) -> Self {
    Self("status")
  }
}

struct OwnedStatus(String);

impl AsRef<str> for OwnedStatus {
  fn as_ref(&self) -> &str {
    &self.0
  }
}

impl From<Status> for OwnedStatus {
  fn from(status: Status) -> Self {
    Self(status.as_ref().to_owned())
  }
}

type BaseBuilder<'env> = ThreadsafeFunctionBuilder<'env, (), (), (), Status, false, false, 0>;
type BorrowedBuilder<'env, 'status> =
  ThreadsafeFunctionBuilder<'env, (), (), (), BorrowedStatus<'status>, false, false, 0>;
type BorrowedFatalThreadsafeFunction<'status> =
  ThreadsafeFunction<(), (), (), BorrowedStatus<'status>, false, false, 0>;
type OwnedCalleeHandledThreadsafeFunction =
  ThreadsafeFunction<(), (), (), OwnedStatus, true, false, 0>;

#[test]
fn fatal_mode_preserves_borrowed_error_status_source_compatibility() {
  fn accept_borrowed_status<'status>(
    reason: &'status str,
    tsfn: Option<BorrowedFatalThreadsafeFunction<'status>>,
  ) {
    let _ = (reason, tsfn);
  }

  fn retag_builder<'env, 'status>(
    builder: BaseBuilder<'env>,
    reason: &'status str,
  ) -> BorrowedBuilder<'env, 'status> {
    let _ = reason;
    builder.error_status::<BorrowedStatus<'status>>()
  }

  let _: for<'status> fn(&'status str, Option<BorrowedFatalThreadsafeFunction<'status>>) =
    accept_borrowed_status;
  let _: for<'env, 'status> fn(BaseBuilder<'env>, &'status str) -> BorrowedBuilder<'env, 'status> =
    retag_builder;
}

#[test]
fn callee_handled_calls_accept_owned_send_static_error_statuses() {
  fn call_with_owned_error(tsfn: &OwnedCalleeHandledThreadsafeFunction) {
    let status = tsfn.call(
      Err(Error::new(
        OwnedStatus("CompileContract".to_owned()),
        "compile contract",
      )),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
    let _: Status = status;
  }

  let _: fn(&OwnedCalleeHandledThreadsafeFunction) = call_with_owned_error;
}
