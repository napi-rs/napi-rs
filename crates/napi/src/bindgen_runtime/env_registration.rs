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
//! references it holds.
//!
//! Ids start at 1 and are never reused, so the `(fn, arg)` pair handed to
//! `napi_add_env_cleanup_hook` is unique even if an embedder registers the
//! module twice into the same env. A record is always removed before its env is
//! freed, so a new env that reuses a freed env's address can never match a stale
//! record.

use std::cell::RefCell;
#[cfg(all(not(feature = "noop"), feature = "napi3"))]
use std::os::raw::c_void;
use std::sync::atomic::{AtomicUsize, Ordering};
#[cfg(all(feature = "napi4", not(feature = "noop")))]
use std::sync::Arc;

#[cfg(all(feature = "napi4", not(feature = "noop")))]
use crate::bindgen_runtime::module_register::CustomGcHandle;
use crate::sys;

/// Identifies one registration of this addon into one env. Starts at 1 and is
/// never reused.
pub(crate) type RegistrationId = usize;

#[cfg(all(not(feature = "noop"), feature = "napi3"))]
static NEXT_REGISTRATION_ID: AtomicUsize = AtomicUsize::new(1);

/// How many cached `Reflect` holder references env teardown has deleted, across
/// every env of this process.
static REFLECT_REFS_DELETED: AtomicUsize = AtomicUsize::new(0);

/// How many custom-GC threadsafe functions env teardown has released, across
/// every env of this process.
static CUSTOM_GC_RELEASED: AtomicUsize = AtomicUsize::new(0);

/// What napi-rs keeps for one registration of this addon into one env.
// Under `noop`, or below Node-API 3, nothing registers yet, so no record is
// ever built.
#[cfg_attr(any(feature = "noop", not(feature = "napi3")), allow(dead_code))]
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
}

thread_local! {
  // In registration order: the newest record is the last one. Records are only
  // ever touched on their env's own thread (registration, the cleanup hook, and
  // lookups from calls into that env all run there).
  static ENV_REGISTRATIONS: RefCell<Vec<EnvRegistration>> = const { RefCell::new(Vec::new()) };
}

/// Starts a registration of this addon into `env`: adds the env cleanup hook
/// that will tear the record down, then records it.
///
/// Returns `None` when teardown cannot be observed: the hook could not be added,
/// or the build targets Node-API below 3, where the hook does not exist. In that
/// case nothing is recorded, and callers must not cache anything for `env`,
/// because nothing would ever delete it.
///
/// Call it after `create_custom_gc` and before the first module-init callback:
/// hooks run newest first, so this record then outlives every hook that the
/// module's exports add, and is gone before Node's own custom-GC TSFN cleanup.
#[cfg(not(feature = "noop"))]
pub(crate) fn begin(env: sys::napi_env) -> Option<RegistrationId> {
  #[cfg(feature = "napi3")]
  {
    let id = NEXT_REGISTRATION_ID.fetch_add(1, Ordering::Relaxed);
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
    let pushed = ENV_REGISTRATIONS
      .try_with(|registrations| {
        let Ok(mut registrations) = registrations.try_borrow_mut() else {
          return false;
        };
        registrations.push(EnvRegistration {
          id,
          env,
          reflect_intrinsics: None,
          #[cfg(all(feature = "napi4", not(feature = "noop")))]
          custom_gc: None,
        });
        true
      })
      .unwrap_or(false);
    // The hook stays added either way; finding no record, it does nothing.
    pushed.then_some(id)
  }
  #[cfg(not(feature = "napi3"))]
  {
    let _ = env;
    None
  }
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

/// Removes the record with `id`, so that no lookup can find it any more.
#[cfg(not(feature = "noop"))]
#[cfg_attr(not(feature = "napi3"), allow(dead_code))]
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
#[cfg(not(feature = "noop"))]
#[cfg_attr(not(feature = "napi3"), allow(dead_code))]
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
  if let Some(reference) = registration.reflect_intrinsics {
    // `napi_delete_reference` does not throw, on Node or on emnapi, so there is
    // no pending exception to clear.
    if unsafe { sys::napi_delete_reference(registration.env, reference) } == sys::Status::napi_ok {
      REFLECT_REFS_DELETED.fetch_add(1, Ordering::Relaxed);
    }
  }
}

/// Stores the `Reflect` holder reference in the record with `id`.
///
/// Returns `false` when the record is gone or already has one; the caller then
/// still owns `reference` and must delete it.
#[cfg(not(feature = "noop"))]
pub(crate) fn set_reflect_intrinsics(id: RegistrationId, reference: sys::napi_ref) -> bool {
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
