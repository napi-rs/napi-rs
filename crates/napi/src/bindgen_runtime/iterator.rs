use std::ffi::{c_void, CStr};
use std::panic::AssertUnwindSafe;
use std::ptr;

use crate::Value;
use crate::{
  bindgen_runtime::{acquire_native_borrow, Unknown},
  check_status, sys, Env, JsError,
};

use super::{FromNapiValue, ToNapiValue};

const GENERATOR_STATE_KEY: &CStr = c"[[GeneratorState]]";
const INSTANCE_REF_KEY: &CStr = c"[[InstanceRef]]";
const ITERATOR_PROPERTY_ATTRIBUTES: sys::napi_property_attributes =
  sys::PropertyAttributes::writable
    | sys::PropertyAttributes::enumerable
    | sys::PropertyAttributes::configurable;

struct IteratorCallbackData {
  env: sys::napi_env,
  owner_ref: sys::napi_ref,
  generator_ptr: *mut c_void,
}

impl IteratorCallbackData {
  fn owner_and_generator<T>(
    &self,
    env: sys::napi_env,
    receiver: sys::napi_value,
  ) -> crate::Result<*mut T> {
    let mut owner = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(env, self.owner_ref, &mut owner) },
      "Failed to get iterator callback owner"
    )?;
    if owner.is_null() {
      return Err(crate::Error::from_reason(
        "Iterator callback owner was already collected",
      ));
    }

    let mut is_owner = false;
    check_status!(
      unsafe { sys::napi_strict_equals(env, owner, receiver, &mut is_owner) },
      "Failed to validate iterator callback owner"
    )?;
    if !is_owner {
      return Err(crate::Error::new(
        crate::Status::InvalidArg,
        "Generator method called with an incompatible receiver",
      ));
    }

    let mut generator_ptr = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_unwrap(env, owner, &mut generator_ptr) },
      "Invalid generator owner"
    )?;
    if generator_ptr.is_null() || generator_ptr != self.generator_ptr {
      return Err(crate::Error::new(
        crate::Status::InvalidArg,
        "Generator owner no longer contains its original native generator",
      ));
    }

    Ok(self.generator_ptr.cast())
  }
}

impl Drop for IteratorCallbackData {
  fn drop(&mut self) {
    if !self.owner_ref.is_null() {
      unsafe {
        sys::napi_delete_reference(self.env, self.owner_ref);
      }
    }
  }
}

struct GeneratorState {
  completed: bool,
}

/// Implement a Iterator for the JavaScript Class.
/// This feature is an experimental feature and is not yet stable.
pub trait Generator {
  type Yield: ToNapiValue;
  type Next: FromNapiValue;
  type Return: FromNapiValue + ToNapiValue;

  /// Handle `Generator.next()`.
  ///
  /// Returning `Some(value)` yields `value` and keeps the iterator open. Returning `None` or
  /// panicking completes it.
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/next>
  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield>;

  /// Handle `Generator.return()`.
  ///
  /// The hook runs only for the first successful terminal request. Its returned value becomes the
  /// `value` in the `{ value, done: true }` result. A rejected argument conversion leaves the
  /// iterator open and does not invoke this hook.
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/return>
  fn complete(&mut self, value: Option<Self::Return>) -> Option<Self::Return> {
    value
  }

  #[allow(unused_variables)]
  /// Handle `Generator.throw()`.
  ///
  /// Returning `Ok(Some(value))` yields `value` and keeps the iterator open. Returning `Ok(None)`,
  /// an error, or a panic completes it. The default throws the exact JavaScript value supplied to
  /// `throw()`.
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/throw>
  fn catch<'env>(
    &'env mut self,
    env: Env,
    value: Unknown<'env>,
  ) -> Result<Option<Self::Yield>, Unknown<'env>> {
    Err(value)
  }
}

impl<'env, T: Generator + 'env> ScopedGenerator<'env> for T {
  type Yield = T::Yield;
  type Next = T::Next;
  type Return = T::Return;

  fn next(&mut self, _: &'env Env, value: Option<Self::Next>) -> Option<Self::Yield> {
    T::next(self, value)
  }

  fn complete(&mut self, value: Option<Self::Return>) -> Option<Self::Return> {
    T::complete(self, value)
  }

  fn catch(
    &'env mut self,
    env: &'env Env,
    value: Unknown<'env>,
  ) -> Result<Option<Self::Yield>, Unknown<'env>> {
    T::catch(self, Env::from_raw(env.0), value)
  }
}

