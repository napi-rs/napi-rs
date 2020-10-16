use std::env::var;
use std::ffi::c_void;
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
    let buffer_size = var("NAPI_RS_TOKIO_CHANNEL_BUFFER_SIZE")
      .map_err(|_| ())
      .and_then(|s| s.parse().map_err(|_| ()))
      .unwrap_or(100);
    let (sender, mut receiver) = mpsc::channel(buffer_size);
    spawn(move || {
      let rt = Runtime::new().expect("Failed to create tokio runtime");
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
    });

    sender
  })
}

pub unsafe extern "C" fn shutdown(_data: *mut c_void) {
  let sender = get_tokio_sender().clone();
  sender
    .try_send(Message::Shutdown)
    .map_err(|e| Error::from_reason(format!("Shutdown tokio runtime failed: {}", e)))
    .unwrap()
}
