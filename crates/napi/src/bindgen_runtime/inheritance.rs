//! `#[napi(extends = Parent)]` single-class inheritance (v1).
//!
//! A child embeds its parent by value at offset zero (`#[repr(C)]`, asserted
//! at compile time), so a validated child pointer can be borrowed as `&Parent`.
//! At load, each child's prototype is linked to its parent's with
//! `Object.setPrototypeOf`; constructors and statics are not inherited.
//!
//! Requires `napi8` on native targets (a compile error otherwise): the
//! receiver check for inherited methods is a type-tag check, and without it a
//! descendant could only be checked through V8's exact-class method signature.
//!
//! Inherited members:
//! - Field accessors and `#[napi(getter/setter)]`.
//! - Borrowed (`&self` / `&mut self`) methods. For a class that has children
//!   they are defined on its prototype as plain named functions (no V8 method
//!   signature) and the generated callback validates the receiver: an exact
//!   type tag, else one tag check per descendant of that class. On wasm,
//!   emnapi enforces no method signature for any class, and the class identity
//!   recorded at wrap time is checked instead.
//! - Exact-only: methods taking `Reference<Self>` or a typed `This<T>`, and
//!   `&Parent` arguments. Generated declarations `Omit` these from the child.
//! - A parent cannot use `custom_finalize`: a child is finalized as the child,
//!   so the parent's `ObjectFinalize::finalize` would never run.
//!
//! This module holds the validated, addon-wide layout relationships. No
//! JavaScript handles live here: prototypes and constructor references remain
//! local to each environment.
// `noop` builds compile the registration surface but never load a module.
#![cfg_attr(feature = "noop", allow(dead_code))]
use std::{any::TypeId, collections::HashMap, sync::OnceLock};

use rustc_hash::FxBuildHasher;

use crate::{sys, Result};

/// Layout metadata a class struct registers: its identity, type tag, and
/// optional `#[napi(extends)]` parent.
#[derive(Clone, Copy)]
pub(crate) struct ClassLayout {
  pub id: TypeId,
  #[cfg_attr(
    not(all(feature = "napi8", not(target_family = "wasm"))),
    allow(dead_code)
  )]
  pub tag: [u64; 2],
  pub parent: Option<TypeId>,
  pub iterator: bool,
}

/// The validated class hierarchy: for each base class, its descendants.
#[derive(Default)]
pub(crate) struct Hierarchy {
  // Includes every transitive descendant, but not the class itself.
  descendants: HashMap<TypeId, Vec<ClassLayout>, FxBuildHasher>,
}

/// Built once, on the first module load, from every registered class.
pub(crate) static HIERARCHY: OnceLock<std::result::Result<Hierarchy, String>> = OnceLock::new();

impl Hierarchy {
  /// Builds the hierarchy, rejecting missing parents, cycles, and iterator
  /// classes on either side of an edge.
  pub fn build(classes: &[ClassLayout]) -> std::result::Result<Self, String> {
    let classes: HashMap<_, _, FxBuildHasher> = classes.iter().map(|c| (c.id, *c)).collect();
    let mut result = Self::default();
    for child in classes.values() {
      let mut visited = vec![child.id];
      let mut parent = child.parent;
      while let Some(id) = parent {
        if visited.contains(&id) {
          return Err("Cycle in #[napi(extends)] hierarchy".into());
        }
        visited.push(id);
        let base = classes
          .get(&id)
          .ok_or("Missing parent in #[napi(extends)] hierarchy")?;
        if base.iterator || child.iterator {
          return Err("Iterator classes cannot participate in #[napi(extends)]".into());
        }
        result.descendants.entry(id).or_default().push(*child);
        parent = base.parent;
      }
    }
    Ok(result)
  }

