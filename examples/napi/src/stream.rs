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
      .map(|chunk| bytes::Bytes::copy_from_slice(&chunk))
      .map_err(|e| std::io::Error::other(e.reason.clone()))
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
pub fn create_readable_stream(env: &Env) -> Result<ReadableStream<'_, BufferSlice<'_>>> {
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

#[napi(object)]
#[derive(Default)]
pub struct Foo {
  pub hello: String,
}

#[napi(object)]
pub struct StreamItem {
  pub something: Foo,
  pub name: String,
  pub size: i32,
}

impl Default for StreamItem {
  fn default() -> Self {
    Self {
      something: Default::default(),
      name: Default::default(),
      size: Default::default(),
    }
  }
}

#[napi]
pub fn create_readable_stream_with_object(env: &Env) -> Result<ReadableStream<'_, StreamItem>> {
  let (tx, rx) = tokio::sync::mpsc::channel(100);
  std::thread::spawn(move || {
    for _it in 0..100 {
      let item = StreamItem {
        something: Default::default(),
        name: Default::default(),
        size: _it,
      };
      match tx.try_send(Ok(item)) {
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
  ReadableStream::new(env, ReceiverStream::new(rx))
}

#[napi(ts_args_type = "readableStreamClass: typeof ReadableStream")]
pub fn create_readable_stream_from_class<'env>(
  env: &Env,
  readable_stream_class: Unknown<'env>,
) -> Result<ReadableStream<'env, BufferSlice<'env>>> {
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
  ReadableStream::with_stream_bytes_and_readable_stream_class(
    env,
    &readable_stream_class,
    ReceiverStream::new(rx),
  )
}
