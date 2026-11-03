//! Per-env state that napi-rs keeps for each load of this addon.
//!
//! One addon image can be registered into several live `napi_env`s on the same
//! OS thread: `process.dlopen` of the same file twice, `delete require.cache`
//! followed by `require` again, a hardlinked copy of the `.node` file, or one
//! Electron renderer thread hosting several frames. Each load gets a new
//! `napi_env`, but all of them share this image's statics and thread-locals.
//! So anything cached per load has to be keyed by env, not by thread, and has to
//! be dropped at that env's teardown.
//!
//! Each successful registration pushes one [`EnvRegistration`] and adds one env
//! cleanup hook whose arg is the record's id. The hook first takes the record out
//! of the list, so no lookup can find it any more, and only then deletes the
//! references it holds. Below Node-API 3 there is no cleanup hook; a strongly
//! referenced external plays its part, because the env runs its finalizer at
//! teardown (see [`begin`]).
//!
//! Ids start at 1 and are never reused, so the `(fn, arg)` pair handed to
//! `napi_add_env_cleanup_hook` is unique even if an embedder registers the
//! module twice into the same env. A record is always removed before its env is
//! freed, so a new env that reuses a freed env's address can never match a stale
//! record.

use std::cell::RefCell;
use std::collections::HashMap;
#[cfg(all(
  not(feature = "noop"),
  any(feature = "napi3", not(target_family = "wasm"))
))]
use std::os::raw::c_void;
use std::sync::atomic::{AtomicUsize, Ordering};
#[cfg(all(feature = "napi4", not(feature = "noop")))]
use std::sync::Arc;

use rustc_hash::FxBuildHasher;

#[cfg(all(feature = "napi4", not(feature = "noop")))]
use crate::bindgen_runtime::module_register::CustomGcHandle;
use crate::sys;

/// Identifies one registration of this addon into one env. Starts at 1 and is
/// never reused.
pub(crate) type RegistrationId = usize;

#[cfg(not(feature = "noop"))]
static NEXT_REGISTRATION_ID: AtomicUsize = AtomicUsize::new(1);

/// One load's class constructor references, keyed by the class's JS name with its
/// trailing NUL (the key generated code passes).
pub(crate) type ClassConstructors = HashMap<&'static str, sys::napi_ref, FxBuildHasher>;

/// How many cached `Reflect` holder references env teardown has deleted, across
/// every env of this process.
static REFLECT_REFS_DELETED: AtomicUsize = AtomicUsize::new(0);

/// How many custom-GC threadsafe functions env teardown has released, across
/// every env of this process.
static CUSTOM_GC_RELEASED: AtomicUsize = AtomicUsize::new(0);

/// How many class constructor references env teardown has deleted, across every
/// env of this process.
static CLASS_REFS_DELETED: AtomicUsize = AtomicUsize::new(0);

/// What napi-rs keeps for one registration of this addon into one env.
// Under `noop` nothing registers, so no record is ever built.
#[cfg_attr(feature = "noop", allow(dead_code))]
pub(crate) struct EnvRegistration {
  id: RegistrationId,
  env: sys::napi_env,
  /// Holder object for the env's `Reflect` / `Reflect.getOwnPropertyDescriptor`
  /// pair, see `crate::error::cache_reflect_intrinsics_for_env`.
  reflect_intrinsics: Option<sys::napi_ref>,
  /// This env's custom-GC threadsafe function, see
  /// `crate::bindgen_runtime::module_register::create_custom_gc`. The record
  /// holds a strong `Arc`, so teardown can always reach the function to release
  /// it, even when no value captured the handle.
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  custom_gc: Option<Arc<CustomGcHandle>>,
  /// The constructor reference of every `#[napi]` class this load defined in
  /// `env`. Class lookups of generated code read them by env (see
  /// [`class_constructor_in_env`]), so each load builds and checks its own classes.
  classes: ClassConstructors,
  /// Strong reference to the external whose finalizer observes this env's
  /// teardown below Node-API 3 (see [`begin`]). It is a userland reference, which
  /// the env never frees, so teardown deletes it.
  #[cfg(all(
    not(feature = "napi3"),
    not(feature = "noop"),
    not(target_family = "wasm")
  ))]
  sentinel_ref: sys::napi_ref,
}

