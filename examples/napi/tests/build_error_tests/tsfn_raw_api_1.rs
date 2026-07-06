use napi::{threadsafe_function::ThreadsafeFunction, Status};

fn access_raw_handle(tsfn: &ThreadsafeFunction<(), (), (), Status, false>) {
  let _raw = tsfn.raw();
  let _handle = &tsfn.handle;
}

fn main() {}
