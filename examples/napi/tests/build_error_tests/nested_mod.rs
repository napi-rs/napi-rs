use napi_derive::napi;

#[napi]
mod short {
  #[napi]
  mod inner {}
}

#[napi]
mod qualified {
  #[napi_derive::napi]
  mod inner {}
}

#[napi]
mod absolute {
  #[::napi_derive::napi]
  mod inner {}
}

fn main() {}
