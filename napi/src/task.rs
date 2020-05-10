use threadpool::ThreadPool;

use crate::{Env, Result, Value, ValueType};

pub struct NapiRSThreadPool(pub ThreadPool);

unsafe impl Send for NapiRSThreadPool {}

unsafe impl Sync for NapiRSThreadPool {}

pub trait Task {
  type Output: Send + 'static;
  type JsValue: ValueType;

  fn compute(&mut self) -> Result<Self::Output>;

  fn resolve(&self, env: &mut Env, output: Self::Output) -> Result<Value<Self::JsValue>>;
}

pub struct ThreadSafeTask<T: Task>(pub *mut T);

impl<T: Task> ThreadSafeTask<T> {
  pub fn new(task: T) -> ThreadSafeTask<T> {
    ThreadSafeTask(Box::into_raw(Box::new(task)))
  }

  #[inline]
  pub fn borrow(&self) -> &'static mut T {
    Box::leak(unsafe { Box::from_raw(self.0) })
  }
}

impl<T: Task> Drop for ThreadSafeTask<T> {
  fn drop(&mut self) {
    unsafe { Box::from_raw(self.0) };
  }
}

unsafe impl<T: Task> Send for ThreadSafeTask<T> {}
unsafe impl<T: Task> Sync for ThreadSafeTask<T> {}