pub trait ScopedGenerator<'env> {
  type Yield: ToNapiValue + 'env;
  type Next: FromNapiValue;
  type Return: FromNapiValue + ToNapiValue + 'env;

  /// Handle `Generator.next()`.
  ///
  /// Returning `Some(value)` yields `value` and keeps the iterator open. Returning `None` or
  /// panicking completes it.
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/next>
  fn next(&mut self, env: &'env Env, value: Option<Self::Next>) -> Option<Self::Yield>;

  /// Handle `Generator.return()`.
  ///
  /// The hook runs only for the first successful terminal request. Its returned value becomes the
  /// `value` in the `{ value, done: true }` result. A rejected argument conversion leaves the
  /// iterator open and does not invoke this hook.
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/return>
  fn complete(&mut self, value: Option<Self::Return>) -> Option<Self::Return> {
    value
  }

  #[allow(unused_variables)]
  /// Handle `Generator.throw()`.
  ///
  /// Returning `Ok(Some(value))` yields `value` and keeps the iterator open. Returning `Ok(None)`,
  /// an error, or a panic completes it. The default throws the exact JavaScript value supplied to
  /// `throw()`.
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/throw>
  fn catch(
    &'env mut self,
    env: &'env Env,
    value: Unknown<'env>,
  ) -> Result<Option<Self::Yield>, Unknown<'env>> {
    Err(value)
  }
}

#[doc(hidden)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub unsafe fn setup_iterator_class(
  env: sys::napi_env,
  class_ctor: sys::napi_value,
) -> crate::Result<()> {
  catch_generator_callback(|| unsafe { setup_iterator_class_impl(env, class_ctor) })
}

unsafe fn setup_iterator_class_impl(
  env: sys::napi_env,
  class_ctor: sys::napi_value,
) -> crate::Result<()> {
  let mut global = ptr::null_mut();
  check_status!(
    sys::napi_get_global(env, &mut global),
    "Get global object failed",
  )?;

  let mut iterator_ctor = ptr::null_mut();
  check_status!(
    sys::napi_get_named_property(env, global, c"Iterator".as_ptr().cast(), &mut iterator_ctor,),
    "Get Global.Iterator failed",
  )?;

  let mut iterator_ctor_type = 0;
  check_status!(
    sys::napi_typeof(env, iterator_ctor, &mut iterator_ctor_type),
    "Get Global.Iterator type failed",
  )?;

  if iterator_ctor_type != sys::ValueType::napi_function {
    return Ok(());
  }

  let mut class_proto = ptr::null_mut();
  check_status!(
    sys::napi_get_named_property(
      env,
      class_ctor,
      c"prototype".as_ptr().cast(),
      &mut class_proto,
    ),
    "Failed to get class prototype",
  )?;

  let mut iterator_proto = ptr::null_mut();
  check_status!(
    sys::napi_get_named_property(
      env,
      iterator_ctor,
      c"prototype".as_ptr().cast(),
      &mut iterator_proto,
    ),
    "Failed to get Iterator.prototype",
  )?;

  let mut class_proto_parent = ptr::null_mut();
  check_status!(
    sys::napi_get_prototype(env, class_proto, &mut class_proto_parent),
    "Failed to get class prototype parent",
  )?;

  let mut already_inherits_iterator = false;
  check_status!(
    sys::napi_strict_equals(
      env,
      class_proto_parent,
      iterator_proto,
      &mut already_inherits_iterator,
    ),
    "Failed to compare class prototype parent",
  )?;

  if already_inherits_iterator {
    return Ok(());
  }

  let mut object_ctor = ptr::null_mut();
  check_status!(
    sys::napi_get_named_property(env, global, c"Object".as_ptr().cast(), &mut object_ctor),
    "Failed to get Object constructor"
  )?;

  let mut set_prototype_function = ptr::null_mut();
  check_status!(
    sys::napi_get_named_property(
      env,
      object_ctor,
      c"setPrototypeOf".as_ptr().cast(),
      &mut set_prototype_function,
    ),
    "Failed to get Object.setPrototypeOf"
  )?;

  let mut argv = [class_proto, iterator_proto];
  check_status!(
    sys::napi_call_function(
      env,
      object_ctor,
      set_prototype_function,
      2,
      argv.as_mut_ptr(),
      ptr::null_mut(),
    ),
    "Failed to set prototype on object"
  )?;
  Ok(())
}

