use crate::sys;

/// Unforgeable per-class identity for `#[napi]` classes.
///
/// Every `#[napi]` struct that becomes a JS class gets a derive-generated
/// `impl TypeTag`, whose [`type_tag`](TypeTag::type_tag) returns a stable
/// 128-bit value derived from the class's [`std::any::TypeId`] — rustc's
/// canonical, guaranteed-unique-per-type identity (distinct across modules,
/// addons, forks, and feature variants via the crate SVH). Two *distinct* Rust
/// classes therefore can never share a tag except by a (negligible) hash
/// collision, even when they share the same `js_name` and namespace. The tag is
/// stamped onto each instance's JS object right after `napi_wrap` and verified
/// before every blind pointer cast, so a wrong-class / prototype-spoofed /
/// `method.call(wrongThis)` object is rejected instead of causing a
/// type-confused cast.
///
/// This trait is defined **unconditionally** (in every build, regardless of the
/// `napi8` feature) so that generic `where T: TypeTag` bounds always type-check.
/// The actual stamping/checking is performed by [`tag_object`] /
/// [`validate_type_tag`], which only do real work under the `napi8` feature.
pub trait TypeTag {
  /// Returns this class's stable per-type tag. The derive caches the computed
  /// value in a `OnceLock`, so repeated calls within a process return the same
  /// tag.
  fn type_tag() -> sys::napi_type_tag;
}

/// Derive a 128-bit [`sys::napi_type_tag`] from a [`core::any::TypeId`].
///
/// `TypeId` is rustc's canonical, guaranteed-unique-per-type identity, so two
/// distinct Rust types map to distinct tags except for a (negligible) hash
/// collision. `DefaultHasher::new()` is fixed-seed (deterministic), so the same
/// `TypeId` always maps to the same tag within a process — which is all the tag
/// needs, since a given instance is stamped and checked in the same binary. Two
/// hashes over the same id with distinct salt bytes give the two 64-bit halves.
///
/// Defined **unconditionally** (pure hashing, no `napi8` dependency) so the
/// derive-generated `type_tag()` compiles in every build.
pub fn type_tag_from_type_id(id: core::any::TypeId) -> sys::napi_type_tag {
  use core::hash::{Hash, Hasher};
  use std::collections::hash_map::DefaultHasher;

  let mut lo = DefaultHasher::new();
  id.hash(&mut lo);
  0xA5u8.hash(&mut lo);

  let mut hi = DefaultHasher::new();
  id.hash(&mut hi);
  0x5Au8.hash(&mut hi);

  sys::napi_type_tag {
    lower: lo.finish(),
    upper: hi.finish(),
  }
}

/// Marker bound used by the runtime generics (`ClassInstance<T>`, `Reference<T>`,
/// `new_instance`, `CallbackInfo`/`ClassAccessorCallbackInfo` helpers) in place
/// of a bare `T: TypeTag` bound.
///
/// Its meaning is cfg-split exactly once:
///
/// * Under `napi8` it is a supertrait alias for [`TypeTag`], so a `T:
///   MaybeTypeTag` bound implies `T: TypeTag` and the (napi8-only) tag calls in
///   those generic bodies can name `T::type_tag()`.
/// * Without `napi8` it is a vacuous blanket bound satisfied by every `T`, so the
///   runtime generics do **not** narrow the public API — their signatures stay
///   byte-identical to the pre-tag versions, and generic-over-class-`T` consumer
///   code keeps compiling without any tag bound.
///
/// The blanket impl over `T: TypeTag` (napi8) / over all `T` (otherwise) is a
/// separate trait from `TypeTag`, so it never conflicts with the
/// derive-generated `impl TypeTag for #name`.
#[cfg(feature = "napi8")]
pub trait MaybeTypeTag: TypeTag {}
#[cfg(feature = "napi8")]
impl<T: TypeTag> MaybeTypeTag for T {}

/// See the `napi8` variant above. Without `napi8` this is a vacuous marker
/// implemented for every `T`, so it never narrows a public signature.
#[cfg(not(feature = "napi8"))]
pub trait MaybeTypeTag {}
#[cfg(not(feature = "napi8"))]
impl<T> MaybeTypeTag for T {}

