use napi::{
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Status,
};

struct LocalPayload(*const ());

fn enqueue_non_send_payload(tsfn: &ThreadsafeFunction<LocalPayload, (), (), Status, false>) {
  tsfn.call(
    LocalPayload(std::ptr::null()),
    ThreadsafeFunctionCallMode::NonBlocking,
  );
}

fn main() {}
