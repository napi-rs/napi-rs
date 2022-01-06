use napi::bindgen_prelude::*;

#[napi]
fn either_string_or_number(input: Either<String, u32>) -> u32 {
  match input {
    Either::A(s) => s.len() as u32,
    Either::B(n) => n,
  }
}

#[napi]
fn return_either(input: u32) -> Either<String, u32> {
  if input > 10 {
    Either::A(format!("{}", input))
  } else {
    Either::B(input)
  }
}

#[napi]
fn either3(input: Either3<String, u32, bool>) -> u32 {
  match input {
    Either3::A(s) => s.len() as u32,
    Either3::B(n) => n,
    Either3::C(b) => {
      if b {
        1
      } else {
        0
      }
    }
  }
}

#[napi(object)]
struct Obj {
  pub v: Either<String, u32>,
}

#[napi]
fn either4(input: Either4<String, u32, bool, Obj>) -> u32 {
  match input {
    Either4::A(s) => s.len() as u32,
    Either4::B(n) => n,
    Either4::C(b) => {
      if b {
        1
      } else {
        0
      }
    }
    Either4::D(f) => match f.v {
      Either::A(s) => s.len() as u32,
      Either::B(n) => n,
    },
  }
}

#[napi]
struct JsClassForEither {}

#[napi]
impl JsClassForEither {
  #[napi(constructor)]
  pub fn new() -> Self {
    JsClassForEither {}
  }
}

#[napi]
fn receive_class_or_number(either: Either<u32, &JsClassForEither>) -> u32 {
  match either {
    Either::A(n) => n + 1,
    Either::B(_) => 100,
  }
}

#[napi]
fn receive_mut_class_or_number(either: Either<u32, &mut JsClassForEither>) -> u32 {
  match either {
    Either::A(n) => n + 1,
    Either::B(_) => 100,
  }
}
