use std::cell::Cell;
use std::ffi::c_void;
use std::ptr;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::{bindgen_prelude::*, check_status, TaggedObject};

thread_local! {
  #[doc(hidden)]
  /// Determined is `constructor` called from Class `factory`
  pub static ___CALL_FROM_FACTORY: AtomicBool = const { AtomicBool::new(false) };
}

#[doc(hidden)]
pub struct CallbackInfo<const N: usize> {
  env: sys::napi_env,
  pub this: sys::napi_value,
  pub args: [sys::napi_value; N],
  this_reference: sys::napi_ref,
}

impl<const N: usize> CallbackInfo<N> {
  #[allow(clippy::not_unsafe_ptr_arg_deref)]
  pub fn new(
    env: sys::napi_env,
    callback_info: sys::napi_callback_info,
    required_argc: Option<usize>,
    // for async class factory, the `this` will be used after the async call
    // so we must create reference for it and use it after async resolved
    use_after_async: bool,
  ) -> Result<Self> {
    let mut this = ptr::null_mut();
    let mut args = [ptr::null_mut(); N];
    let mut argc = N;

    unsafe {
      check_status!(
        sys::napi_get_cb_info(
          env,
          callback_info,
          &mut argc,
          args.as_mut_ptr(),
          &mut this,
          ptr::null_mut(),
        ),
        "Failed to initialize napi function call."
      )?;
    };

    if let Some(required_argc) = required_argc {
      if required_argc > argc {
        return Err(Error::new(
          Status::InvalidArg,
          format!(
            "{} arguments required by received {}.",
            required_argc, &argc
          ),
        ));
      }
    }

    let mut this_reference = ptr::null_mut();

    if use_after_async {
      check_status!(
        unsafe { sys::napi_create_reference(env, this, 1, &mut this_reference) },
        "Failed to create reference for `this` in async class factory"
      )?;
    }

    Ok(Self {
      env,
      this,
      args,
      this_reference,
    })
  }

  pub fn get_arg(&self, index: usize) -> sys::napi_value {
    self.args[index]
  }

  pub fn this(&self) -> sys::napi_value {
    self.this
  }

  fn _construct<const IsEmptyStructHint: bool, T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<(sys::napi_value, *mut T)> {
    let mut tagged_object = Box::new(TaggedObject::new(obj));
    let wrapped_value_ptr = &mut tagged_object.object as *mut T;
    let this = self.this();
    let tagged_object_ptr = Box::into_raw(tagged_object);
    let mut object_ref = ptr::null_mut();
    let initial_finalize: Box<dyn FnOnce()> = Box::new(|| {});
    let finalize_callbacks_ptr = Rc::into_raw(Rc::new(Cell::new(Box::into_raw(initial_finalize))));
    unsafe {
      check_status!(
        sys::napi_wrap(
          self.env,
          this,
          tagged_object_ptr.cast(),
          Some(raw_finalize_unchecked::<T>),
          ptr::null_mut(),
          &mut object_ref
        ),
        "Failed to initialize class `{js_name}`",
      )?;
    };

    Reference::<T>::add_ref(
      self.env,
      wrapped_value_ptr.cast(),
      (wrapped_value_ptr.cast(), object_ref, finalize_callbacks_ptr),
    );
    Ok((this, wrapped_value_ptr))
  }