#[doc(hidden)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub unsafe fn create_iterator<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  instance: sys::napi_value,
  generator_ptr: *mut T,
) {
  if let Err(error) = unsafe { try_create_iterator(env, instance, generator_ptr) } {
    throw_generator_callback_error(env, error);
  }
}

#[doc(hidden)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub unsafe fn try_create_iterator<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  instance: sys::napi_value,
  generator_ptr: *mut T,
) -> crate::Result<()> {
  catch_generator_callback(|| unsafe { create_iterator_impl(env, instance, generator_ptr) })
}

unsafe extern "C" fn finalize_iterator_callback(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    crate::bindgen_runtime::catch_unwind_safely(|| unsafe {
      if !finalize_data.is_null() {
        drop(Box::from_raw(finalize_data.cast::<IteratorCallbackData>()));
      }
    });
  });
}

fn define_instance_ref(
  env: sys::napi_env,
  target: sys::napi_value,
  instance: sys::napi_value,
) -> crate::Result<()> {
  let properties = [sys::napi_property_descriptor {
    utf8name: INSTANCE_REF_KEY.as_ptr().cast(),
    name: ptr::null_mut(),
    method: None,
    getter: None,
    setter: None,
    value: instance,
    attributes: sys::PropertyAttributes::default,
    data: ptr::null_mut(),
  }];

  check_status!(
    unsafe { sys::napi_define_properties(env, target, properties.len(), properties.as_ptr()) },
    "Failed to retain iterator callback owner"
  )
}

fn create_iterator_callback(
  env: sys::napi_env,
  owner: sys::napi_value,
  generator_ptr: *mut c_void,
  name: &CStr,
  callback: sys::napi_callback,
) -> crate::Result<sys::napi_value> {
  // The hidden JS property retains `owner`; this reference stays weak so the
  // owner -> callback -> owner cycle remains visible and collectible by GC.
  let mut owner_ref = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_reference(env, owner, 0, &mut owner_ref) },
    "Failed to create iterator callback owner reference"
  )?;

  let mut callback_data = Box::new(IteratorCallbackData {
    env,
    owner_ref,
    generator_ptr,
  });
  let callback_data_ptr = callback_data.as_mut() as *mut IteratorCallbackData;
  let mut function = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_function(
        env,
        name.as_ptr(),
        name.to_bytes().len() as isize,
        callback,
        callback_data_ptr.cast(),
        &mut function,
      )
    },
    "Failed to create iterator callback"
  )?;

  define_instance_ref(env, function, owner)?;
  check_status!(
    unsafe {
      sys::napi_wrap(
        env,
        function,
        callback_data_ptr.cast(),
        Some(finalize_iterator_callback),
        ptr::null_mut(),
        ptr::null_mut(),
      )
    },
    "Failed to attach iterator callback data"
  )?;

  let _ = Box::into_raw(callback_data);
  Ok(function)
}