/// Stamp `obj` with the class type tag `tag` (right after `napi_wrap`).
///
/// # Safety
///
/// `env` must be a valid napi env pointer and `obj` a valid js object that has
/// not already been tagged.
///
/// # Note on gating
///
/// This helper is defined **unconditionally** with a `napi8`-gated body (a
/// no-op that returns `Ok(())` on builds without `napi8`). It is deliberately
/// *not* `#[cfg(feature = "napi8")]`, because it is also invoked from
/// derive-generated code that expands in the consumer crate, where a
/// `#[cfg(feature = "napi8")]` attribute would resolve against the *consumer*
/// crate's features (which typically do not include a `napi8` feature) rather
/// than napi's. Gating happens here, inside the napi crate, where the feature
/// is visible.
#[cfg(feature = "napi8")]
pub unsafe fn tag_object(
  env: sys::napi_env,
  obj: sys::napi_value,
  tag: &sys::napi_type_tag,
) -> crate::Result<()> {
  crate::check_status!(
    unsafe { sys::napi_type_tag_object(env, obj, tag) },
    "Failed to tag object with class identity"
  )
}

/// No-op fallback for builds without the `napi8` feature. See the `napi8`
/// variant for why this is defined unconditionally.
///
/// # Safety
///
/// Always safe; the arguments are ignored.
#[cfg(not(feature = "napi8"))]
#[inline(always)]
pub unsafe fn tag_object(
  _env: sys::napi_env,
  _obj: sys::napi_value,
  _tag: &sys::napi_type_tag,
) -> crate::Result<()> {
  Ok(())
}

/// Verify that `obj` carries the class type tag `tag`. On mismatch, returns a
/// catchable [`crate::Status::InvalidArg`] error instead of allowing a
/// type-confused pointer cast.
///
/// # Safety
///
/// `env` must be a valid napi env pointer and `obj` a valid js object.
///
/// # Note on gating
///
/// Defined unconditionally with a `napi8`-gated body for the same reason as
/// [`tag_object`]: it is invoked from derive-generated code (param `&T` /
/// `&mut T` checks) that expands in the consumer crate, so the feature gate
/// must live inside napi. On builds without `napi8` this is a no-op that
/// returns `Ok(())`, preserving today's behavior (blind cast, or `instanceof`
/// under `strict`).
#[cfg(feature = "napi8")]
pub unsafe fn validate_type_tag(
  env: sys::napi_env,
  obj: sys::napi_value,
  tag: &sys::napi_type_tag,
  class_name: &str,
) -> crate::Result<()> {
  let mut matches = false;
  crate::check_status!(
    unsafe { sys::napi_check_object_type_tag(env, obj, tag, &mut matches) },
    "type tag check failed"
  )?;
  if matches {
    Ok(())
  } else {
    Err(crate::Error::new(
      crate::Status::InvalidArg,
      format!("Value is not an instance of class `{class_name}`"),
    ))
  }
}

/// No-op fallback for builds without the `napi8` feature. See the `napi8`
/// variant for why this is defined unconditionally.
///
/// # Safety
///
/// Always safe; the arguments are ignored.
#[cfg(not(feature = "napi8"))]
#[inline(always)]
pub unsafe fn validate_type_tag(
  _env: sys::napi_env,
  _obj: sys::napi_value,
  _tag: &sys::napi_type_tag,
  _class_name: &str,
) -> crate::Result<()> {
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::type_tag_from_type_id;
  use core::any::TypeId;

  struct A;
  struct B;

  /// Distinct Rust types get distinct tags — even two types that would share
  /// every string field (js_name/namespace/crate/version) under the old
  /// string-based identity. This is the exact collision the TypeId switch fixes.
  #[test]
  fn distinct_type_ids_get_distinct_tags() {
    assert_ne!(
      type_tag_from_type_id(TypeId::of::<A>()),
      type_tag_from_type_id(TypeId::of::<B>()),
      "distinct types must map to distinct tags",
    );
    assert_ne!(
      type_tag_from_type_id(TypeId::of::<u32>()),
      type_tag_from_type_id(TypeId::of::<i32>()),
    );
  }

  /// `DefaultHasher::new()` is fixed-seed, so the same TypeId always maps to the
  /// same tag within a process (required: stamp and check happen in one binary).
  #[test]
  fn deterministic() {
    assert_eq!(
      type_tag_from_type_id(TypeId::of::<A>()),
      type_tag_from_type_id(TypeId::of::<A>()),
      "same type must map to the same tag on repeat",
    );
  }
}