  #[cfg_attr(
    not(all(feature = "napi8", not(target_family = "wasm"))),
    allow(dead_code)
  )]
  /// Whether `id` has at least one descendant.
  pub fn is_base(&self, id: TypeId) -> bool {
    self.descendants.contains_key(&id)
  }

  #[cfg(any(test, not(all(feature = "napi8", not(target_family = "wasm")))))]
  /// Whether `child` is a (transitive) descendant of `base`.
  pub fn accepts(&self, base: TypeId, child: TypeId) -> bool {
    self
      .descendants
      .get(&base)
      .is_some_and(|children| children.iter().any(|c| c.id == child))
  }
}

/// Validates an instance before borrowing an offset-zero parent subobject.
///
/// # Safety
/// Both handles must belong to the current callback's environment. The returned
/// pointer must only be borrowed, never owned, finalized or used as Reference<T>.
#[doc(hidden)]
pub unsafe fn unwrap_inherited_receiver<T: super::TypeName + super::MaybeTypeTag>(
  env: sys::napi_env,
  value: sys::napi_value,
) -> Result<*mut T> {
  let mut wrapped = std::ptr::null_mut();
  crate::check_status!(
    unsafe { sys::napi_unwrap(env, value, &mut wrapped) },
    "Failed to unwrap exclusive reference of `{}` type from napi value",
    T::type_name(),
  )?;
  #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
  {
    let expected = T::type_tag();
    let mut exact = false;
    crate::check_status!(unsafe {
      sys::napi_check_object_type_tag(env, value, &expected, &mut exact)
    })?;
    if exact {
      return Ok(wrapped.cast());
    }
    if let Some(Ok(hierarchy)) = HIERARCHY.get() {
      let parent_id = super::class_identity::type_id_of::<T>();
      if let Some(children) = hierarchy.descendants.get(&parent_id) {
        for child in children {
          let tag = sys::napi_type_tag {
            lower: child.tag[0],
            upper: child.tag[1],
          };
          let mut matches = false;
          crate::check_status!(unsafe {
            sys::napi_check_object_type_tag(env, value, &tag, &mut matches)
          })?;
          if matches {
            return Ok(wrapped.cast());
          }
        }
      }
    }
    Err(super::class_identity::wrong_class_error(T::type_name()))
  }
  #[cfg(not(all(feature = "napi8", not(target_family = "wasm"))))]
  {
    // Exact receivers (every non-inheritance class) take the existing check
    // alone; only a mismatch consults the hierarchy.
    match super::check_class_identity::<T>(wrapped, T::type_name) {
      Ok(()) => Ok(wrapped.cast()),
      Err(_) if super::class_identity::check_inherited_class_identity::<T>(wrapped) => {
        Ok(wrapped.cast())
      }
      Err(error) => Err(error),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  fn class<T: 'static>(parent: Option<TypeId>) -> ClassLayout {
    ClassLayout {
      id: TypeId::of::<T>(),
      tag: [0, 0],
      parent,
      iterator: false,
    }
  }
  #[test]
  fn validates_multilevel_and_sibling_relationships() {
    let a = TypeId::of::<u8>();
    let b = TypeId::of::<u16>();
    let c = TypeId::of::<u32>();
    let d = TypeId::of::<u64>();
    let h = Hierarchy::build(&[
      class::<u32>(Some(b)),
      class::<u8>(None),
      class::<u64>(Some(a)),
      class::<u16>(Some(a)),
    ])
    .unwrap();
    assert!(h.accepts(a, c));
    assert!(h.accepts(b, c));
    assert!(!h.accepts(b, d));
    assert!(!h.accepts(c, a));
    assert!(!h.accepts(a, a));
  }
  #[test]
  fn rejects_missing_parents_cycles_and_iterators() {
    let a = TypeId::of::<u8>();
    let b = TypeId::of::<u16>();
    assert!(Hierarchy::build(&[class::<u8>(Some(b))]).is_err());
    assert!(Hierarchy::build(&[class::<u8>(Some(a))]).is_err());
    assert!(Hierarchy::build(&[class::<u8>(Some(b)), class::<u16>(Some(a))]).is_err());
    let mut base = class::<u8>(None);
    base.iterator = true;
    assert!(Hierarchy::build(&[base, class::<u16>(Some(a))]).is_err());
  }
}
