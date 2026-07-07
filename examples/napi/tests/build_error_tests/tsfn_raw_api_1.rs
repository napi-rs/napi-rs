use napi::threadsafe_function::ThreadsafeFunction;

fn access_raw_handle(tsfn: &ThreadsafeFunction<(), (), (), napi::Status, false>) {
  let _raw = tsfn.raw();
  let _handle = &tsfn.handle;
}

fn main() {}
