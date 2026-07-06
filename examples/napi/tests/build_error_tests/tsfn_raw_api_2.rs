use napi::threadsafe_function::ThreadsafeFunctionHandle;

fn construct_raw_handle(raw: napi::sys::napi_threadsafe_function) {
  let handle = ThreadsafeFunctionHandle::new(raw);
  handle.set_raw(raw);
}

fn main() {}
