use std::{thread, time::Duration};

use napi::{
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Error, Status,
};

pub fn worker(id: u32) {
  println!("Worker {} started", id);
  thread::sleep(Duration::from_millis(500));
  thread::sleep(Duration::from_millis(200));
  println!("Worker {} finished", id);
}

#[napi]
pub fn test_workers(amount: u32, complete_callback: ThreadsafeFunction<(), ()>) {
  println!("Starting parallel workers...");

  let mut handles = vec![];

  for i in 0..amount {
    let handle = thread::spawn(move || {
      worker(i);
    });
    handles.push(handle);
  }

  thread::spawn(move || {
    for handle in handles {
      if let Err(e) = handle.join() {
        complete_callback.call(
          Err(Error::new(
            Status::GenericFailure,
            format!("Worker panicked {:?}", e),
          )),
          ThreadsafeFunctionCallMode::NonBlocking,
        );
      }
    }
    complete_callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
  });

  println!("All workers completed.");
}