unsafe fn create_iterator_impl<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  instance: sys::napi_value,
  generator_ptr: *mut T,
) -> crate::Result<()> {
  let mut global = ptr::null_mut();
  check_status!(
    sys::napi_get_global(env, &mut global),
    "Get global object failed",
  )?;

  let mut symbol_object = ptr::null_mut();
  check_status!(
    sys::napi_get_named_property(env, global, c"Symbol".as_ptr().cast(), &mut symbol_object),
    "Get global object failed",
  )?;

  let mut iterator_symbol = ptr::null_mut();
  check_status!(
    sys::napi_get_named_property(
      env,
      symbol_object,
      c"iterator".as_ptr().cast(),
      &mut iterator_symbol,
    ),
    "Get Symbol.iterator failed",
  )?;

  let next_function = create_iterator_callback(
    env,
    instance,
    generator_ptr.cast(),
    c"next",
    Some(generator_next::<T>),
  )?;
  let return_function = create_iterator_callback(
    env,
    instance,
    generator_ptr.cast(),
    c"return",
    Some(generator_return::<T>),
  )?;
  let throw_function = create_iterator_callback(
    env,
    instance,
    generator_ptr.cast(),
    c"throw",
    Some(generator_throw::<T>),
  )?;

  let method_properties = [
    sys::napi_property_descriptor {
      utf8name: c"next".as_ptr().cast(),
      name: ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: next_function,
      attributes: ITERATOR_PROPERTY_ATTRIBUTES,
      data: ptr::null_mut(),
    },
    sys::napi_property_descriptor {
      utf8name: c"return".as_ptr().cast(),
      name: ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: return_function,
      attributes: ITERATOR_PROPERTY_ATTRIBUTES,
      data: ptr::null_mut(),
    },
    sys::napi_property_descriptor {
      utf8name: c"throw".as_ptr().cast(),
      name: ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: throw_function,
      attributes: ITERATOR_PROPERTY_ATTRIBUTES,
      data: ptr::null_mut(),
    },
  ];
  check_status!(
    sys::napi_define_properties(
      env,
      instance,
      method_properties.len(),
      method_properties.as_ptr(),
    ),
    "Failed to define methods on Generator object"
  )?;

  let generator_state = Box::into_raw(Box::new(GeneratorState { completed: false }));
  let mut generator_state_value = ptr::null_mut();
  let status = sys::napi_create_external(
    env,
    generator_state.cast(),
    Some(finalize_generator_state),
    ptr::null_mut(),
    &mut generator_state_value,
  );
  if status != sys::Status::napi_ok {
    drop(Box::from_raw(generator_state));
  }
  check_status!(status, "Create generator state failed")?;

  let properties = [sys::napi_property_descriptor {
    utf8name: GENERATOR_STATE_KEY.as_ptr().cast(),
    name: ptr::null_mut(),
    method: None,
    getter: None,
    setter: None,
    value: generator_state_value,
    attributes: sys::PropertyAttributes::default,
    data: ptr::null_mut(),
  }];

  check_status!(
    sys::napi_define_properties(env, instance, 1, properties.as_ptr()),
    "Define properties on Generator object failed"
  )?;

  let mut generator_function = ptr::null_mut();
  check_status!(
    sys::napi_create_function(
      env,
      c"Iterator".as_ptr().cast(),
      8,
      Some(symbol_generator::<T>),
      ptr::null_mut(),
      &mut generator_function,
    ),
    "Create iterator function failed",
  )?;

  check_status!(
    {
      let properties = [sys::napi_property_descriptor {
        utf8name: ptr::null(),
        name: iterator_symbol,
        method: None,
        getter: None,
        setter: None,
        value: generator_function,
        attributes: ITERATOR_PROPERTY_ATTRIBUTES,
        data: ptr::null_mut(),
      }];
      sys::napi_define_properties(env, instance, properties.len(), properties.as_ptr())
    },
    "Failed to define Symbol.iterator on class instance",
  )?;
  Ok(())
}

unsafe extern "C" fn finalize_generator_state(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      if !finalize_data.is_null() {
        drop(unsafe { Box::from_raw(finalize_data.cast::<GeneratorState>()) });
      }
    });
  });
}

#[doc(hidden)]
pub unsafe extern "C" fn symbol_generator<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let _ = std::marker::PhantomData::<T>;
  generator_callback(env, || unsafe { symbol_generator_impl(env, info) })
}

unsafe fn symbol_generator_impl(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut this = ptr::null_mut();
  let mut argc = 0;
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        ptr::null_mut(),
        &mut this,
        ptr::null_mut(),
      )
    },
    "Get callback info from generator function failed"
  )?;

  Ok(this)
}

fn generator_callback(
  env: sys::napi_env,
  callback: impl FnOnce() -> crate::Result<sys::napi_value>,
) -> sys::napi_value {
  match catch_generator_callback(callback) {
    Ok(value) => value,
    Err(error) => {
      throw_generator_callback_error(env, error);
      ptr::null_mut()
    }
  }
}

