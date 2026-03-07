use napi_derive::napi;

/// A simple greeting function.
#[napi]
pub fn greet(name: String) -> String {
  format!("Hello, {}!", name)
}

/// Add two numbers.
#[napi]
pub fn add(a: i32, b: i32) -> i32 {
  a + b
}

#[napi(object)]
pub struct Person {
  pub name: String,
  pub age: u32,
}

#[napi]
pub fn describe_person(person: &Person) -> String {
  format!("{} is {} years old", person.name, person.age)
}

#[napi]
pub enum Status {
  Active,
  Inactive,
  Pending,
}

#[napi]
pub struct Counter {
  count: i32,
}

#[napi]
impl Counter {
  #[napi(constructor)]
  pub fn new(initial: Option<i32>) -> Self {
    Counter {
      count: initial.unwrap_or(0),
    }
  }

  #[napi]
  pub fn increment(&mut self) -> i32 {
    self.count += 1;
    self.count
  }

  #[napi(getter)]
  pub fn value(&self) -> i32 {
    self.count
  }
}
