#![allow(deprecated)]

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use std::cell::RefCell;

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use napi::{
  bindgen_prelude::*, JsBoolean, JsObject, JsString, JsStringLatin1, JsStringUtf16, JsStringUtf8,
  JsSymbol, NapiValue, SymbolRef, UnknownRef,
};

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use crate::class::Animal;

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
thread_local! {
  static LIFECYCLE_STASHED_VALUE: RefCell<Option<Unknown<'static>>> = const { RefCell::new(None) };
  static LIFECYCLE_STASHED_BUFFER_SLICE_REF: RefCell<Option<BufferSlice<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_BUFFER_SLICE_INTO_BUFFER: RefCell<Option<BufferSlice<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_JS_STRING_REF: RefCell<Option<JsString<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_OBJECT_REF: RefCell<Option<Object<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_UTF8_STRING: RefCell<Option<JsStringUtf8<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_UTF16_STRING: RefCell<Option<JsStringUtf16<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_LATIN1_STRING: RefCell<Option<JsStringLatin1<'static>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_DEPRECATED_OBJECT: RefCell<Option<JsObject>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_DEPRECATED_BOOLEAN: RefCell<Option<JsBoolean>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_LEGACY_REF: RefCell<Option<napi::Ref<Object<'static>>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_LEGACY_REF_ENV_GET: RefCell<Option<napi::Ref<Object<'static>>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_LEGACY_REF_ENV_GET_UNCHECKED: RefCell<Option<napi::Ref<Object<'static>>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_UNKNOWN_REF: RefCell<Option<UnknownRef<false>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_UNKNOWN_REF_BORROWED: RefCell<Option<UnknownRef<false>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_SYMBOL_REF: RefCell<Option<SymbolRef<false>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_SYMBOL_REF_BORROWED: RefCell<Option<SymbolRef<false>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_OBJECT_REFERENCE: RefCell<Option<ObjectRef<false>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_OBJECT_REFERENCE_BORROWED: RefCell<Option<ObjectRef<false>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_FUNCTION_REFERENCE: RefCell<Option<FunctionRef<(), ()>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_CLASS_INSTANCE: RefCell<Option<ClassInstance<'static, Animal>>> =
    const { RefCell::new(None) };
  static LATER_TURN_STASHED_CLASS_INSTANCE: RefCell<Option<ClassInstance<'static, Animal>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_CLASS_REFERENCE: RefCell<Option<Reference<Animal>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_CLASS_WEAK_OWNER: RefCell<Option<Reference<Animal>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_CLASS_WEAK_REFERENCE: RefCell<Option<WeakReference<Animal>>> =
    const { RefCell::new(None) };
  static LIFECYCLE_STASHED_CLASS_SHARED_REFERENCE: RefCell<Option<SharedReference<Animal, ()>>> =
    const { RefCell::new(None) };
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
unsafe fn to_unknown_for_env<T: ToNapiValue>(env: Env, value: T) -> Result<Unknown<'static>> {
  let raw = unsafe { T::to_napi_value(env.raw(), value)? };
  Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), raw) })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "withBorrowedValuesAcrossDuplicateLoad")]
fn with_lifecycle_borrowed_values(
  value: Unknown<'static>,
  buffer_slice_ref: BufferSlice<'static>,
  buffer_slice_into_buffer: BufferSlice<'static>,
  callback: Function<(), ()>,
) -> Result<()> {
  LIFECYCLE_STASHED_VALUE.with(|stored| *stored.borrow_mut() = Some(value));
  LIFECYCLE_STASHED_BUFFER_SLICE_REF.with(|stored| *stored.borrow_mut() = Some(buffer_slice_ref));
  LIFECYCLE_STASHED_BUFFER_SLICE_INTO_BUFFER
    .with(|stored| *stored.borrow_mut() = Some(buffer_slice_into_buffer));

  let result = callback.call(());
  LIFECYCLE_STASHED_VALUE.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_BUFFER_SLICE_REF.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_BUFFER_SLICE_INTO_BUFFER.with(|stored| stored.borrow_mut().take());
  result
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeBorrowedValueAcrossDuplicateLoad")]
fn take_lifecycle_borrowed_value() -> Result<Unknown<'static>> {
  LIFECYCLE_STASHED_VALUE
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no lifecycle borrowed value was stashed"))
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeBufferSliceRefAcrossDuplicateLoad")]
fn take_lifecycle_buffer_slice_ref(env: Env) -> Result<Unknown<'static>> {
  let value = LIFECYCLE_STASHED_BUFFER_SLICE_REF
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no lifecycle BufferSlice reference was stashed"))?;
  let raw = unsafe { <&BufferSlice<'_>>::to_napi_value(env.raw(), &value)? };
  Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), raw) })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeBufferSliceIntoBufferAcrossDuplicateLoad")]
