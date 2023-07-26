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
    Either3::C(b) => u32::from(b),
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
    Either4::C(b) => u32::from(b),
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
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    JsClassForEither {}
  }
}

#[napi]
struct AnotherClassForEither {}

#[napi]
impl AnotherClassForEither {
  #[allow(clippy::new_without_default)]
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {}
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

#[napi]
fn receive_different_class(either: Either<&JsClassForEither, &AnotherClassForEither>) -> u32 {
  match either {
    Either::A(_) => 42,
    Either::B(_) => 100,
  }
}

#[napi]
fn return_either_class(input: i32) -> Either<u32, JsClassForEither> {
  if input > 0 {
    Either::A(input as u32)
  } else {
    Either::B(JsClassForEither {})
  }
}

#[napi]
fn either_from_option() -> Either<JsClassForEither, Undefined> {
  Some(JsClassForEither {}).into()
}

#[napi(object)]
pub struct A {
  pub foo: u32,
}

#[napi(object)]
pub struct B {
  pub bar: u32,
}

#[napi(object)]
pub struct C {
  pub baz: u32,
}

#[napi]
pub fn either_from_objects(input: Either3<A, B, C>) -> String {
  match &input {
    Either3::A(_) => "A".to_owned(),
    Either3::B(_) => "B".to_owned(),
    Either3::C(_) => "C".to_owned(),
  }
}

#[napi]
pub fn either_bool_or_function(_input: Either<bool, JsFunction>) {}

#[napi]
pub async fn promise_in_either(input: Either<u32, Promise<u32>>) -> Result<bool> {
  match input {
    Either::A(a) => Ok(a > 10),
    Either::B(b) => {
      let r = b.await?;
      Ok(r > 10)
    }
  }
}
