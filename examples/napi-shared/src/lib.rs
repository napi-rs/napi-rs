use napi::{bindgen_prelude::ClassInstance, Either};
use napi_derive::napi;

#[napi(object)]
pub struct Shared {
  pub value: u32,
}

// Test fixture for GitHub issue #2722: Complex struct with constructor and multiple methods
#[napi]
pub struct ComplexClass {
  pub value: String,
  pub number: i32,
}

impl From<(String, i32)> for ComplexClass {
  fn from(value: (String, i32)) -> Self {
    ComplexClass {
      value: value.0,
      number: value.1,
    }
  }
}

impl<'env> From<Either<ClassInstance<'env, ComplexClass>, String>> for ComplexClass {
  fn from(value: Either<ClassInstance<'env, ComplexClass>, String>) -> Self {
    match value {
      Either::A(instance) => ComplexClass {
        value: (*instance).value.clone(),
        number: instance.number,
      },
      Either::B(value) => ComplexClass { value, number: 0 },
    }
  }
}

#[napi]
impl ComplexClass {
  #[napi(constructor)]
  pub fn new(value: Either<String, ClassInstance<ComplexClass>>, number: i32) -> Self {
    let value_str = match value {
      Either::A(s) => s,
      Either::B(instance) => format!("cloned:{}", (*instance).value),
    };
    ComplexClass {
      value: value_str,
      number,
    }
  }

  #[napi]
  pub fn method_one(&self) -> String {
    format!("method_one: {}", self.value)
  }

  #[napi]
  pub fn method_two(&self) -> i32 {
    self.number * 2
  }

  #[napi]
  pub fn method_three(&self) -> String {
    format!("method_three: {} - {}", self.value, self.number)
  }

  #[napi]
  pub fn method_four(&self) -> bool {
    self.number > 0
  }

  #[napi]
  pub fn method_five(&self) -> String {
    self.value.to_uppercase()
  }
}

// Cross-crate identity fixture: a namespaced, renamed class declared in this
// crate and referenced from `examples/napi/src/identity.rs` in several
// shapes. Proves the CLI's cross-fragment reference resolution actually
// qualifies a reference across a real crate boundary — `examples/napi`'s own
// macro expansion (a separate rustc process) can never see this crate's
// `CLASS_STRUCTS`/`ALIAS`, so its references to `TimeSeriesNapi` always fall
// through to the sentinel path and must be resolved by the CLI once both
// crates' fragments are collected.
#[napi(namespace = "Sdk", js_name = "TimeSeries")]
pub struct TimeSeriesNapi {
  pub value: f64,
}

// The namespace must be repeated on the impl block: an attribute-namespaced
// class's methods register under `(namespace, js_name)`, so an impl block
// without the matching namespace would register its methods under a different
// key and they would not attach to `Sdk.TimeSeries`.
#[napi(namespace = "Sdk")]
impl TimeSeriesNapi {
  #[napi(factory)]
  pub fn from_value(value: f64) -> Self {
    TimeSeriesNapi { value }
  }
}
