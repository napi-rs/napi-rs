//! `#[napi(extends = Parent)]` single-class inheritance (v1).
//!
//! A child embeds its parent by value at offset zero (`#[repr(C)]`, asserted
//! at compile time), so a validated child pointer can be borrowed as `&Parent`.
//! At load, each child's prototype is linked to its parent's with
//! `Object.setPrototypeOf`; constructors and statics are not inherited.
//!
//! Inherited members:
//! - Field accessors and `#[napi(getter/setter)]` work on descendants on every
//!   Node-API version, since `napi_define_class` binds accessors without a
//!   receiver signature.
//! - Borrowed (`&self` / `&mut self`) methods of a parent class are defined on
//!   its prototype as plain functions on native `napi8` builds, and the
//!   generated callback validates the receiver against this hierarchy. On
//!   native builds without `napi8` they stay signature-bound by
//!   `napi_define_class`, so calling one on a descendant throws
//!   `TypeError: Illegal invocation`; this is deliberate rather than weakening
//!   the receiver check. emnapi (wasm) does not enforce method signatures, so
//!   there the generated callback's class-identity check is what accepts a
//!   descendant or rejects a foreign receiver.
//! - Methods taking `Reference<Self>`, and `&Parent` arguments, stay exact.
//!
//! This module holds the validated, addon-wide layout relationships. No
//! JavaScript handles live here: prototypes and constructor references remain
//! local to each environment.
// `noop` builds compile the registration surface but never load a module.
#![cfg_attr(feature = "noop", allow(dead_code))]
use std::{any::TypeId, collections::HashMap, sync::OnceLock};

use crate::{sys, Result};

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

#[derive(Default)]
pub(crate) struct Hierarchy {
  // Includes every transitive descendant, but not the class itself.
  descendants: HashMap<TypeId, Vec<ClassLayout>>,
}

pub(crate) static HIERARCHY: OnceLock<std::result::Result<Hierarchy, String>> = OnceLock::new();

impl Hierarchy {
  pub fn build(classes: &[ClassLayout]) -> std::result::Result<Self, String> {
    let classes: HashMap<_, _> = classes.iter().map(|c| (c.id, *c)).collect();
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
  pub fn is_base(&self, id: TypeId) -> bool {
    self.descendants.contains_key(&id)
  }

  #[cfg(any(test, not(all(feature = "napi8", not(target_family = "wasm")))))]
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
    if super::class_identity::check_inherited_class_identity::<T>(wrapped) {
      Ok(wrapped.cast())
    } else {
      super::check_class_identity::<T>(wrapped, T::type_name)?;
      Ok(wrapped.cast())
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