thread_local! {
  // In registration order: the newest record is the last one. Records are only
  // ever touched on their env's own thread (registration, the cleanup hook, and
  // lookups from calls into that env all run there).
  static ENV_REGISTRATIONS: RefCell<Vec<EnvRegistration>> = const { RefCell::new(Vec::new()) };
}

/// Starts a registration of this addon into `env`: sets up what will tear the
/// record down at `env`'s teardown, then records it.
///
/// - Node-API 3 and up: one env cleanup hook, whose arg is the record's id.
/// - Below Node-API 3, native: there is no cleanup hook, so a strongly referenced
///   external stands in for it. The env runs the finalizers of the externals it
///   still holds when it is torn down (before it finalizes plain references, so
///   the finalizer may still delete them), and the strong reference keeps this one
///   from being collected before that.
/// - Below Node-API 3, wasm: nothing can observe teardown (a strongly referenced
///   external would keep the whole emnapi instance alive). Each wasm instance has
///   its own memory and registers once, so the new record just replaces every
///   earlier one on this thread, and nothing that needs deleting is cached.
///
/// Returns `None` when teardown cannot be observed: the hook (or the external)
/// could not be added. In that case nothing is recorded, and the load must fail,
/// because nothing would ever delete what it caches.
///
/// Call it after `create_custom_gc` and before the first module-init callback:
/// hooks run newest first, so this record then outlives every hook that the
/// module's exports add, and is gone before Node's own custom-GC TSFN cleanup.
#[cfg(not(feature = "noop"))]
pub(crate) fn begin(env: sys::napi_env) -> Option<RegistrationId> {
  let id = NEXT_REGISTRATION_ID.fetch_add(1, Ordering::Relaxed);
  #[cfg(feature = "napi3")]
  {
    #[cfg(not(target_family = "wasm"))]
    let status = unsafe {
      sys::napi_add_env_cleanup_hook(env, Some(env_registration_cleanup), id as *mut c_void)
    };
    // `sys::` would import the symbol from the `env` wasm module; emnapi provides it
    // under `napi` (see `crate::napi_add_env_cleanup_hook`). emnapi runs the hook
    // from `Context.destroy()`.
    #[cfg(target_family = "wasm")]
    let status = unsafe {
      crate::napi_add_env_cleanup_hook(env, Some(env_registration_cleanup), id as *mut c_void)
    };
    if status != sys::Status::napi_ok {
      return None;
    }
    // The hook stays added either way; finding no record, it does nothing.
    push_registration(new_registration(id, env)).then_some(id)
  }
  #[cfg(all(not(feature = "napi3"), not(target_family = "wasm")))]
  {
    use std::ptr;
    let mut sentinel = ptr::null_mut();
    let mut sentinel_ref = ptr::null_mut();
    let observed = unsafe {
      sys::napi_create_external(
        env,
        id as *mut c_void,
        Some(env_registration_finalize),
        ptr::null_mut(),
        &mut sentinel,
      ) == sys::Status::napi_ok
        && sys::napi_create_reference(env, sentinel, 1, &mut sentinel_ref) == sys::Status::napi_ok
    };
    // Without the strong reference the external is collected some time later, and
    // its finalizer, finding no record, does nothing.
    if !observed {
      return None;
    }
    let mut registration = new_registration(id, env);
    registration.sentinel_ref = sentinel_ref;
    if push_registration(registration) {
      Some(id)
    } else {
      unsafe { sys::napi_delete_reference(env, sentinel_ref) };
      None
    }
  }
  #[cfg(all(not(feature = "napi3"), target_family = "wasm"))]
  {
    ENV_REGISTRATIONS
      .try_with(|registrations| {
        let mut registrations = registrations.try_borrow_mut().ok()?;
        // Dropped without deleting anything: they belong to envs this instance no
        // longer serves, and dropping them keeps a reused env address from
        // matching a stale record.
        registrations.clear();
        registrations.push(new_registration(id, env));
        Some(id)
      })
      .ok()
      .flatten()
  }
}

