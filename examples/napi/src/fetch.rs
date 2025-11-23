use napi::bindgen_prelude::*;
use napi_derive::napi;
use tokio_stream::StreamExt;

#[napi(ts_return_type = "Promise<import('undici-types').Response>")]
pub fn fetch(env: &Env, url: String) -> Result<AsyncBlock<Unknown<'static>>> {
  AsyncBlockBuilder::build_with_map(
    env,
    async move {
      let response = reqwest::get(url)
        .await
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      Ok(response)
    },
    |env, response| {
      let global = env.get_global()?;
      let response_constructor: Function<ReadableStream<BufferSlice>, ()> =
        global.get_named_property("Response")?;
      let reqwest_stream = response.bytes_stream();
      let napi_stream = reqwest_stream.filter_map(|chunk| match chunk {
        Ok(bytes) => {
          if bytes.is_empty() {
            return None;
          }

          Some(Ok(bytes.to_vec()))
        }
        Err(e) => Some(Err(napi::Error::new(
          napi::Status::Unknown,
          format!("Error reading response stream: {e:?}"),
        ))),
      });
      let js_stream = ReadableStream::create_with_stream_bytes(&env, napi_stream)?;
      response_constructor.new_instance(js_stream)
    },
  )
}
