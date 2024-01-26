use std::ptr;

use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};

pub use crate::JsFunction;
use crate::{check_pending_exception, check_status, sys, Env, NapiRaw, Result, ValueType};

impl ValidateNapiValue for JsFunction {}

pub trait JsValuesTupleIntoVec {
  fn into_vec(self, env: sys::napi_env) -> Result<Vec<sys::napi_value>>;
}

/// A JavaScript function.
/// It can only live in the scope of a function call.
/// If you want to use it outside the scope of a function call, you can turn it into a reference.
/// By calling the `create_ref` method.
pub struct Function<'scope, Args: JsValuesTupleIntoVec, Return: FromNapiValue> {
  pub(crate) env: sys::napi_env,
  pub(crate) value: sys::napi_value,
  pub(crate) _args: std::marker::PhantomData<Args>,
  pub(crate) _return: std::marker::PhantomData<Return>,
  _scope: std::marker::PhantomData<&'scope ()>,
}

impl<'scope, Args: JsValuesTupleIntoVec, Return: FromNapiValue> TypeName
  for Function<'scope, Args, Return>
{
  fn type_name() -> &'static str {
    "Function"
  }

  fn value_type() -> crate::ValueType {
    ValueType::Function
  }
}

impl<'scope, Args: JsValuesTupleIntoVec, Return: FromNapiValue> NapiRaw
  for Function<'scope, Args, Return>
{
  unsafe fn raw(&self) -> sys::napi_value {
    self.value
  }
}

impl<'scope, Args: JsValuesTupleIntoVec, Return: FromNapiValue> FromNapiValue
  for Function<'scope, Args, Return>
{
  unsafe fn from_napi_value(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    Ok(Function {
      env,
      value,
      _args: std::marker::PhantomData,
      _return: std::marker::PhantomData,
      _scope: std::marker::PhantomData,
    })
  }
}

impl<'scope, Args: JsValuesTupleIntoVec, Return: FromNapiValue> ValidateNapiValue
  for Function<'scope, Args, Return>
{
}

impl<'scope, Args: JsValuesTupleIntoVec, Return: FromNapiValue> Function<'scope, Args, Return> {
  /// Call the JavaScript function.
  /// `this` in the JavaScript function will be `undefined`.
  /// If you want to specify `this`, you can use the `apply` method.
  pub fn call(&self, args: Args) -> Result<Return> {
    let mut raw_this = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_undefined(self.env, &mut raw_this) },
      "Get undefined value failed"
    )?;
    let args_ptr = args.into_vec(self.env)?;
    let mut raw_return = ptr::null_mut();
    check_pending_exception!(
      self.env,
      unsafe {
        sys::napi_call_function(
          self.env,
          raw_this,
          self.value,
          args_ptr.len(),
          args_ptr.as_ptr(),
          &mut raw_return,
        )
      },
      "Call Function failed"
    )?;
    unsafe { Return::from_napi_value(self.env, raw_return) }
  }

  /// Call the JavaScript function.
  /// `this` in the JavaScript function will be the provided `this`.
  pub fn apply<Context: ToNapiValue>(&self, this: Context, args: Args) -> Result<Return> {
    let raw_this = unsafe { Context::to_napi_value(self.env, this) }?;
    let args_ptr = args.into_vec(self.env)?;
    let mut raw_return = ptr::null_mut();
    check_pending_exception!(
      self.env,
      unsafe {
        sys::napi_call_function(
          self.env,
          raw_this,
          self.value,
          args_ptr.len(),
          args_ptr.as_ptr(),
          &mut raw_return,
        )
      },
      "Call Function failed"
    )?;
    unsafe { Return::from_napi_value(self.env, raw_return) }
  }

  /// Create a reference to the JavaScript function.
  pub fn create_ref(&self) -> Result<FunctionRef<Args, Return>> {
    let mut reference = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(self.env, self.value, 1, &mut reference) },
      "Create reference failed"
    )?;
    Ok(FunctionRef {
      inner: reference,
      env: self.env,
      _args: std::marker::PhantomData,
      _return: std::marker::PhantomData,
    })
  }
}

/// A reference to a JavaScript function.
/// It can be used to outlive the scope of the function.
pub struct FunctionRef<Args: JsValuesTupleIntoVec, Return: FromNapiValue> {
  pub(crate) inner: sys::napi_ref,
  pub(crate) env: sys::napi_env,
  _args: std::marker::PhantomData<Args>,
  _return: std::marker::PhantomData<Return>,
}

unsafe impl<Args: JsValuesTupleIntoVec, Return: FromNapiValue> Sync for FunctionRef<Args, Return> {}

impl<Args: JsValuesTupleIntoVec, Return: FromNapiValue> FunctionRef<Args, Return> {
  pub fn borrow_back<'scope>(&self, env: &'scope Env) -> Result<Function<'scope, Args, Return>> {
    let mut value = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(env.0, self.inner, &mut value) },
      "Get reference value failed"
    )?;
    Ok(Function {
      env: env.0,
      value,
      _args: std::marker::PhantomData,
      _return: std::marker::PhantomData,
      _scope: std::marker::PhantomData,
    })
  }
}