/// An empty record for `id` in `env`.
#[cfg(not(feature = "noop"))]
fn new_registration(id: RegistrationId, env: sys::napi_env) -> EnvRegistration {
  EnvRegistration {
    id,
    env,
    reflect_intrinsics: None,
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    custom_gc: None,
    classes: ClassConstructors::default(),
    #[cfg(all(
      not(feature = "napi3"),
      not(feature = "noop"),
      not(target_family = "wasm")
    ))]
    sentinel_ref: std::ptr::null_mut(),
  }
}

/// Appends `registration` as the newest record. `false` when the thread-local is
/// gone or busy.
#[cfg(all(
  not(feature = "noop"),
  any(feature = "napi3", not(target_family = "wasm"))
))]
fn push_registration(registration: EnvRegistration) -> bool {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let Ok(mut registrations) = registrations.try_borrow_mut() else {
        return false;
      };
      registrations.push(registration);
      true
    })
    .unwrap_or(false)
}

/// Env cleanup hook added by [`begin`]. `arg` is the registration id.
///
/// Runs on the env's own thread while the env can still delete references.
#[cfg(all(not(feature = "noop"), feature = "napi3"))]
unsafe extern "C" fn env_registration_cleanup(arg: *mut c_void) {
  // The borrow ends inside `take_registration`, before any napi call below.
  let Some(registration) = take_registration(arg as RegistrationId) else {
    return;
  };
  unsafe { release_registration(registration) };
}

/// Finalizer of the external that [`begin`] adds below Node-API 3. `data` is the
/// registration id. The strong reference to the external means it runs only when
/// the env is torn down, on the env's own thread. The env runs these finalizers
/// before it finalizes plain references, so deleting references here is allowed.
#[cfg(all(
  not(feature = "napi3"),
  not(feature = "noop"),
  not(target_family = "wasm")
))]
unsafe extern "C" fn env_registration_finalize(
  _env: sys::napi_env,
  data: *mut c_void,
  _hint: *mut c_void,
) {
  let Some(registration) = take_registration(data as RegistrationId) else {
    return;
  };
  unsafe { release_registration(registration) };
}

/// Removes the record with `id`, so that no lookup can find it any more.
#[cfg(all(
  not(feature = "noop"),
  any(feature = "napi3", not(target_family = "wasm"))
))]
fn take_registration(id: RegistrationId) -> Option<EnvRegistration> {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let mut registrations = registrations.try_borrow_mut().ok()?;
      let position = registrations
        .iter()
        .position(|registration| registration.id == id)?;
      // `remove`, not `swap_remove`: the newest-last order must be kept.
      Some(registrations.remove(position))
    })
    .ok()
    .flatten()
}

