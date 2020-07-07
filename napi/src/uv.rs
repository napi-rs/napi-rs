extern crate alloc;

use alloc::alloc::{alloc, Layout};
use futures::future::LocalBoxFuture;
use futures::task::{waker, ArcWake, Context, Poll};
use std::future::Future;
use std::os::raw::c_void;
use std::pin::Pin;
use std::sync::Arc;

use crate::{sys, Error, Result, Status};

struct Task<'a> {
  future: LocalBoxFuture<'a, ()>,
  context: Context<'a>,
}

struct UvWaker(*mut sys::uv_async_t);

unsafe impl Send for UvWaker {}
unsafe impl Sync for UvWaker {}

impl UvWaker {
  fn new(event_loop: *mut sys::uv_loop_s) -> Result<UvWaker> {
    let uv_async_t = unsafe { alloc(Layout::new::<sys::uv_async_t>()) as *mut sys::uv_async_t };
    unsafe {
      let status = sys::uv_async_init(event_loop, uv_async_t, Some(poll_future));
      if status != 0 {
        return Err(Error::new(
          Status::Unknown,
          "Non-zero status returned from uv_async_init".to_owned(),
        ));
      }
    };
    Ok(UvWaker(uv_async_t))
  }

  #[inline]
  fn assign_task(&self, mut task: Task) {
    if !task.poll_future() {
      let arc_task = Arc::new(task);
      unsafe {
        sys::uv_handle_set_data(
          self.0 as *mut sys::uv_handle_t,
          Arc::into_raw(arc_task) as *mut c_void,
        )
      };
    } else {
      unsafe { sys::uv_close(self.0 as *mut sys::uv_handle_t, None) };
    };
  }
}

impl ArcWake for UvWaker {
  fn wake_by_ref(arc_self: &Arc<Self>) {
    let status = unsafe { sys::uv_async_send(arc_self.0) };
    assert!(status == 0, "wake_uv_async_by_ref failed");
  }
}

#[inline]
pub fn execute(event_loop: *mut sys::uv_loop_s, future: LocalBoxFuture<()>) -> Result<()> {
  let uv_waker = UvWaker::new(event_loop)?;
  let arc_waker = Arc::new(uv_waker);
  let waker_to_poll = Arc::clone(&arc_waker);
  let waker = waker(arc_waker);
  let context = Context::from_waker(&waker);
  let task = Task { future, context };
  waker_to_poll.assign_task(task);
  Ok(())
}

impl<'a> Task<'a> {
  fn poll_future(&mut self) -> bool {
    let mut pinned = Pin::new(&mut self.future);
    let fut_mut = pinned.as_mut();
    match fut_mut.poll(&mut self.context) {
      Poll::Ready(_) => true,
      Poll::Pending => false,
    }
  }
}

unsafe extern "C" fn poll_future(handle: *mut sys::uv_async_t) {
  let data_ptr = sys::uv_handle_get_data(handle as *mut sys::uv_handle_t) as *mut Task;
  let mut task = Arc::from_raw(data_ptr);
  if let Some(mut_task) = Arc::get_mut(&mut task) {
    if mut_task.poll_future() {
      sys::uv_close(handle as *mut sys::uv_handle_t, None);
    } else {
      Arc::into_raw(task);
    };
  } else {
    Arc::into_raw(task);
  }
}