impl<Args: JsValuesTupleIntoVec, Return: FromNapiValue> Drop for FunctionRef<Args, Return> {
  fn drop(&mut self) {
    let status = unsafe { sys::napi_delete_reference(self.env, self.inner) };
    debug_assert_eq!(status, sys::Status::napi_ok, "Drop FunctionRef failed");
  }
}

impl<Args: JsValuesTupleIntoVec, Return: FromNapiValue> TypeName for FunctionRef<Args, Return> {
  fn type_name() -> &'static str {
    "Function"
  }

  fn value_type() -> crate::ValueType {
    ValueType::Function
  }
}

impl<Args: JsValuesTupleIntoVec, Return: FromNapiValue> FromNapiValue
  for FunctionRef<Args, Return>
{
  unsafe fn from_napi_value(env: sys::napi_env, value: sys::napi_value) -> Result<Self> {
    let mut reference = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(env, value, 1, &mut reference) },
      "Create reference failed"
    )?;
    Ok(FunctionRef {
      inner: reference,
      env,
      _args: std::marker::PhantomData,
      _return: std::marker::PhantomData,
    })
  }
}

impl<Args: JsValuesTupleIntoVec, Return: FromNapiValue> ValidateNapiValue
  for FunctionRef<Args, Return>
{
}

macro_rules! impl_call_apply {
  ($fn_call_name:ident, $fn_apply_name:ident, $($ident:ident),*) => {
    #[allow(non_snake_case, clippy::too_many_arguments)]
    pub fn $fn_call_name<$($ident: ToNapiValue),*, Return: FromNapiValue>(
      &self,
      $($ident: $ident),*
    ) -> Result<Return> {
      let raw_this = unsafe { Env::from_raw(self.0.env) }
        .get_undefined()
        .map(|u| unsafe { u.raw() })?;

      let raw_args = vec![
        $(
          unsafe { $ident::to_napi_value(self.0.env, $ident) }?
        ),*
      ];

      let mut return_value = ptr::null_mut();
      check_pending_exception!(self.0.env, unsafe {
        sys::napi_call_function(
          self.0.env,
          raw_this,
          self.0.value,
          raw_args.len(),
          raw_args.as_ptr(),
          &mut return_value,
        )
      })?;

      unsafe { Return::from_napi_value(self.0.env, return_value) }
    }

    #[allow(non_snake_case, clippy::too_many_arguments)]
    pub fn $fn_apply_name<$($ident: ToNapiValue),*, Context: ToNapiValue, Return: FromNapiValue>(
      &self,
      this: Context,
      $($ident: $ident),*
    ) -> Result<Return> {
      let raw_this = unsafe { Context::to_napi_value(self.0.env, this) }?;

      let raw_args = vec![
        $(
          unsafe { $ident::to_napi_value(self.0.env, $ident) }?
        ),*
      ];

      let mut return_value = ptr::null_mut();
      check_pending_exception!(self.0.env, unsafe {
        sys::napi_call_function(
          self.0.env,
          raw_this,
          self.0.value,
          raw_args.len(),
          raw_args.as_ptr(),
          &mut return_value,
        )
      })?;

      unsafe { Return::from_napi_value(self.0.env, return_value) }
    }
  };
}

impl JsFunction {
  pub fn apply0<Return: FromNapiValue, Context: ToNapiValue>(
    &self,
    this: Context,
  ) -> Result<Return> {
    let raw_this = unsafe { Context::to_napi_value(self.0.env, this) }?;

    let mut return_value = ptr::null_mut();
    check_pending_exception!(self.0.env, unsafe {
      sys::napi_call_function(
        self.0.env,
        raw_this,
        self.0.value,
        0,
        ptr::null_mut(),
        &mut return_value,
      )
    })?;

    unsafe { Return::from_napi_value(self.0.env, return_value) }
  }

  pub fn call0<Return: FromNapiValue>(&self) -> Result<Return> {
    let raw_this = unsafe { Env::from_raw(self.0.env) }
      .get_undefined()
      .map(|u| unsafe { u.raw() })?;

    let mut return_value = ptr::null_mut();
    check_pending_exception!(self.0.env, unsafe {
      sys::napi_call_function(
        self.0.env,
        raw_this,
        self.0.value,
        0,
        ptr::null_mut(),
        &mut return_value,
      )
    })?;

    unsafe { Return::from_napi_value(self.0.env, return_value) }
  }

  impl_call_apply!(call1, apply1, Arg1);
  impl_call_apply!(call2, apply2, Arg1, Arg2);
  impl_call_apply!(call3, apply3, Arg1, Arg2, Arg3);
  impl_call_apply!(call4, apply4, Arg1, Arg2, Arg3, Arg4);
  impl_call_apply!(call5, apply5, Arg1, Arg2, Arg3, Arg4, Arg5);
  impl_call_apply!(call6, apply6, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6);
  impl_call_apply!(call7, apply7, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7);
  impl_call_apply!(call8, apply8, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7, Arg8);
  impl_call_apply!(call9, apply9, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7, Arg8, Arg9);
  impl_call_apply!(call10, apply10, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7, Arg8, Arg9, Arg10);
}
