use napi::bindgen_prelude::*;

#[napi(iterator)]
pub struct Fib {
  current: u32,
  next: u32,
}

#[napi]
impl Generator for Fib {
  type Yield = u32;
  type Next = i32;
  type Return = ();

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    match value {
      Some(n) => {
        self.current = n as u32;
        self.next = n as u32 + 1;
      }
      None => {
        let next = self.next;
        let current = self.current;
        self.current = next;
        self.next = current + next;
      }
    };
    Some(self.current)
  }
}

#[napi]
#[allow(clippy::new_without_default)]
impl Fib {
  #[napi(constructor)]
  pub fn new() -> Self {
    Fib {
      current: 0,
      next: 1,
    }
  }
}

#[napi(iterator)]
pub struct Fib2 {
  current: u32,
  next: u32,
}

#[napi]
impl Generator for Fib2 {
  type Yield = u32;
  type Next = i32;
  type Return = ();

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    match value {
      Some(n) => {
        self.current = n as u32;
        self.next = n as u32 + 1;
      }
      None => {
        let next = self.next;
        let current = self.current;
        self.current = next;
        self.next = current + next;
      }
    };
    Some(self.current)
  }
}

#[napi]
impl Fib2 {
  #[napi(factory)]
  pub fn create(seed: u32) -> Self {
    Self {
      current: seed,
      next: seed + 1,
    }
  }
}

#[napi(iterator, constructor)]
pub struct Fib3 {
  pub current: u32,
  pub next: u32,
}

#[napi]
impl Generator for Fib3 {
  type Yield = u32;
  type Next = i32;
  type Return = ();

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    match value {
      Some(n) => {
        self.current = n as u32;
        self.next = n as u32 + 1;
      }
      None => {
        let next = self.next;
        let current = self.current;
        self.current = next;
        self.next = current + next;
      }
    };
    Some(self.current)
  }
}