/// Deletes every reference a record held. The record must already be out of
/// the list (see [`take_registration`]), so nothing can look these up again.
///
/// # Safety
///
/// Must run on `registration.env`'s thread while that env is still alive.
#[cfg(all(
  not(feature = "noop"),
  any(feature = "napi3", not(target_family = "wasm"))
))]
unsafe fn release_registration(registration: EnvRegistration) {
  // Release the custom-GC threadsafe function first-hand: its initial thread
  // count is 1 and nothing else ever releases it. The hook runs before Node's
  // own cleanup for that function (hooks run newest first, and the function was
  // created before this record's hook was added), so the function is still
  // open: the release only drops the thread count to 0. Node's cleanup then
  // closes it and, with the count at 0, frees it. Without this, Node >= 24.13.1,
  // >= 25.4.0 and emnapi keep the function alive forever (their final delete is
  // gated on a zero thread count); older Node frees it either way.
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  if let Some(handle) = registration.custom_gc {
    if handle.abort_and_release(sys::ThreadsafeFunctionReleaseMode::release) == sys::Status::napi_ok
    {
      CUSTOM_GC_RELEASED.fetch_add(1, Ordering::Relaxed);
    }
  }
  // `napi_delete_reference` does not throw, on Node or on emnapi, so there is no
  // pending exception to clear.
  for reference in registration.classes.into_values() {
    if unsafe { sys::napi_delete_reference(registration.env, reference) } == sys::Status::napi_ok {
      CLASS_REFS_DELETED.fetch_add(1, Ordering::Relaxed);
    }
  }
  if let Some(reference) = registration.reflect_intrinsics {
    if unsafe { sys::napi_delete_reference(registration.env, reference) } == sys::Status::napi_ok {
      REFLECT_REFS_DELETED.fetch_add(1, Ordering::Relaxed);
    }
  }
  #[cfg(all(
    not(feature = "napi3"),
    not(feature = "noop"),
    not(target_family = "wasm")
  ))]
  unsafe {
    sys::napi_delete_reference(registration.env, registration.sentinel_ref)
  };
}

/// Stores the `Reflect` holder reference in the record with `id`.
///
/// Returns `false` when the record is gone or already has one, or on wasm below
/// Node-API 3; the caller then still owns `reference` and must delete it.
#[cfg(not(feature = "noop"))]
pub(crate) fn set_reflect_intrinsics(id: RegistrationId, reference: sys::napi_ref) -> bool {
  // Nothing observes teardown on wasm below Node-API 3 (see [`begin`]), so
  // nothing would ever delete the reference: cache nothing there.
  if cfg!(all(not(feature = "napi3"), target_family = "wasm")) {
    return false;
  }
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let Ok(mut registrations) = registrations.try_borrow_mut() else {
        return false;
      };
      match registrations
        .iter_mut()
        .find(|registration| registration.id == id)
      {
        Some(registration) if registration.reflect_intrinsics.is_none() => {
          registration.reflect_intrinsics = Some(reference);
          true
        }
        _ => false,
      }
    })
    .unwrap_or(false)
}

/// Stores this load's class constructor references in the record with `id`.
///
/// Gives them back when the record is gone or already has classes; the caller
/// then still owns them and must delete them.
#[cfg(not(feature = "noop"))]
pub(crate) fn set_classes(
  id: RegistrationId,
  classes: ClassConstructors,
) -> Result<(), ClassConstructors> {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let Ok(mut registrations) = registrations.try_borrow_mut() else {
        return Err(classes);
      };
      match registrations
        .iter_mut()
        .find(|registration| registration.id == id)
      {
        Some(registration) if registration.classes.is_empty() => {
          registration.classes = classes;
          Ok(())
        }
        _ => Err(classes),
      }
    })
    // The thread-local is gone, which only happens while this thread exits: the
    // closure (and `classes` with it) was never run, so nothing to give back.
    .unwrap_or(Ok(()))
}

/// Stores the custom-GC handle in the record with `id`.
///
/// Gives the handle back when the record is gone or already has one; the caller
/// then still owns it and must release it.
#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn set_custom_gc(
  id: RegistrationId,
  handle: Arc<CustomGcHandle>,
) -> Result<(), Arc<CustomGcHandle>> {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let Ok(mut registrations) = registrations.try_borrow_mut() else {
        return Err(handle);
      };
      match registrations
        .iter_mut()
        .find(|registration| registration.id == id)
      {
        Some(registration) if registration.custom_gc.is_none() => {
          registration.custom_gc = Some(handle);
          Ok(())
        }
        _ => Err(handle),
      }
    })
    // The thread-local is gone, which only happens while this thread exits:
    // the closure (and `handle` with it) was never run, so nothing to give back.
    .unwrap_or(Ok(()))
}

