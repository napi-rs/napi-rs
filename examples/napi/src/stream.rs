use bytes::BytesMut;
use napi::bindgen_prelude::*;
use tokio::sync::mpsc::error::TrySendError;
use tokio_stream::{wrappers::ReceiverStream, StreamExt};
use tokio_util::io::{read_buf, StreamReader};

#[napi]
pub fn accept_stream(
  env: &Env,
  stream: ReadableStream<Uint8Array>,
) -> Result<AsyncBlock<BufferSlice<'static>>> {
  let web_readable_stream = stream.read()?;
  let mut input = StreamReader::new(web_readable_stream.map(|chunk| {
    chunk
      .map(bytes::Bytes::from_owner)
      .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.reason))
  }));
  AsyncBlockBuilder::build_with_map(
    env,
    async move {
      let mut bytes_mut = BytesMut::new();
      loop {
        let n = read_buf(&mut input, &mut bytes_mut).await?;
        if n == 0 {
          break;
        }
      }
      Ok(bytes_mut)
    },
    |env, mut value| {
      let value_ptr = value.as_mut_ptr();
      unsafe {
        BufferSlice::from_external(&env, value_ptr, value.len(), value, move |_, bytes| {
          drop(bytes);
        })
      }
    },
  )
}

#[napi]
pub fn create_readable_stream(env: &Env) -> Result<ReadableStream<BufferSlice>> {
  let (tx, rx) = tokio::sync::mpsc::channel(100);
  std::thread::spawn(move || {
    for _ in 0..100 {
      match tx.try_send(Ok(b"hello".to_vec())) {
        Err(TrySendError::Closed(_)) => {
          panic!("closed");
        }
        Err(TrySendError::Full(_)) => {
          panic!("queue is full");
        }
        Ok(_) => {}
      }
    }
  });
  ReadableStream::create_with_stream_bytes(env, ReceiverStream::new(rx))
}
