use std::ops::{Deref, DerefMut};

pub use crate::JsFunction;

pub struct Function<T> {
  inner: T,
}

impl<T> Function<T> {
  pub fn new(inner: T) -> Self {
    Self { inner }
  }
}

impl<T> Deref for Function<T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    &self.inner
  }
}

impl<T> DerefMut for Function<T> {
  fn deref_mut(&mut self) -> &mut Self::Target {
    &mut self.inner
  }
}
