use std::{thread, time::Duration};

pub fn worker(id: u32) {
  println!("Worker {} started", id);
  thread::sleep(Duration::from_millis(5000));
  println!("Worker {} finished", id);
}

#[napi]
pub fn test_workers(amount: u32) {
  println!("Starting parallel workers...");

  let mut handles = vec![];

  for i in 0..amount {
    let handle = thread::spawn(move || {
      worker(i);
    });
    handles.push(handle);
  }

  for handle in handles {
    if let Err(e) = handle.join() {
      eprintln!("Thread panicked: {:?}", e);
    }
  }

  println!("All workers completed.");
}