fn catch_generator_callback<T>(callback: impl FnOnce() -> crate::Result<T>) -> crate::Result<T> {
  std::panic::catch_unwind(AssertUnwindSafe(callback))
    .map_err(crate::bindgen_runtime::panic_to_error)?
}

fn throw_generator_callback_error(env: sys::napi_env, error: crate::Error) {
  let mut is_pending = false;
  if unsafe { sys::napi_is_exception_pending(env, &mut is_pending) } != sys::Status::napi_ok
    || !is_pending
  {
    unsafe { JsError::from(error).throw_into(env) };
  }
}

extern "C" fn generator_next<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  generator_callback(env, || generator_next_impl::<T>(env, info))
}

fn generator_next_impl<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut generator_ptr = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        &mut this,
        &mut generator_ptr,
      )
    },
    "Get callback info from generator function failed"
  )?;
  let generator_ptr = validate_generator_receiver::<T>(env, this, generator_ptr)?;
  let mut completed = get_generator_completed(env, this)?;
  let mut result = std::ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_object(env, &mut result) },
    "Failed to create iterator result object",
  )?;
  if !completed {
    let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
    let g = unsafe { &mut *generator_ptr };
    let value = if argc == 0 {
      None
    } else {
      Some(unsafe { T::Next::from_napi_value(env, argv[0]) }?)
    };
    let item = match catch_generator_callback(|| {
      Ok(g.next(
        // SAFETY: `Env` is long lived
        unsafe { std::mem::transmute::<&Env, &'a Env>(&Env::from_raw(env)) },
        value,
      ))
    }) {
      Ok(item) => item,
      Err(error) => {
        set_generator_completed(env, this, true)?;
        return Err(error);
      }
    };

    if let Some(value) = item {
      set_generator_value(env, result, value)?;
    } else {
      completed = true;
      set_generator_completed(env, this, true)?;
      set_generator_value(env, result, ())?;
    }
  } else {
    set_generator_value(env, result, ())?;
  }
  let mut completed_value = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_boolean(env, completed, &mut completed_value) },
    "Failed to create completed value"
  )?;
  define_iterator_result_property(env, result, c"done", completed_value)?;

  Ok(result)
}

extern "C" fn generator_return<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  generator_callback(env, || generator_return_impl::<T>(env, info))
}

fn generator_return_impl<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut generator_ptr = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        &mut this,
        &mut generator_ptr,
      )
    },
    "Get callback info from generator function failed"
  )?;

  let generator_ptr = validate_generator_receiver::<T>(env, this, generator_ptr)?;
  let completed = get_generator_completed(env, this)?;
  let _native_borrow = (!completed)
    .then(|| acquire_native_borrow(generator_ptr, true))
    .transpose()?;
  let value = if argc == 0 {
    None
  } else {
    Some(unsafe { T::Return::from_napi_value(env, argv[0]) }?)
  };
  let return_value = if completed {
    value
  } else {
    set_generator_completed(env, this, true)?;
    let g = unsafe { &mut *generator_ptr };
    catch_generator_callback(|| Ok(g.complete(value)))?
  };

  let mut result = std::ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_object(env, &mut result) },
    "Failed to create iterator result object",
  )?;
  if let Some(value) = return_value {
    set_generator_value(env, result, value)?;
  } else {
    set_generator_value(env, result, ())?;
  }
  let mut done = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_boolean(env, true, &mut done) },
    "Failed to create completed value"
  )?;
  define_iterator_result_property(env, result, c"done", done)?;

  Ok(result)
}

extern "C" fn generator_throw<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  generator_callback(env, || generator_throw_impl::<T>(env, info))
}

