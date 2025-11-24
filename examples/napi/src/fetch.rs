use std::collections::HashMap;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use reqwest::{header::HeaderMap, Method};
use tokio_stream::StreamExt;

#[napi(object)]
pub struct RequestInit {
  pub method: Option<String>,
  pub headers: Option<HashMap<String, String>>,
}

#[napi(ts_return_type = "Promise<import('undici-types').Response>")]
pub fn fetch(
  env: &Env,
  url: String,
  request_init: Option<RequestInit>,
) -> Result<AsyncBlock<Unknown<'static>>> {
  AsyncBlockBuilder::build_with_map(
    env,
    async move {
      let headers: HeaderMap =
        if let Some(headers) = request_init.as_ref().and_then(|init| init.headers.as_ref()) {
          headers
            .try_into()
            .map_err(|err| Error::new(Status::InvalidArg, format!("Invalid header: {err}")))?
        } else {
          HeaderMap::new()
        };
      let client = reqwest::Client::new();
      let request = client
        .request(Method::GET, url)
        .headers(headers)
        .build()
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid request: {e}")))?;

      let response = client
        .execute(request)
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

          Some(Ok(bytes))
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
