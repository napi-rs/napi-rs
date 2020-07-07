use std::ffi::c_void;
use std::mem;
use std::pin::Pin;
use std::thread::spawn;
use std::time::Duration;

use futures::future::Future;
use once_cell::sync::OnceCell;
use tokio::runtime::Runtime;
use tokio::sync::mpsc;

use crate::Error;

pub(crate) enum Message {
  Task(Pin<Box<dyn Future<Output = ()> + Send>>),
  Shutdown,
}

#[inline]
pub(crate) fn get_tokio_sender() -> &'static mpsc::Sender<Message> {
  static SENDER: OnceCell<mpsc::Sender<Message>> = OnceCell::new();
  SENDER.get_or_init(|| {
    let (sender, mut receiver) = mpsc::channel(100);
    spawn(move || {
      let mut rt = Runtime::new().expect("Failed to create tokio runtime");
      rt.block_on(async {
        loop {
          match receiver.recv().await {
            Some(Message::Task(fut)) => fut.await,
            Some(Message::Shutdown) => break,
            None => {}
          }
        }
      });
      rt.shutdown_timeout(Duration::from_secs(5));
      mem::drop(receiver);
    });

    sender
  })
}

pub unsafe extern "C" fn shutdown(_data: *mut c_void) {
  let mut sender = get_tokio_sender().clone();
  sender
    .try_send(Message::Shutdown)
    .map_err(|e| Error::from_reason(format!("Shutdown tokio runtime failed: {}", e)))
    .unwrap()
}
