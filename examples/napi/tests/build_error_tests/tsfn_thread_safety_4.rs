use std::{cell::Cell, rc::Rc};

use napi::{bindgen_prelude::FromNapiValue, threadsafe_function::ThreadsafeFunction, Result};

struct LocalReturn(Rc<Cell<u32>>);

impl FromNapiValue for LocalReturn {
  unsafe fn from_napi_value(
    _env: napi::sys::napi_env,
    _value: napi::sys::napi_value,
  ) -> Result<Self> {
    Ok(Self(Rc::new(Cell::new(0))))
  }
}

fn enqueue_non_send_async_return(
  tsfn: &ThreadsafeFunction<(), LocalReturn, (), napi::Status, false>,
) {
  let _future = tsfn.call_async(());
}

fn main() {}