fn take_lifecycle_buffer_slice_into_buffer(env: &Env) -> Result<Buffer> {
  LIFECYCLE_STASHED_BUFFER_SLICE_INTO_BUFFER
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no lifecycle BufferSlice was stashed"))?
    .into_buffer(env)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "withAdditionalBorrowedValuesAcrossDuplicateLoad")]
#[allow(clippy::too_many_arguments)]
fn with_lifecycle_additional_borrowed_values(
  env: Env,
  js_string_ref: JsString<'static>,
  object_ref: Object<'static>,
  utf8_string: JsString<'static>,
  utf16_string: JsString<'static>,
  latin1_string: JsString<'static>,
  deprecated_object: JsObject,
  deprecated_boolean: Unknown<'static>,
  callback: Function<(), ()>,
) -> Result<()> {
  let utf8_string = utf8_string.into_utf8()?;
  let utf16_string = utf16_string.into_utf16()?;
  let latin1_string = latin1_string.into_latin1()?;
  let deprecated_boolean =
    unsafe { JsBoolean::from_raw_unchecked(env.raw(), deprecated_boolean.raw()) };

  LIFECYCLE_STASHED_JS_STRING_REF.with(|stored| *stored.borrow_mut() = Some(js_string_ref));
  LIFECYCLE_STASHED_OBJECT_REF.with(|stored| *stored.borrow_mut() = Some(object_ref));
  LIFECYCLE_STASHED_UTF8_STRING.with(|stored| *stored.borrow_mut() = Some(utf8_string));
  LIFECYCLE_STASHED_UTF16_STRING.with(|stored| *stored.borrow_mut() = Some(utf16_string));
  LIFECYCLE_STASHED_LATIN1_STRING.with(|stored| *stored.borrow_mut() = Some(latin1_string));
  LIFECYCLE_STASHED_DEPRECATED_OBJECT.with(|stored| *stored.borrow_mut() = Some(deprecated_object));
  LIFECYCLE_STASHED_DEPRECATED_BOOLEAN
    .with(|stored| *stored.borrow_mut() = Some(deprecated_boolean));

  let result = callback.call(());
  LIFECYCLE_STASHED_JS_STRING_REF.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_OBJECT_REF.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_UTF8_STRING.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_UTF16_STRING.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_LATIN1_STRING.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_DEPRECATED_OBJECT.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_DEPRECATED_BOOLEAN.with(|stored| stored.borrow_mut().take());
  result
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeAdditionalBorrowedValueAcrossDuplicateLoad")]
fn take_lifecycle_additional_borrowed_value(env: Env, kind: String) -> Result<Unknown<'static>> {
  match kind.as_str() {
    "js-string-ref" => {
      let value = LIFECYCLE_STASHED_JS_STRING_REF
        .with(|stored| stored.borrow_mut().take())
        .ok_or_else(|| Error::from_reason("no lifecycle JsString was stashed"))?;
      unsafe { to_unknown_for_env(env, value) }
    }
    "object-ref" => {
      let value = LIFECYCLE_STASHED_OBJECT_REF
        .with(|stored| stored.borrow_mut().take())
        .ok_or_else(|| Error::from_reason("no lifecycle Object was stashed"))?;
      unsafe { to_unknown_for_env(env, value) }
    }
    "utf8-string" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_UTF8_STRING
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle UTF-8 string was stashed"))?,
      )
    },
    "utf16-string" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_UTF16_STRING
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle UTF-16 string was stashed"))?,
      )
    },
    "latin1-string" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_LATIN1_STRING
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle Latin-1 string was stashed"))?,
      )
    },
    "deprecated-object" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_DEPRECATED_OBJECT
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle deprecated Object was stashed"))?,
      )
    },
    "deprecated-boolean" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_DEPRECATED_BOOLEAN
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle deprecated Boolean was stashed"))?,
      )
    },
    _ => Err(Error::from_reason(format!(
      "unknown lifecycle borrowed value kind: {kind}"
    ))),
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
fn clear_lifecycle_reference_values(env: &Env) -> Result<()> {
  if let Some(mut value) = LIFECYCLE_STASHED_LEGACY_REF.with(|stored| stored.borrow_mut().take()) {
    value.unref(env)?;
  }
  if let Some(mut value) =
    LIFECYCLE_STASHED_LEGACY_REF_ENV_GET.with(|stored| stored.borrow_mut().take())
  {
    value.unref(env)?;
  }
  if let Some(mut value) =
    LIFECYCLE_STASHED_LEGACY_REF_ENV_GET_UNCHECKED.with(|stored| stored.borrow_mut().take())
  {
    value.unref(env)?;
  }
  if let Some(value) = LIFECYCLE_STASHED_UNKNOWN_REF.with(|stored| stored.borrow_mut().take()) {
    value.unref(env)?;
  }
  if let Some(value) =
    LIFECYCLE_STASHED_UNKNOWN_REF_BORROWED.with(|stored| stored.borrow_mut().take())
  {
    value.unref(env)?;
  }
  if let Some(value) = LIFECYCLE_STASHED_SYMBOL_REF.with(|stored| stored.borrow_mut().take()) {
    value.unref(env)?;
  }
  if let Some(value) =
    LIFECYCLE_STASHED_SYMBOL_REF_BORROWED.with(|stored| stored.borrow_mut().take())
  {
    value.unref(env)?;
  }
  if let Some(value) = LIFECYCLE_STASHED_OBJECT_REFERENCE.with(|stored| stored.borrow_mut().take())
  {
    value.unref(env)?;
  }
  if let Some(value) =
    LIFECYCLE_STASHED_OBJECT_REFERENCE_BORROWED.with(|stored| stored.borrow_mut().take())
  {
    value.unref(env)?;
  }
  LIFECYCLE_STASHED_FUNCTION_REFERENCE.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_CLASS_WEAK_REFERENCE.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_CLASS_WEAK_OWNER.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_CLASS_REFERENCE.with(|stored| stored.borrow_mut().take());
  LIFECYCLE_STASHED_CLASS_SHARED_REFERENCE.with(|stored| stored.borrow_mut().take());
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "withReferenceValuesAcrossDuplicateLoad")]
fn with_lifecycle_reference_values(
  env: Env,
  legacy_ref_value: Object<'static>,
  unknown_ref_value: Unknown<'static>,
  symbol_ref_value: JsSymbol<'static>,
  object_ref_value: Object<'static>,
  class_instance: ClassInstance<'static, Animal>,
  callback: Function<(), ()>,
) -> Result<()> {
  let legacy_ref = napi::Ref::new(&env, &legacy_ref_value)?;
  let legacy_ref_env_get = napi::Ref::new(&env, &legacy_ref_value)?;
  let legacy_ref_env_get_unchecked = napi::Ref::new(&env, &legacy_ref_value)?;
  let unknown_ref =
    unsafe { UnknownRef::<false>::from_napi_value(env.raw(), unknown_ref_value.raw())? };
  let unknown_ref_borrowed =
    unsafe { UnknownRef::<false>::from_napi_value(env.raw(), unknown_ref_value.raw())? };
  let symbol_ref =
    unsafe { SymbolRef::<false>::from_napi_value(env.raw(), symbol_ref_value.raw())? };
  let symbol_ref_borrowed =
    unsafe { SymbolRef::<false>::from_napi_value(env.raw(), symbol_ref_value.raw())? };
  let object_reference =
    unsafe { ObjectRef::<false>::from_napi_value(env.raw(), object_ref_value.raw())? };
  let object_reference_borrowed =
    unsafe { ObjectRef::<false>::from_napi_value(env.raw(), object_ref_value.raw())? };
  let function_reference = callback.create_ref()?;
  let class_reference = class_instance.clone_reference(env)?;
  let class_reference_for_return = class_reference.clone(env)?;
  let weak_owner = class_reference.clone(env)?;
  let weak_reference = weak_owner.downgrade();
  // No other reference is accessed while this owner-tied value is constructed, and the closure
  // does not let the class borrow escape.
  let shared_reference = unsafe { class_reference.share_with(env, |_| Ok(()))? };

  LIFECYCLE_STASHED_LEGACY_REF.with(|stored| *stored.borrow_mut() = Some(legacy_ref));
  LIFECYCLE_STASHED_LEGACY_REF_ENV_GET
    .with(|stored| *stored.borrow_mut() = Some(legacy_ref_env_get));
  LIFECYCLE_STASHED_LEGACY_REF_ENV_GET_UNCHECKED
    .with(|stored| *stored.borrow_mut() = Some(legacy_ref_env_get_unchecked));
  LIFECYCLE_STASHED_UNKNOWN_REF.with(|stored| *stored.borrow_mut() = Some(unknown_ref));
  LIFECYCLE_STASHED_UNKNOWN_REF_BORROWED
    .with(|stored| *stored.borrow_mut() = Some(unknown_ref_borrowed));
  LIFECYCLE_STASHED_SYMBOL_REF.with(|stored| *stored.borrow_mut() = Some(symbol_ref));
  LIFECYCLE_STASHED_SYMBOL_REF_BORROWED
    .with(|stored| *stored.borrow_mut() = Some(symbol_ref_borrowed));
  LIFECYCLE_STASHED_OBJECT_REFERENCE.with(|stored| *stored.borrow_mut() = Some(object_reference));
  LIFECYCLE_STASHED_OBJECT_REFERENCE_BORROWED
    .with(|stored| *stored.borrow_mut() = Some(object_reference_borrowed));
  LIFECYCLE_STASHED_FUNCTION_REFERENCE
    .with(|stored| *stored.borrow_mut() = Some(function_reference));
  LIFECYCLE_STASHED_CLASS_INSTANCE.with(|stored| *stored.borrow_mut() = Some(class_instance));
  LIFECYCLE_STASHED_CLASS_REFERENCE
    .with(|stored| *stored.borrow_mut() = Some(class_reference_for_return));
  LIFECYCLE_STASHED_CLASS_WEAK_OWNER.with(|stored| *stored.borrow_mut() = Some(weak_owner));
  LIFECYCLE_STASHED_CLASS_WEAK_REFERENCE.with(|stored| *stored.borrow_mut() = Some(weak_reference));
  LIFECYCLE_STASHED_CLASS_SHARED_REFERENCE
    .with(|stored| *stored.borrow_mut() = Some(shared_reference));

  let result = callback.call(());
  clear_lifecycle_reference_values(&env)?;
  result
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeReferenceValueAcrossDuplicateLoad")]
fn take_lifecycle_reference_value(env: Env, kind: String) -> Result<Unknown<'static>> {
  match kind.as_str() {
    "legacy-ref" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_LEGACY_REF
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle Ref was stashed"))?,
      )
    },
    "legacy-ref-env-get" => {
      let value = LIFECYCLE_STASHED_LEGACY_REF_ENV_GET.with(|stored| {
        let stored = stored.borrow();
        let reference = stored
          .as_ref()
          .ok_or_else(|| Error::from_reason("no lifecycle Env Ref was stashed"))?;
        env.get_reference_value(reference)
      })?;
      let mut reference = LIFECYCLE_STASHED_LEGACY_REF_ENV_GET
        .with(|stored| stored.borrow_mut().take())
        .expect("lifecycle Env Ref must remain stashed after successful conversion");
      reference.unref(&env)?;
      Ok(value.to_unknown())
    }
    "legacy-ref-env-get-unchecked" => {
      let value = LIFECYCLE_STASHED_LEGACY_REF_ENV_GET_UNCHECKED.with(|stored| {
        let stored = stored.borrow();
        let reference = stored
          .as_ref()
          .ok_or_else(|| Error::from_reason("no lifecycle unchecked Env Ref was stashed"))?;
        env.get_reference_value_unchecked(reference)
      })?;
      let mut reference = LIFECYCLE_STASHED_LEGACY_REF_ENV_GET_UNCHECKED
        .with(|stored| stored.borrow_mut().take())
        .expect("lifecycle unchecked Env Ref must remain stashed after successful conversion");
      reference.unref(&env)?;
      Ok(value.to_unknown())
    }
    "unknown-ref" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_UNKNOWN_REF
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle UnknownRef was stashed"))?,
      )
    },
    "unknown-ref-borrowed" => {
      let result = LIFECYCLE_STASHED_UNKNOWN_REF_BORROWED.with(|stored| {
        let stored = stored.borrow();
        let value = stored
          .as_ref()
          .ok_or_else(|| Error::from_reason("no lifecycle borrowed UnknownRef was stashed"))?;
        unsafe { to_unknown_for_env(env, value) }
      })?;
      let value = LIFECYCLE_STASHED_UNKNOWN_REF_BORROWED
        .with(|stored| stored.borrow_mut().take())
        .expect("lifecycle borrowed UnknownRef must remain stashed after successful conversion");
      value.unref(&env)?;
      Ok(result)
    }
    "symbol-ref" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_SYMBOL_REF
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle SymbolRef was stashed"))?,
      )
    },
    "symbol-ref-borrowed" => {
      let result = LIFECYCLE_STASHED_SYMBOL_REF_BORROWED.with(|stored| {
        let stored = stored.borrow();
        let value = stored
          .as_ref()
          .ok_or_else(|| Error::from_reason("no lifecycle borrowed SymbolRef was stashed"))?;
        unsafe { to_unknown_for_env(env, value) }
      })?;
      let value = LIFECYCLE_STASHED_SYMBOL_REF_BORROWED
        .with(|stored| stored.borrow_mut().take())
        .expect("lifecycle borrowed SymbolRef must remain stashed after successful conversion");
      value.unref(&env)?;
      Ok(result)
    }
    "object-ref" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_OBJECT_REFERENCE
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle ObjectRef was stashed"))?,
      )
    },
    "object-ref-borrowed" => {
      let result = LIFECYCLE_STASHED_OBJECT_REFERENCE_BORROWED.with(|stored| {
        let stored = stored.borrow();
        let value = stored
          .as_ref()
          .ok_or_else(|| Error::from_reason("no lifecycle borrowed ObjectRef was stashed"))?;
        unsafe { to_unknown_for_env(env, value) }
      })?;
      let value = LIFECYCLE_STASHED_OBJECT_REFERENCE_BORROWED
        .with(|stored| stored.borrow_mut().take())
        .expect("lifecycle borrowed ObjectRef must remain stashed after successful conversion");
      value.unref(&env)?;
      Ok(result)
    }
    "function-ref" => {
      let value = LIFECYCLE_STASHED_FUNCTION_REFERENCE
        .with(|stored| stored.borrow_mut().take())
        .ok_or_else(|| Error::from_reason("no lifecycle FunctionRef was stashed"))?;
      let function = value.borrow_back(&env)?;
      Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), function.raw()) })
    }
    "class-instance-as-object" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_CLASS_INSTANCE
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle ClassInstance was stashed"))?,
      )
    },
    "class-reference" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_CLASS_REFERENCE
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle class Reference was stashed"))?,
      )
    },
    "class-weak-reference" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_CLASS_WEAK_REFERENCE
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle WeakReference was stashed"))?,
      )
    },
    "class-shared-reference" => unsafe {
      to_unknown_for_env(
        env,
        LIFECYCLE_STASHED_CLASS_SHARED_REFERENCE
          .with(|stored| stored.borrow_mut().take())
          .ok_or_else(|| Error::from_reason("no lifecycle SharedReference was stashed"))?,
      )
    },
    _ => Err(Error::from_reason(format!(
      "unknown lifecycle reference value kind: {kind}"
    ))),
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "assignClassInstanceAcrossDuplicateLoad")]
fn assign_lifecycle_class_instance_to_this<'env>(
  mut this: This<'env>,
  with_attributes: bool,
) -> Result<()> {
  LIFECYCLE_STASHED_CLASS_INSTANCE.with(|stored| {
    let stored = stored.borrow();
    let instance = stored
      .as_ref()
      .ok_or_else(|| Error::from_reason("no lifecycle ClassInstance was stashed"))?;
    if with_attributes {
      instance.assign_to_this_with_attributes(
        "assignedClassInstanceWithAttributes",
        PropertyAttributes::Default,
        &mut this,
      )?;
    } else {
      instance.assign_to_this("assignedClassInstance", &mut this)?;
    }
    Ok(())
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashClassInstanceForLaterTurn")]
fn stash_class_instance_for_later_turn(class_instance: ClassInstance<'static, Animal>) {
  LATER_TURN_STASHED_CLASS_INSTANCE.with(|stored| *stored.borrow_mut() = Some(class_instance));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "takeClassInstanceFromLaterTurn")]
fn take_class_instance_from_later_turn() -> Result<ClassInstance<'static, Animal>> {
  LATER_TURN_STASHED_CLASS_INSTANCE
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no later-turn ClassInstance was stashed"))
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "assignClassInstanceFromLaterTurn")]
fn assign_class_instance_from_later_turn<'env>(
  mut this: This<'env>,
  with_attributes: bool,
) -> Result<()> {
  let instance = LATER_TURN_STASHED_CLASS_INSTANCE
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no later-turn ClassInstance was stashed"))?;
  if with_attributes {
    instance.assign_to_this_with_attributes(
      "laterTurnClassInstanceWithAttributes",
      PropertyAttributes::Default,
      &mut this,
    )?;
  } else {
    instance.assign_to_this("laterTurnClassInstance", &mut this)?;
  }
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
fn expect_native_thread_invalid_arg<T>(result: Result<T>) -> Result<()> {
  match result {
    Err(error) if error.status == Status::InvalidArg => Ok(()),
    Err(error) => Err(error),
    Ok(_) => Err(Error::new(
      Status::GenericFailure,
      "JavaScript reference unexpectedly allowed access from a native thread",
    )),
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi]
fn verify_reference_values_reject_native_thread(
  env: Env,
  legacy_ref_value: Object<'static>,
  unknown_ref_value: Unknown<'static>,
  symbol_ref_value: JsSymbol<'static>,
  object_ref_value: Object<'static>,
  function_ref_value: Function<(), ()>,
  buffer: Buffer,
) -> Result<()> {
  let legacy_ref = napi::Ref::new(&env, &legacy_ref_value)?;
  let unknown_ref =
    unsafe { UnknownRef::<false>::from_napi_value(env.raw(), unknown_ref_value.raw())? };
  let symbol_ref =
    unsafe { SymbolRef::<false>::from_napi_value(env.raw(), symbol_ref_value.raw())? };
  let object_ref =
    unsafe { ObjectRef::<false>::from_napi_value(env.raw(), object_ref_value.raw())? };
  let function_ref = function_ref_value.create_ref()?;
  let raw_env = env.raw() as usize;
  let (mut legacy_ref, unknown_ref, symbol_ref, object_ref, function_ref) =
    std::thread::spawn(move || -> Result<_> {
      let env = Env::from_raw(raw_env as sys::napi_env);
      expect_native_thread_invalid_arg(legacy_ref.get_value(&env))?;
      expect_native_thread_invalid_arg(unknown_ref.get_value(&env))?;
      expect_native_thread_invalid_arg(symbol_ref.get_value(&env))?;
      expect_native_thread_invalid_arg(object_ref.get_value(&env))?;
      expect_native_thread_invalid_arg(function_ref.borrow_back(&env))?;
      expect_native_thread_invalid_arg(unsafe {
        <Buffer as ToNapiValue>::to_napi_value(env.raw(), buffer)
      })?;
      Ok((
        legacy_ref,
        unknown_ref,
        symbol_ref,
        object_ref,
        function_ref,
      ))
    })
    .join()
    .map_err(|_| Error::from_reason("JavaScript reference native-thread test panicked"))??;

  legacy_ref.unref(&env)?;
  unknown_ref.unref(&env)?;
  symbol_ref.unref(&env)?;
  object_ref.unref(&env)?;
  drop(function_ref);
  Ok(())
}