  pub fn construct<const IsEmptyStructHint: bool, T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    self
      ._construct::<IsEmptyStructHint, T>(js_name, obj)
      .map(|(v, _)| v)
  }

  pub fn construct_generator<
    const IsEmptyStructHint: bool,
    T: Generator + ObjectFinalize + 'static,
  >(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._construct::<IsEmptyStructHint, T>(js_name, obj)?;
    unsafe { crate::__private::create_iterator(self.env, instance, generator_ptr) };
    Ok(instance)
  }

  pub fn factory<T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    self._factory(js_name, obj).map(|(value, _)| value)
  }

  pub fn generator_factory<T: ObjectFinalize + Generator + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<sys::napi_value> {
    let (instance, generator_ptr) = self._factory(js_name, obj)?;
    unsafe { crate::__private::create_iterator(self.env, instance, generator_ptr) };
    Ok(instance)
  }

  fn _factory<T: ObjectFinalize + 'static>(
    &self,
    js_name: &str,
    obj: T,
  ) -> Result<(sys::napi_value, *mut T)> {
    let mut this = self.this();
    let mut instance = ptr::null_mut();
    if !self.this_reference.is_null() {
      check_status!(
        unsafe { sys::napi_get_reference_value(self.env, self.this_reference, &mut this) },
        "Failed to get reference value for `this` in async class factory"
      )?;
      check_status!(
        unsafe { sys::napi_delete_reference(self.env, self.this_reference) },
        "Failed to delete reference for `this` in async class factory"
      )?;
    }
    ___CALL_FROM_FACTORY.with(|s| s.store(true, Ordering::Relaxed));
    let status =
      unsafe { sys::napi_new_instance(self.env, this, 0, ptr::null_mut(), &mut instance) };
    ___CALL_FROM_FACTORY.with(|s| s.store(false, Ordering::Relaxed));
    // Error thrown in `constructor`
    if status == sys::Status::napi_pending_exception {
      let mut exception = ptr::null_mut();
      unsafe { sys::napi_get_and_clear_last_exception(self.env, &mut exception) };
      unsafe { sys::napi_throw(self.env, exception) };
      return Ok((ptr::null_mut(), ptr::null_mut()));
    }
    check_status!(status, "Failed to create instance of class `{}`", js_name)?;
    let mut tagged_object = Box::new(TaggedObject::new(obj));
    let wrapped_value_ptr = &mut tagged_object.object as *mut T;
    let initial_finalize: Box<dyn FnOnce()> = Box::new(|| {});
    let finalize_callbacks_ptr = Rc::into_raw(Rc::new(Cell::new(Box::into_raw(initial_finalize))));
    let mut object_ref = ptr::null_mut();
    let tagged_object_ptr = Box::into_raw(tagged_object);

    check_status!(
      unsafe {
        sys::napi_wrap(
          self.env,
          instance,
          tagged_object_ptr.cast(),
          Some(raw_finalize_unchecked::<T>),
          ptr::null_mut(),
          &mut object_ref,
        )
      },
      "Failed to initialize class `{}`",
      js_name,
    )?;

    Reference::<T>::add_ref(
      self.env,
      wrapped_value_ptr.cast(),
      (wrapped_value_ptr.cast(), object_ref, finalize_callbacks_ptr),
    );
    Ok((instance, wrapped_value_ptr))
  }

  pub fn unwrap_borrow_mut<T>(&mut self) -> Result<&'static mut T>
  where
    T: FromNapiMutRef + TypeName,
  {
    unsafe { self.unwrap_raw::<T>() }.map(|raw| Box::leak(unsafe { Box::from_raw(raw) }))
  }

  pub fn unwrap_borrow<T>(&mut self) -> Result<&'static T>
  where
    T: FromNapiRef + TypeName,
  {
    unsafe { self.unwrap_raw::<T>() }
      .map(|raw| Box::leak(unsafe { Box::from_raw(raw) }) as &'static T)
  }

  #[doc(hidden)]
  #[inline]
  pub unsafe fn unwrap_raw<T>(&mut self) -> Result<*mut T>
  where
    T: TypeName,
  {
    let mut tagged_object_ptr: *mut c_void = std::ptr::null_mut();

    unsafe {
      check_status!(
        sys::napi_unwrap(self.env, self.this, &mut tagged_object_ptr),
        "Failed to unwrap exclusive reference of `{}` type from napi value",
        T::type_name(),
      )?;

      let tagged_object = &mut *(tagged_object_ptr as *mut TaggedObject<T>);
      Ok(&mut tagged_object.object as *mut T)
    }
  }
}