/// The custom-GC handle of `env`, from its newest live record.
///
/// `None` when `env` has no live record (never registered, already torn down)
/// or no handle.
#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn custom_gc(env: sys::napi_env) -> Option<Arc<CustomGcHandle>> {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let registrations = registrations.try_borrow().ok()?;
      registrations
        .iter()
        .rev()
        .find(|registration| registration.env == env)?
        .custom_gc
        .clone()
    })
    .ok()
    .flatten()
}

/// Whether a live record on this thread holds exactly `handle`, that is, whether
/// this thread is the JavaScript thread of `handle`'s env and that env is not
/// torn down yet. Compares allocations, so it is immune to env-pointer reuse.
#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn holds_custom_gc(handle: &Arc<CustomGcHandle>) -> bool {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let Ok(registrations) = registrations.try_borrow() else {
        return false;
      };
      registrations.iter().any(|registration| {
        registration
          .custom_gc
          .as_ref()
          .is_some_and(|held| Arc::ptr_eq(held, handle))
      })
    })
    .unwrap_or(false)
}

/// The cached `Reflect` holder reference of `env`, from its newest live record.
///
/// `None` when `env` has no live record (never registered, already torn down,
/// or a build that cannot observe teardown) or no cache.
pub(crate) fn reflect_intrinsics(env: sys::napi_env) -> Option<sys::napi_ref> {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let registrations = registrations.try_borrow().ok()?;
      registrations
        .iter()
        .rev()
        .find(|registration| registration.env == env)?
        .reflect_intrinsics
    })
    .ok()
    .flatten()
}

/// The constructor reference of class `js_name` in `env`, from `env`'s newest
/// live record.
///
/// `None` when `env` has no live record (never registered, already torn down) or
/// that load defined no such class. Never falls back to another env's classes.
pub(crate) fn class_constructor_in_env(
  env: sys::napi_env,
  js_name: &'static str,
) -> Option<sys::napi_ref> {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let registrations = registrations.try_borrow().ok()?;
      registrations
        .iter()
        .rev()
        .find(|registration| registration.env == env)?
        .classes
        .get(js_name)
        .copied()
    })
    .ok()
    .flatten()
}

/// The constructor reference of class `js_name` from the newest live record on
/// this thread that has one, whatever its env.
pub(crate) fn class_constructor_on_thread(js_name: &'static str) -> Option<sys::napi_ref> {
  ENV_REGISTRATIONS
    .try_with(|registrations| {
      let registrations = registrations.try_borrow().ok()?;
      registrations
        .iter()
        .rev()
        .find_map(|registration| registration.classes.get(js_name).copied())
    })
    .ok()
    .flatten()
}

/// How many cached `Reflect` holder references env teardown has deleted in this
/// process, across every env and every load of this addon.
///
/// Introspection hook for napi-rs' own tests. No stability guarantee.
#[doc(hidden)]
pub fn env_teardown_reflect_refs_deleted() -> usize {
  REFLECT_REFS_DELETED.load(Ordering::Relaxed)
}

/// How many custom-GC threadsafe functions env teardown has released in this
/// process, across every env and every load of this addon.
///
/// Introspection hook for napi-rs' own tests. No stability guarantee.
#[doc(hidden)]
pub fn env_teardown_custom_gc_released() -> usize {
  CUSTOM_GC_RELEASED.load(Ordering::Relaxed)
}

/// How many class constructor references env teardown has deleted in this
/// process, across every env and every load of this addon.
///
/// Introspection hook for napi-rs' own tests. No stability guarantee.
#[doc(hidden)]
pub fn env_teardown_class_refs_deleted() -> usize {
  CLASS_REFS_DELETED.load(Ordering::Relaxed)
}
