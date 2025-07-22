use std::ffi::c_void;
use std::marker::PhantomData;
use std::ptr;
use std::rc::Rc;
use std::{cell::Cell, panic::UnwindSafe};

use crate::{
  async_work,
  bindgen_prelude::{FromNapiValue, JsObjectValue, ToNapiValue, TypeName, Unknown},
  check_status, sys, Env, Error, JsError, ScopedTask, Value, ValueType,
};

use super::Object;

pub struct AsyncTask<T: for<'task> ScopedTask<'task>> {
  inner: T,
  abort_signal: Option<AbortSignal>,
}

impl<T: for<'task> ScopedTask<'task>> TypeName for T {
  fn type_name() -> &'static str {
    "AsyncTask"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::Object
  }
}

impl<T: for<'task> ScopedTask<'task>> AsyncTask<T> {
  pub fn new(task: T) -> Self {
    Self {
      inner: task,
      abort_signal: None,
    }
  }

  pub fn with_signal(task: T, signal: AbortSignal) -> Self {
    Self {
      inner: task,
      abort_signal: Some(signal),
    }
  }

  pub fn with_optional_signal(task: T, signal: Option<AbortSignal>) -> Self {
    Self {
      inner: task,
      abort_signal: signal,
    }
  }
}

/// <https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController>
pub struct AbortSignal {
  raw_work: Rc<Cell<sys::napi_async_work>>,
  status: Rc<Cell<u8>>,
}

impl UnwindSafe for AbortSignal {}
impl std::panic::RefUnwindSafe for AbortSignal {}

#[repr(transparent)]
struct AbortSignalStack(Vec<AbortSignal>);

impl FromNapiValue for AbortSignal {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut signal = Object(
      Value {
        env,
        value: napi_val,
        value_type: ValueType::Object,
      },
      PhantomData,
    );
    let async_work_inner: Rc<Cell<sys::napi_async_work>> = Rc::new(Cell::new(ptr::null_mut()));
    let task_status = Rc::new(Cell::new(0));
    let abort_signal = AbortSignal {
      raw_work: async_work_inner.clone(),
      status: task_status.clone(),
    };
    let js_env = Env::from_raw(env);

    let mut stack;
    let mut maybe_stack = ptr::null_mut();
    let unwrap_status = unsafe { sys::napi_remove_wrap(env, signal.0.value, &mut maybe_stack) };
    if unwrap_status == sys::Status::napi_ok {
      stack = unsafe { Box::from_raw(maybe_stack as *mut AbortSignalStack) };
      stack.0.push(abort_signal);
    } else {
      stack = Box::new(AbortSignalStack(vec![abort_signal]));
    }
    let mut signal_ref = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_wrap(
          env,
          signal.0.value,
          Box::into_raw(stack).cast(),
          Some(async_task_abort_controller_finalize),
          ptr::null_mut(),
          &mut signal_ref,
        )
      },
      "Wrap AbortSignal failed"
    )?;
    signal.set_named_property(
      "onabort",
      js_env.create_function::<(), Unknown>("onabort", on_abort)?,
    )?;

    Ok(AbortSignal {
      raw_work: async_work_inner,
      status: task_status,
    })
  }
}

extern "C" fn on_abort(
  env: sys::napi_env,
  callback_info: sys::napi_callback_info,
) -> sys::napi_value {
  match on_abort_impl(env, callback_info) {
    Err(err) => {
      let js_err = JsError::from(err);
      unsafe { js_err.throw_into(env) };
      ptr::null_mut()
    }
    Ok(undefined) => undefined,
  }
}

fn on_abort_impl(
  env: sys::napi_env,
  callback_info: sys::napi_callback_info,
) -> Result<sys::napi_value, Error> {
  let mut this = ptr::null_mut();
  unsafe {
    check_status!(
      sys::napi_get_cb_info(
        env,
        callback_info,
        &mut 0,
        ptr::null_mut(),
        &mut this,
        ptr::null_mut(),
      ),
      "Get callback info in AbortController abort callback failed"
    )?;
    let mut async_task = ptr::null_mut();
    check_status!(
      sys::napi_unwrap(env, this, &mut async_task),
      "Unwrap async_task from AbortSignal failed"
    )?;
    let abort_controller_stack = Box::leak(Box::from_raw(async_task as *mut AbortSignalStack));
    for abort_controller in abort_controller_stack.0.iter() {
      // Task Completed, return now
      if abort_controller.status.get() == 1 {
        return Ok(ptr::null_mut());
      }
      let raw_async_work = abort_controller.raw_work.get();
      let status = sys::napi_cancel_async_work(env, raw_async_work);
      // async work is already started, so we can't cancel it
      if status != sys::Status::napi_ok {
        abort_controller.status.set(0);
      } else {
        // abort function must be called from JavaScript main thread, so Relaxed Ordering is ok.
        abort_controller.status.set(2);
      }
    }
    let mut undefined = ptr::null_mut();
    check_status!(
      sys::napi_get_undefined(env, &mut undefined),
      "Get undefined in AbortSignal::on_abort callback failed"
    )?;
    Ok(undefined)
  }
}

impl<T: for<'task> ScopedTask<'task>> ToNapiValue for AsyncTask<T> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    if let Some(abort_signal) = val.abort_signal {
      let async_promise = async_work::run(env, val.inner, Some(abort_signal.status.clone()))?;
      abort_signal.raw_work.set(async_promise.napi_async_work);
      Ok(async_promise.promise_object().inner)
    } else {
      let async_promise = async_work::run(env, val.inner, None)?;
      Ok(async_promise.promise_object().inner)
    }
  }
}

unsafe extern "C" fn async_task_abort_controller_finalize(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  drop(unsafe { Box::from_raw(finalize_data as *mut AbortSignalStack) });
}
