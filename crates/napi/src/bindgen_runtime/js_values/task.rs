use std::cell::RefCell;
use std::ffi::c_void;
use std::marker::PhantomData;
use std::ptr;
use std::rc::Rc;
use std::{cell::Cell, panic::UnwindSafe};

use crate::{
  async_work,
  bindgen_prelude::{FromNapiValue, JsObjectValue, ToNapiValue, TypeName, Unknown},
  bindgen_runtime::{tag_object, type_tag_from_ident, validate_type_tag},
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

type AbortCallback = Rc<RefCell<Vec<Box<dyn Fn()>>>>;

/// <https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController>
pub struct AbortSignal {
  raw_work: Rc<Cell<sys::napi_async_work>>,
  status: Rc<Cell<u8>>,
  abort: AbortCallback,
}

impl AbortSignal {
  pub fn on_abort<F: Fn() + 'static>(&self, cb: F) {
    self.abort.borrow_mut().push(Box::new(cb));
  }
}

impl UnwindSafe for AbortSignal {}
impl std::panic::RefUnwindSafe for AbortSignal {}

#[repr(transparent)]
struct AbortSignalStack(Vec<AbortSignal>);

/// Unforgeable identity stamped on objects wrapped by
/// `AbortSignal::from_napi_value`, so a later conversion (or an `onabort`
/// invocation) can tell a genuine AbortSignal stack apart from an arbitrary
/// wrapped object — e.g. a `#[napi]` class instance, whose wrap payload is a
/// bare `*mut T` and must never be cast to `AbortSignalStack`
/// (GHSA-qr54-xrr9-7575). Like the class type tags, stamping and checking are
/// no-ops on builds without `napi8` and on wasm.
const ABORT_SIGNAL_TAG: sys::napi_type_tag = type_tag_from_ident(concat!(
  "napi@",
  env!("CARGO_PKG_VERSION"),
  "::bindgen_runtime::AbortSignal"
));

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
    let abort_cbs = Rc::new(RefCell::new(vec![]));
    let abort_signal = AbortSignal {
      raw_work: async_work_inner.clone(),
      status: task_status.clone(),
      abort: abort_cbs.clone(),
    };
    let js_env = Env::from_raw(env);

    let mut stack;
    let mut maybe_stack = ptr::null_mut();

    // Distinguish a genuine signal object (unwrapped, or wrapped by a previous
    // AbortSignal conversion) from an object wrapped by something else — e.g. a
    // `#[napi]` class instance, whose payload is a bare `*mut T`. Casting the
    // latter to `AbortSignalStack` is a type confusion, so reject it before
    // touching the wrap. No-op on builds without `napi8` and on wasm.
    #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
    let needs_tag = {
      let mut has_our_tag = false;
      check_status!(
        unsafe {
          sys::napi_check_object_type_tag(env, signal.0.value, &ABORT_SIGNAL_TAG, &mut has_our_tag)
        },
        "AbortSignal type tag check failed"
      )?;
      let mut existing_wrap = ptr::null_mut();
      let is_wrapped = unsafe { sys::napi_unwrap(env, signal.0.value, &mut existing_wrap) }
        == sys::Status::napi_ok;
      if is_wrapped && !has_our_tag {
        return Err(Error::new(
          crate::Status::InvalidArg,
          "Value is not an AbortSignal".to_owned(),
        ));
      }
      !has_our_tag
    };
    #[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
    let needs_tag = false;

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
    // The tag survives `napi_remove_wrap`, so only stamp it when this
    // conversion created the wrap (stamping an already-tagged object fails).
    if needs_tag {
      unsafe { tag_object(env, signal.0.value, &ABORT_SIGNAL_TAG) }?;
    }
    signal.set_named_property(
      "onabort",
      js_env.create_function::<(), Unknown>("onabort", on_abort)?,
    )?;

    Ok(AbortSignal {
      raw_work: async_work_inner,
      status: task_status,
      abort: abort_cbs,
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
    // `onabort` is an ordinary extractable function value: it can be stolen
    // and called with an arbitrary receiver. Verify the receiver really wraps
    // an AbortSignalStack before casting its payload. No-op without `napi8`.
    validate_type_tag(env, this, &ABORT_SIGNAL_TAG, "AbortSignal")?;
    let mut async_task = ptr::null_mut();
    check_status!(
      sys::napi_unwrap(env, this, &mut async_task),
      "Unwrap async_task from AbortSignal failed"
    )?;
    let abort_controller_stack = Box::leak(Box::from_raw(async_task as *mut AbortSignalStack));
    for abort_controller in abort_controller_stack.0.iter() {
      // call abort callback
      for cb in abort_controller.abort.borrow().iter() {
        cb();
      }

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
