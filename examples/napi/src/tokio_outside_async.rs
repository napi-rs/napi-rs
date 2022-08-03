use std::time::Duration;
use tokio::{sync::oneshot, time::Instant};

#[napi]
pub fn use_tokio_without_async() {
  let (sender, receiver) = oneshot::channel();
  let handle = tokio::task::spawn(async {
    // If this panics, the test failed.
    sender.send(true).unwrap();
  });
  let start = Instant::now();
  while !handle.is_finished() {
    if start.elapsed() > Duration::from_secs(5) {
      panic!("The future never resolved.");
    }
  }
  assert_eq!(receiver.blocking_recv(), Ok(true));
}
