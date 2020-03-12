use super::sys;
use futures::task::Poll;
use std::future::Future;
use std::mem;
use std::os::raw::c_void;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, RawWaker, RawWakerVTable, Waker};

pub struct LibuvExecutor {
  event_loop: *mut sys::uv_loop_s,
}

#[derive(Clone, Debug)]
struct LibuvWaker(*mut sys::uv_async_t);

unsafe impl Send for LibuvWaker {}

unsafe impl Sync for LibuvWaker {}

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

unsafe fn drop_uv_async(uv_async_t_ptr: *const ()) {
  sys::uv_unref(uv_async_t_ptr as *mut sys::uv_handle_t);
}

struct Task<'a> {
  future: Pin<Box<dyn Future<Output = ()>>>,
  context: Context<'a>,
}

impl LibuvExecutor {
  pub fn new(event_loop: *mut sys::uv_loop_s) -> Self {
    Self { event_loop }
  }

  pub fn execute<F: 'static + Future<Output = ()>>(&self, future: F) {
    let uninit = mem::MaybeUninit::<sys::uv_async_t>::uninit();
    let uv_async_t: Box<sys::uv_async_t> = unsafe { Box::new(uninit.assume_init()) };
    let uv_async_t_ref = Box::leak(uv_async_t);
    unsafe {
      let status = sys::uv_async_init(self.event_loop, uv_async_t_ref, Some(poll_future));
      assert!(status == 0, "Non-zero status returned from uv_async_init");
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
      }
    }
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
      Arc::into_raw(task);
    } else {
      sys::uv_close(
        handle as *mut sys::uv_handle_t,
        Some(drop_handle_after_close),
      );
    };
  } else {
    Arc::into_raw(task);
  }
}

unsafe extern "C" fn drop_handle_after_close(handle: *mut sys::uv_handle_t) {
  Box::from_raw(handle);
}
