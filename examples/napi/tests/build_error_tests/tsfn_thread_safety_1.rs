use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

struct LocalPayload(*const ());

fn enqueue_non_send_payload(tsfn: &ThreadsafeFunction<LocalPayload, (), (), napi::Status, false>) {
  tsfn.call(
    LocalPayload(std::ptr::null()),
    ThreadsafeFunctionCallMode::NonBlocking,
  );
}

fn main() {}
