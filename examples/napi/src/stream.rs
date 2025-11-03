use futures::{channel::mpsc, StreamExt};
use futures_util::{io::copy_buf, stream::TryStreamExt};
use napi::bindgen_prelude::*;

#[napi]
pub fn accept_stream(
  env: &Env,
  stream: ReadableStream<Uint8Array>,
) -> Result<AsyncBlock<BufferSlice<'static>>> {
  let web_readable_stream = stream.read()?;
  let mut input = web_readable_stream
    .map(|chunk| {
      chunk
        .map(|chunk| bytes::Bytes::copy_from_slice(&chunk))
        .map_err(|e| std::io::Error::other(e.reason.clone()))
    })
    .into_async_read();
  AsyncBlockBuilder::build_with_map(
    env,
    async move {
      let mut bytes_mut = Vec::new();
      loop {
        let n = copy_buf(&mut input, &mut bytes_mut).await?;
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
pub fn create_readable_stream(env: &Env) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
  let (mut tx, rx) = mpsc::channel(100);
  std::thread::spawn(move || {
    for _ in 0..100 {
      match tx.try_send(Ok(b"hello".to_vec())) {
        Err(err) => {
          if err.is_full() {
            panic!("queue is full");
          }
          if err.is_disconnected() {
            panic!("closed");
          }
        }
        Ok(_) => {}
      }
    }
  });
  ReadableStream::create_with_stream_bytes(env, rx)
}

#[napi(ts_args_type = "readableStreamClass: typeof ReadableStream")]
pub fn create_readable_stream_from_class<'env>(
  env: &Env,
  readable_stream_class: Unknown<'env>,
) -> Result<ReadableStream<'env, BufferSlice<'env>>> {
  let (mut tx, rx) = mpsc::channel(100);
  std::thread::spawn(move || {
    for _ in 0..100 {
      match tx.try_send(Ok(b"hello".to_vec())) {
        Err(err) => {
          if err.is_full() {
            panic!("queue is full");
          }
          if err.is_disconnected() {
            panic!("closed");
          }
        }
        Ok(_) => {}
      }
    }
  });
  ReadableStream::with_stream_bytes_and_readable_stream_class(env, &readable_stream_class, rx)
}