fn generator_throw_impl<'a, T: ScopedGenerator<'a> + 'a>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut generator_ptr = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        &mut this,
        &mut generator_ptr,
      )
    },
    "Get callback info from generator function failed"
  )?;
  let generator_ptr = validate_generator_receiver::<T>(env, this, generator_ptr)?;

  let value = if argc == 0 {
    let mut undefined = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_undefined(env, &mut undefined) },
      "Get undefined failed"
    )?;
    Unknown(
      Value {
        env,
        value: undefined,
        value_type: crate::ValueType::Undefined,
      },
      std::marker::PhantomData,
    )
  } else {
    Unknown(
      Value {
        env,
        value: argv[0],
        value_type: crate::ValueType::Unknown,
      },
      std::marker::PhantomData,
    )
  };

  if get_generator_completed(env, this)? {
    check_status!(
      unsafe { sys::napi_throw(env, value.0.value) },
      "Failed to throw value"
    )?;
    return Ok(ptr::null_mut());
  }

  let _native_borrow = acquire_native_borrow(generator_ptr, true)?;
  let g = unsafe { &mut *generator_ptr };
  let catch_result = match catch_generator_callback(|| {
    Ok(g.catch(
      // SAFETY: `Env` is long lived
      unsafe { std::mem::transmute::<&Env, &'a Env>(&Env::from_raw(env)) },
      value,
    ))
  }) {
    Ok(result) => result,
    Err(error) => {
      set_generator_completed(env, this, true)?;
      return Err(error);
    }
  };

  let mut result = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_object(env, &mut result) },
    "Failed to create iterator result object",
  )?;
  let completed = match catch_result {
    Err(error) => {
      set_generator_completed(env, this, true)?;
      check_status!(
        unsafe { sys::napi_throw(env, error.0.value) },
        "Failed to throw generator value"
      )?;
      return Ok(ptr::null_mut());
    }
    Ok(Some(value)) => {
      set_generator_value(env, result, value)?;
      false
    }
    Ok(None) => {
      set_generator_completed(env, this, true)?;
      set_generator_value(env, result, ())?;
      true
    }
  };
  let mut completed_value = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_boolean(env, completed, &mut completed_value) },
    "Failed to create completed value"
  )?;
  define_iterator_result_property(env, result, c"done", completed_value)?;

  Ok(result)
}

fn validate_generator_receiver<T>(
  env: sys::napi_env,
  this: sys::napi_value,
  callback_data: *mut c_void,
) -> crate::Result<*mut T> {
  let callback_data = unsafe { callback_data.cast::<IteratorCallbackData>().as_ref() }
    .ok_or_else(|| crate::Error::from_reason("Generator callback data was null"))?;
  callback_data.owner_and_generator(env, this)
}

fn get_generator_completed(env: sys::napi_env, this: sys::napi_value) -> crate::Result<bool> {
  let generator_state = get_generator_state(env, this)?;
  Ok(unsafe { (*generator_state).completed })
}

fn get_generator_state(
  env: sys::napi_env,
  this: sys::napi_value,
) -> crate::Result<*mut GeneratorState> {
  let mut generator_state_value = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_named_property(
        env,
        this,
        GENERATOR_STATE_KEY.as_ptr().cast(),
        &mut generator_state_value,
      )
    },
    "Get generator state failed"
  )?;
  let mut generator_state = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_value_external(env, generator_state_value, &mut generator_state) },
    "Get generator state failed"
  )?;
  if generator_state.is_null() {
    return Err(crate::Error::new(
      crate::Status::InvalidArg,
      "Generator state was null",
    ));
  }
  Ok(generator_state.cast())
}

fn set_generator_completed(
  env: sys::napi_env,
  this: sys::napi_value,
  completed: bool,
) -> crate::Result<()> {
  let generator_state = get_generator_state(env, this)?;
  unsafe { (*generator_state).completed = completed };
  Ok(())
}

fn define_iterator_result_property(
  env: sys::napi_env,
  result: sys::napi_value,
  name: &CStr,
  value: sys::napi_value,
) -> crate::Result<()> {
  let properties = [sys::napi_property_descriptor {
    utf8name: name.as_ptr().cast(),
    name: ptr::null_mut(),
    method: None,
    getter: None,
    setter: None,
    value,
    attributes: ITERATOR_PROPERTY_ATTRIBUTES,
    data: ptr::null_mut(),
  }];
  check_status!(
    unsafe { sys::napi_define_properties(env, result, properties.len(), properties.as_ptr()) },
    "Failed to define iterator result property"
  )
}

fn set_generator_value<V: ToNapiValue>(
  env: sys::napi_env,
  result: sys::napi_value,
  value: V,
) -> crate::Result<()> {
  let value = unsafe { ToNapiValue::to_napi_value(env, value) }?;
  define_iterator_result_property(env, result, c"value", value)
}
