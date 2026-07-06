use std::{cell::Cell, rc::Rc};

use napi::{
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Status,
};

fn enqueue_non_send_return_callback(tsfn: &ThreadsafeFunction<(), (), (), Status, false>) {
  let state = Rc::new(Cell::new(0));
  tsfn.call_with_return_value(
    (),
    ThreadsafeFunctionCallMode::NonBlocking,
    move |result, _env| {
      result?;
      state.set(1);
      Ok(())
    },
  );
}

fn main() {}
