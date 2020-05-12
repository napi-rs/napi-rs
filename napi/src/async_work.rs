use std::mem;
use std::os::raw::{c_char, c_void};
use std::ptr;

use crate::{check_status, sys, Env, Result, Task};

pub struct AsyncWork<T: Task> {
  inner_task: T,
  deferred: sys::napi_deferred,
  value: Result<*mut T::Output>,
}

impl<T: Task> AsyncWork<T> {
  pub fn run(env: sys::napi_env, task: T, deferred: sys::napi_deferred) -> Result<()> {
    let mut raw_resource = ptr::null_mut();
    let status = unsafe { sys::napi_create_object(env, &mut raw_resource) };
    check_status(status)?;
    let mut raw_name = ptr::null_mut();
    let s = "napi_rs_async";
    let status = unsafe {
      sys::napi_create_string_utf8(
        env,
        s.as_ptr() as *const c_char,
        s.len() as u64,
        &mut raw_name,
      )
    };
    check_status(status)?;
    let mut raw_context = ptr::null_mut();
    unsafe {
      let status = sys::napi_async_init(env, raw_resource, raw_name, &mut raw_context);
      check_status(status)?;
    };
    let result = AsyncWork {
      inner_task: task,
      deferred,
      value: Ok(ptr::null_mut()),
    };
    let mut async_work = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_async_work(
        env,
        raw_resource,
        raw_name,
        Some(execute::<T> as unsafe extern "C" fn(env: sys::napi_env, data: *mut c_void)),
        Some(
          complete::<T>
            as unsafe extern "C" fn(
              env: sys::napi_env,
              status: sys::napi_status,
              data: *mut c_void,
            ),
        ),
        Box::leak(Box::new(result)) as *mut _ as *mut c_void,
        &mut async_work,
      )
    })?;
    check_status(unsafe { sys::napi_queue_async_work(env, async_work) })
  }
}

unsafe impl<T: Task> Send for AsyncWork<T> {}

unsafe impl<T: Task> Sync for AsyncWork<T> {}

unsafe extern "C" fn execute<T: Task>(_env: sys::napi_env, data: *mut c_void) {
  let mut work = Box::from_raw(data as *mut AsyncWork<T>);
  work.value = work
    .inner_task
    .compute()
    .map(|v| Box::into_raw(Box::from(v)));
  Box::leak(work);
}

unsafe extern "C" fn complete<T: Task>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) {
  let mut work = Box::from_raw(data as *mut AsyncWork<T>);
  let value_ptr = mem::replace(&mut work.value, Ok(ptr::null_mut()));
  let deferred = mem::replace(&mut work.deferred, ptr::null_mut());
  let value = value_ptr.and_then(move |v| {
    let mut env = Env::from_raw(env);
    let output = ptr::read(v as *const _);
    work.inner_task.resolve(&mut env, output)
  });
  let mut handle_scope = ptr::null_mut();
  match check_status(status).and_then(move |_| value) {
    Ok(v) => {
      let open_handle_status = sys::napi_open_handle_scope(env, &mut handle_scope);
      debug_assert!(
        open_handle_status == sys::napi_status::napi_ok,
        "OpenHandleScope failed"
      );
      let status = sys::napi_resolve_deferred(env, deferred, v.raw_value);
      debug_assert!(status == sys::napi_status::napi_ok, "Reject promise failed");
    }
    Err(e) => {
      let open_handle_status = sys::napi_open_handle_scope(env, &mut handle_scope);
      debug_assert!(
        open_handle_status == sys::napi_status::napi_ok,
        "OpenHandleScope failed"
      );
      let status = sys::napi_reject_deferred(env, deferred, e.into_raw(env));
      debug_assert!(status == sys::napi_status::napi_ok, "Reject promise failed");
    }
  };
  let close_handle_scope_status = sys::napi_close_handle_scope(env, handle_scope);
  debug_assert!(
    close_handle_scope_status == sys::napi_status::napi_ok,
    "Close handle scope failed"
  );
}
