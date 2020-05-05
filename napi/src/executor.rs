use futures::task::Poll;
use std::future::Future;
use std::mem;
use std::os::raw::c_void;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, RawWaker, RawWakerVTable, Waker};

use crate::{sys, Error, Result, Status};

const UV_ASYNC_V_TABLE: RawWakerVTable = RawWakerVTable::new(
  clone_executor,
  wake_uv_async,
  wake_uv_async_by_ref,
  drop_uv_async,
);

unsafe fn clone_executor(uv_async_t: *const ()) -> RawWaker {
  RawWaker::new(uv_async_t, &UV_ASYNC_V_TABLE)
}

unsafe fn wake_uv_async(uv_async_t: *const ()) {
  let status = sys::uv_async_send(uv_async_t as *mut sys::uv_async_t);
  assert!(status == 0, "wake_uv_async failed");
}

unsafe fn wake_uv_async_by_ref(uv_async_t: *const ()) {
  let status = sys::uv_async_send(uv_async_t as *mut sys::uv_async_t);
  assert!(status == 0, "wake_uv_async_by_ref failed");
}

unsafe fn drop_uv_async(_uv_async_t_ptr: *const ()) {}

struct Task<'a> {
  future: Pin<Box<dyn Future<Output = ()>>>,
  context: Context<'a>,
}

pub fn execute<F: 'static + Future<Output = ()>>(
  event_loop: *mut sys::uv_loop_s,
  future: F,
) -> Result<()> {
  let uninit = mem::MaybeUninit::<sys::uv_async_t>::uninit();
  let uv_async_t: Box<sys::uv_async_t> = unsafe { Box::new(uninit.assume_init()) };
  let uv_async_t_ref = Box::leak(uv_async_t);
  unsafe {
    let status = sys::uv_async_init(event_loop, uv_async_t_ref, Some(poll_future));
    if status != 0 {
      return Err(Error {
        status: Status::Unknown,
        reason: Some("Non-zero status returned from uv_async_init".to_owned()),
      });
    }
  };
  unsafe {
    let waker = Waker::from_raw(RawWaker::new(
      uv_async_t_ref as *mut _ as *const (),
      &UV_ASYNC_V_TABLE,
    ));
    let context = Context::from_waker(&waker);
    let mut task = Box::new(Task {
      future: Box::pin(future),
      context,
    });
    if !task.as_mut().poll_future() {
      let arc_task = Arc::new(task);
      sys::uv_handle_set_data(
        uv_async_t_ref as *mut _ as *mut sys::uv_handle_t,
        Arc::into_raw(arc_task) as *mut c_void,
      );
    };
    Ok(())
  }
}

impl<'a> Task<'a> {
  fn poll_future(&mut self) -> bool {
    match self.future.as_mut().poll(&mut self.context) {
      Poll::Ready(_) => true,
      Poll::Pending => false,
    }
  }
}

unsafe extern "C" fn poll_future(handle: *mut sys::uv_async_t) {
  let data_ptr = sys::uv_handle_get_data(handle as *mut sys::uv_handle_t) as *mut Box<Task>;
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
