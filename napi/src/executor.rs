use super::sys;
use futures::task::Poll;
use std::future::Future;
use std::mem;
use std::os::raw::c_void;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
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
  resolved: AtomicBool,
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
      let task = Box::leak(Box::new(Task {
        future: Box::pin(future),
        context,
        resolved: AtomicBool::new(false),
      }));
      sys::uv_handle_set_data(
        uv_async_t_ref as *mut _ as *mut sys::uv_handle_t,
        task as *mut _ as *mut c_void,
      );
      task.poll_future();
    }
  }
}

impl<'a> Task<'a> {
  fn poll_future(&mut self) -> bool {
    if self.resolved.load(Ordering::Relaxed) {
      return true;
    }
    match self.future.as_mut().poll(&mut self.context) {
      Poll::Ready(_) => {
        while !self.resolved.swap(true, Ordering::Relaxed) {}
        true
      }
      Poll::Pending => false,
    }
  }
}

unsafe extern "C" fn poll_future(handle: *mut sys::uv_async_t) {
  let data_ptr = sys::uv_handle_get_data(handle as *mut sys::uv_handle_t) as *mut Task;
  let mut task = Box::from_raw(data_ptr);
  if !task.as_mut().poll_future() {
    Box::leak(task);
  } else {
    sys::uv_close(
      handle as *mut sys::uv_handle_t,
      Some(drop_handle_after_close),
    );
  };
}

unsafe extern "C" fn drop_handle_after_close(handle: *mut sys::uv_handle_t) {
  Box::from_raw(handle);
}
