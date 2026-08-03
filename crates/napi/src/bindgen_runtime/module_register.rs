use std::cell::{LazyCell, RefCell};
#[cfg(not(feature = "noop"))]
use std::collections::HashSet;
#[cfg(not(feature = "noop"))]
use std::ffi::CStr;
#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
use std::mem::MaybeUninit;
#[cfg(not(feature = "noop"))]
use std::ptr;
#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
use std::sync::OnceLock;
#[cfg(not(feature = "noop"))]
use std::sync::{
  atomic::{AtomicBool, AtomicUsize, Ordering},
  LazyLock, RwLock,
};
use std::{any::TypeId, collections::HashMap};

use rustc_hash::FxBuildHasher;

#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
use crate::NodeVersion;
#[cfg(not(feature = "noop"))]
use crate::{check_status, check_status_or_throw, JsError};
use crate::{sys, Property, Result};

// #[napi] fn
pub type ExportRegisterCallback = unsafe fn(sys::napi_env) -> Result<sys::napi_value>;
// #[napi(module_exports)] fn
pub type ExportRegisterHookCallback =
  unsafe fn(sys::napi_env, sys::napi_value) -> Result<sys::napi_value>;
pub type ModuleExportsCallback =
  unsafe fn(env: sys::napi_env, exports: sys::napi_value) -> Result<()>;

#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
pub static NODE_VERSION: OnceLock<NodeVersion> = OnceLock::new();

#[cfg(feature = "node_version_detect")]
pub static mut NODE_VERSION_MAJOR: u32 = 0;
#[cfg(feature = "node_version_detect")]
pub static mut NODE_VERSION_MINOR: u32 = 0;
#[cfg(feature = "node_version_detect")]
pub static mut NODE_VERSION_PATCH: u32 = 0;

#[repr(transparent)]
pub(crate) struct PersistedPerInstanceHashMap<K, V, S>(RefCell<HashMap<K, V, S>>);

impl<K, V, S> PersistedPerInstanceHashMap<K, V, S> {
  #[allow(clippy::mut_from_ref)]
  pub(crate) fn borrow_mut<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&mut HashMap<K, V, S>) -> R,
  {
    f(&mut *self.0.borrow_mut())
  }
}

impl<K, V, S: Default> Default for PersistedPerInstanceHashMap<K, V, S> {
  fn default() -> Self {
    Self(RefCell::new(HashMap::<K, V, S>::default()))
  }
}

#[cfg(not(feature = "noop"))]
type ModuleRegisterCallback =
  RwLock<Vec<(Option<&'static str>, (&'static str, ExportRegisterCallback))>>;

#[cfg(not(feature = "noop"))]
type ClassPropertyRegistry =
  HashMap<TypeId, HashMap<Option<&'static str>, ClassRegistration, FxBuildHasher>, FxBuildHasher>;

#[cfg(not(feature = "noop"))]
struct ClassRegistration {
  js_name: &'static str,
  props: Vec<Property>,
  implement_iterator: bool,
  /// This class's own type tag (issue #1164). Derived purely from the Rust
  /// type. Only the struct-level registration supplies `Some` (it is emitted
  /// right next to the class's `TypeTag` impl); impl-level registrations pass
  /// `None`, since a type may have a `#[napi] impl` block without being a
  /// `#[napi]` struct that implements `TypeTag`. Every registration that does
  /// supply `Some` must agree.
  own_tag: Option<sys::napi_type_tag>,
  /// The parent class's type tag, if this class declares `#[napi(extends = P)]`.
  /// Only the struct-level registration carries `Some`; impl-level registrations
  /// pass `None` and never clobber an existing `Some` (see `register_class`).
  parent_tag: Option<sys::napi_type_tag>,
  /// Set (and never cleared) if two registrations for this `TypeId` disagreed on
  /// `own_tag` — structurally impossible today, but the hierarchy build fails
  /// closed on it rather than silently trusting whichever ran first.
  own_tag_conflict: bool,
  /// Set (and never cleared) if two registrations each supplied a *different*
  /// `Some(parent_tag)` for this `TypeId`. The hierarchy build fails closed.
  parent_tag_conflict: bool,
}

// Stores class metadata registered by napi macros.
// Since class properties do not contain any napi_value, ModuleClassProperty is thread-safe.
// This structure is shared between the main JS thread and worker threads.
#[cfg(not(feature = "noop"))]
#[derive(Default)]
struct ModuleClassProperty(RwLock<ClassPropertyRegistry>);

#[cfg(not(feature = "noop"))]
unsafe impl Send for ModuleClassProperty {}
#[cfg(not(feature = "noop"))]
unsafe impl Sync for ModuleClassProperty {}

#[cfg(not(feature = "noop"))]
impl ModuleClassProperty {
  pub(crate) fn borrow_mut<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&mut ClassPropertyRegistry) -> R,
  {
    let mut write_lock = self.0.write().unwrap();
    f(&mut write_lock)
  }

  pub(crate) fn borrow<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&ClassPropertyRegistry) -> R,
  {
    let write_lock = self.0.read().unwrap();
    f(&write_lock)
  }
}

#[cfg(not(feature = "noop"))]
static MODULE_REGISTER_CALLBACK: LazyLock<ModuleRegisterCallback> = LazyLock::new(Default::default);
#[cfg(not(feature = "noop"))]
static MODULE_REGISTER_HOOK_CALLBACK: LazyLock<RwLock<Option<ExportRegisterHookCallback>>> =
  LazyLock::new(Default::default);
#[cfg(not(feature = "noop"))]
static MODULE_CLASS_PROPERTIES: LazyLock<ModuleClassProperty> = LazyLock::new(Default::default);
#[cfg(not(feature = "noop"))]
static MODULE_COUNT: AtomicUsize = AtomicUsize::new(0);
#[cfg(not(feature = "noop"))]
static FIRST_MODULE_REGISTERED: AtomicBool = AtomicBool::new(false);
/// Monotonic, never-dereferenced cookie handed to each `thread_cleanup` env-cleanup-hook
/// registration. The same addon can be (re)loaded into the *same* env (see `unload.spec.js`),
/// and Node's `napi_add_env_cleanup_hook` asserts every `(fn, arg)` pair is unique within an
/// env — so a shared `null` arg would abort on the second load. A distinct cookie per
/// registration keeps the pairs unique; `thread_cleanup` ignores the value.
#[cfg(all(
  any(feature = "tokio_rt", feature = "async-runtime"),
  not(target_family = "wasm"),
  not(feature = "noop")
))]
static ENV_CLEANUP_HOOK_COOKIE: AtomicUsize = AtomicUsize::new(1);
thread_local! {
  static REGISTERED_CLASSES: LazyCell<RegisteredClasses> = LazyCell::new(Default::default);
}
// Per-env custom-GC infrastructure (#3357). One `CustomGcHandle` is created + unref'd per isolate in
// `create_custom_gc`, and every Buffer/TypedArray drop routes through it.
// `AtomicPtr<_>` + `RwLock<bool>` are auto `Send + Sync`, so no `unsafe impl` is required.
// No `impl Drop`: freeing the `Arc` touches zero Node/V8 resources; Node owns the TSFN (created +
// unref'd at module load, destroyed at env teardown which fires `custom_gc_handle_finalize`).
#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) struct CustomGcHandle {
  tsfn: std::sync::atomic::AtomicPtr<sys::napi_threadsafe_function__>,
  aborted: std::sync::RwLock<bool>,
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
impl CustomGcHandle {
  pub(crate) fn get_raw(&self) -> sys::napi_threadsafe_function {
    self.tsfn.load(std::sync::atomic::Ordering::SeqCst)
  }
  // drop path: read-lock held ACROSS the napi_call so finalize's write-lock blocks until the call returns
  pub(crate) fn with_read_aborted<RT>(&self, f: impl FnOnce(bool) -> RT) -> RT {
    let g = self
      .aborted
      .read()
      .expect("custom gc aborted lock poisoned");
    f(*g)
  }
  fn set_aborted(&self) {
    *self
      .aborted
      .write()
      .expect("custom gc aborted lock poisoned") = true;
  }
}

// INVARIANT: this per-OS-thread slot relies on ONE `napi_env` per OS thread, which holds for every
// supported runtime — Node's main thread, each `worker_threads` worker (its own V8 isolate + env +
// loop thread), and Electron. `create_custom_gc` installs the handle once per env on its registering
// thread, and `FromNapiValue` always runs on that same thread for that env, so a captured handle is
// always the value's OWNING env. An embedder hosting multiple `napi_env` on a single shared OS thread
// is out of scope: the per-env `Arc` identity (see `current_thread_owns_custom_gc`) is immune to
// env-pointer reuse, and the single public `Env::set_instance_data` slot is reserved for addon authors
// so it cannot be co-opted to key the handle by env.
thread_local! {
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  // Per-thread "this isolate's custom-GC handle".
  pub(crate) static CURRENT_CUSTOM_GC_HANDLE:
    std::cell::RefCell<Option<std::sync::Arc<CustomGcHandle>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn current_custom_gc_handle() -> Option<std::sync::Arc<CustomGcHandle>> {
  // clone = one refcount inc, at from_napi_value capture
  CURRENT_CUSTOM_GC_HANDLE.with(|c| c.borrow().clone())
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn current_thread_owns_custom_gc(handle: &std::sync::Arc<CustomGcHandle>) -> bool {
  // same-isolate-JS-thread test by ALLOCATION identity (immune to env-pointer reuse).
  // `is_some_and` (NOT `map_or(false, ..)`): clippy::unnecessary_map_or is denied by
  // `#![deny(clippy::all)]` and would turn CI's `cargo clippy` red.
  CURRENT_CUSTOM_GC_HANDLE.with(|c| {
    c.borrow()
      .as_ref()
      .is_some_and(|cur| std::sync::Arc::ptr_eq(cur, handle))
  })
}

type RegisteredClasses = PersistedPerInstanceHashMap<
  /* export name */ String,
  /* constructor */ sys::napi_ref,
  FxBuildHasher,
>;

#[cfg(all(feature = "compat-mode", not(feature = "noop")))]
// compatibility for #[module_exports]
static MODULE_EXPORTS: LazyLock<RwLock<Vec<ModuleExportsCallback>>> =
  LazyLock::new(Default::default);

#[cfg(not(feature = "noop"))]
#[inline]
fn wait_first_thread_registered() {
  while !FIRST_MODULE_REGISTERED.load(Ordering::SeqCst) {
    std::hint::spin_loop();
  }
}

/// RAII guard that signals completion of the *first* module registration
/// (issue #1164). Constructed immediately after the `MODULE_COUNT.fetch_add`
/// that decides whether this is the first registration in the process; its
/// `Drop` sets `FIRST_MODULE_REGISTERED` — unblocking any worker spinning in
/// `wait_first_thread_registered` — on *every* exit from that point onward
/// (normal return, an early `return` after a thrown error, or a panic unwind).
///
/// This replaces the single explicit store at the end of the function, which
/// only ran if control reached it: a later failure (e.g. in the prototype-wiring
/// pass added in P5, which necessarily runs after `MODULE_COUNT` was already
/// incremented and other workers may be waiting) can now throw-and-return
/// immediately without leaving those workers blocked forever. Only the first
/// registration sets the gate; later ones already observed it as `true`.
#[cfg(not(feature = "noop"))]
struct FirstRegistrationGuard {
  is_first: bool,
}

#[cfg(not(feature = "noop"))]
impl Drop for FirstRegistrationGuard {
  fn drop(&mut self) {
    if self.is_first {
      FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
    }
  }
}

#[doc(hidden)]
#[cfg(all(feature = "compat-mode", not(feature = "noop")))]
// compatibility for #[module_exports]
pub fn register_module_exports(callback: ModuleExportsCallback) {
  MODULE_EXPORTS
    .write()
    .expect("Register module exports failed")
    .push(callback);
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn register_module_exports(_: ModuleExportsCallback) {}

#[cfg(not(feature = "noop"))]
#[doc(hidden)]
pub fn register_module_export(
  js_mod: Option<&'static str>,
  name: &'static str,
  cb: ExportRegisterCallback,
) {
  MODULE_REGISTER_CALLBACK
    .write()
    .expect("Register module export failed")
    .push((js_mod, (name, cb)));
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn register_module_export(
  _js_mod: Option<&'static str>,
  _name: &'static str,
  _cb: ExportRegisterCallback,
) {
}

#[cfg(not(feature = "noop"))]
#[doc(hidden)]
pub fn register_module_export_hook(cb: ExportRegisterHookCallback) {
  let mut inner = MODULE_REGISTER_HOOK_CALLBACK
    .write()
    .expect("Write MODULE_REGISTER_HOOK_CALLBACK failed");
  *inner = Some(cb);
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn register_module_export_hook(_cb: ExportRegisterHookCallback) {}

#[doc(hidden)]
pub fn get_class_constructor(js_name: &'static str) -> Option<sys::napi_ref> {
  REGISTERED_CLASSES.with(|cell| cell.borrow_mut(|map| map.get(js_name).copied()))
}

#[cfg(not(feature = "noop"))]
#[doc(hidden)]
pub fn register_class(
  rust_type_id: TypeId,
  js_mod: Option<&'static str>,
  js_name: &'static str,
  props: Vec<Property>,
  implement_iterator: bool,
  own_tag: Option<sys::napi_type_tag>,
  parent_tag: Option<sys::napi_type_tag>,
) {
  MODULE_CLASS_PROPERTIES.borrow_mut(|inner| {
    let val = inner.entry(rust_type_id).or_default();
    match val.entry(js_mod) {
      std::collections::hash_map::Entry::Vacant(entry) => {
        entry.insert(ClassRegistration {
          js_name,
          props,
          implement_iterator,
          own_tag,
          parent_tag,
          own_tag_conflict: false,
          parent_tag_conflict: false,
        });
      }
      std::collections::hash_map::Entry::Occupied(mut entry) => {
        // A class can be registered more than once for the same `TypeId`/`js_mod`
        // (a struct-level registration for its fields, plus an impl-level one for
        // its methods). Merge, preserving conflict evidence rather than letting
        // a later registration silently overwrite an earlier disagreement.
        // Both `own_tag` and `parent_tag` follow the same rule: a `None` incoming
        // value never clobbers an existing `Some` (the impl-level site always
        // passes `None` for both); a `Some` fills a `None`; two differing `Some`s
        // are a preserved conflict the hierarchy build fails closed on.
        let val = entry.get_mut();
        val.js_name = js_name;
        val.implement_iterator |= implement_iterator;
        val.props.extend(props);
        match (val.own_tag, own_tag) {
          (None, Some(_)) => val.own_tag = own_tag,
          (Some(existing), Some(incoming)) if existing != incoming => {
            val.own_tag_conflict = true;
          }
          _ => {}
        }
        match (val.parent_tag, parent_tag) {
          (None, Some(_)) => val.parent_tag = parent_tag,
          (Some(existing), Some(incoming)) if existing != incoming => {
            val.parent_tag_conflict = true;
          }
          _ => {}
        }
      }
    }
  });
}

#[cfg(feature = "noop")]
#[doc(hidden)]
#[allow(unused_variables)]
pub fn register_class(
  rust_type_id: TypeId,
  js_mod: Option<&'static str>,
  js_name: &'static str,
  props: Vec<Property>,
  implement_iterator: bool,
  own_tag: Option<sys::napi_type_tag>,
  parent_tag: Option<sys::napi_type_tag>,
) {
}

// ---------------------------------------------------------------------------
// Class inheritance (issue #1164) — ancestry graph.
//
// `build_hierarchy` is a *pure* function over a plain slice of per-class
// metadata: it takes no locks and reads no globals, so it is fully unit-
// testable in isolation. The snapshot is assembled from the merged
// `ClassRegistration` values (and the actual `get_or_init` invocation) in
// P4.5; this phase only defines the data types and the pure builder.
// ---------------------------------------------------------------------------

/// One registered `#[napi]` class's inheritance-relevant metadata, exactly one
/// entry per Rust `TypeId`. Only classes that actually carry a type tag
/// (`own_tag: Some` at the struct-level registration) become an entry — pure
/// `#[napi] impl`-only types with no `TypeTag` are irrelevant to any hierarchy
/// and are filtered out during snapshot construction (P4.5).
#[cfg(not(feature = "noop"))]
#[derive(Clone, Copy)]
struct NativeClassMetadata {
  type_id: TypeId,
  own_tag: sys::napi_type_tag,
  parent_tag: Option<sys::napi_type_tag>,
  implement_iterator: bool,
  /// `own_tag_conflict || parent_tag_conflict` from the merged registration —
  /// two registrations for one `TypeId` disagreed on a tag. Fails the build.
  has_conflict: bool,
}

/// The computed inheritance graph, stored as **strict descendants only**:
/// `descendants[ancestor]` lists every tag that transitively extends
/// `ancestor`, never `ancestor` itself (the receiver-unwrap helper checks the
/// exact/self tag first, so self would only be checked twice). A leaf class
/// has no entry at all. Each descendant list is sorted by `(lower, upper)` for
/// deterministic diagnostics and tests.
#[cfg(not(feature = "noop"))]
#[allow(dead_code)] // read by P5's unwrap_borrowed_receiver + P8 gating.
#[derive(Debug)]
struct ClassHierarchy {
  descendants: HashMap<sys::napi_type_tag, Box<[sys::napi_type_tag]>>,
}

#[cfg(not(feature = "noop"))]
#[allow(dead_code)] // consumed by P4.5/P5/P8.
impl ClassHierarchy {
  /// The hierarchy for an addon with no `extends` edges at all.
  fn empty() -> Self {
    ClassHierarchy {
      descendants: HashMap::new(),
    }
  }

  /// True if any class (transitively) extends `tag` — i.e. `tag` is an
  /// extended base whose plain `BorrowedUpcast` methods P8 must route around
  /// V8's receiver signature.
  fn is_extended_base(&self, tag: &sys::napi_type_tag) -> bool {
    self.descendants.contains_key(tag)
  }

  /// True if `candidate` is a strict descendant of `base`.
  fn is_descendant(&self, base: &sys::napi_type_tag, candidate: &sys::napi_type_tag) -> bool {
    self
      .descendants
      .get(base)
      .is_some_and(|d| d.contains(candidate))
  }
}

/// The addon-wide class hierarchy, built exactly once (P4.5 wires the
/// `get_or_init` call). Stores the `Result` so the receiver-unwrap helper (P5)
/// can fail closed if the build itself failed. Fully qualified `OnceLock`
/// because the plain import is gated behind `node_version_detect`.
#[cfg(not(feature = "noop"))]
static CLASS_HIERARCHY: std::sync::OnceLock<std::result::Result<ClassHierarchy, String>> =
  std::sync::OnceLock::new();

/// Look up the strict descendants of `tag` for the borrowed-receiver upcast
/// (issue #1164), used by [`crate::bindgen_runtime::unwrap_borrowed_receiver`].
/// `Ok(None)` = `tag` is not an extended base (the common case — a leaf or a
/// class nobody extends). `Ok(Some(&[..]))` = its strict descendant tags. `Err`
/// = the hierarchy failed to build (fail closed), or — impossibly, since P4.5
/// builds it before any method can be dispatched — was never initialized.
#[cfg(all(not(feature = "noop"), feature = "napi8", not(target_family = "wasm")))]
pub(crate) fn class_descendants(
  tag: &sys::napi_type_tag,
) -> std::result::Result<Option<&'static [sys::napi_type_tag]>, &'static str> {
  match CLASS_HIERARCHY.get() {
    Some(Ok(hierarchy)) => Ok(hierarchy.descendants.get(tag).map(|d| &**d)),
    Some(Err(err)) => Err(err.as_str()),
    None => Err("class hierarchy was not initialized before class method dispatch"),
  }
}

/// `noop` stub: nothing is registered under `noop`, so there are never any
/// descendants. Mirrors the crate-wide `noop` stubbing convention.
#[cfg(all(feature = "noop", feature = "napi8", not(target_family = "wasm")))]
pub(crate) fn class_descendants(
  _tag: &sys::napi_type_tag,
) -> std::result::Result<Option<&'static [sys::napi_type_tag]>, &'static str> {
  Ok(None)
}

/// Wire the instance-side prototype chain for every `#[napi(extends)]` edge
/// (issue #1164): `Object.setPrototypeOf(Child.prototype, Parent.prototype)`.
/// Instance side **only** — never the constructor-level edge (an inherited
/// `#[napi(factory)]` uses the JS call-site's `this` as its constructor, and the
/// constructor-level `[[Prototype]]` slot also collides with iterator-class
/// wiring; see the architecture notes). Pure JS `Object.setPrototypeOf` (Node-API
/// has no set-prototype primitive), mirroring `setup_iterator_class`.
///
/// Every edge is resolved to a `(child_proto, parent_proto)` pair **before** any
/// prototype is mutated, so a resolution failure never leaves a half-wired chain.
/// Parent resolution prefers a registration in the child's own `js_mod`, else the
/// unique candidate, else fails as ambiguous. `parent_tag` is guaranteed present
/// in `prototypes_by_tag` because `build_hierarchy` already rejected any edge
/// whose parent is unregistered.
///
/// # Safety
/// `env` must be a valid napi env pointer; the `napi_value`s must be the live
/// class prototypes captured earlier in this same registration call.
#[cfg(not(feature = "noop"))]
unsafe fn wire_extends_prototypes(
  env: sys::napi_env,
  prototypes_by_tag: &HashMap<sys::napi_type_tag, Vec<(Option<&'static str>, sys::napi_value)>>,
  edges: &[(Option<&'static str>, sys::napi_type_tag, sys::napi_value)],
) -> Result<()> {
  let mut resolved: Vec<(sys::napi_value, sys::napi_value)> = Vec::with_capacity(edges.len());
  for (child_js_mod, parent_tag, child_proto) in edges {
    let candidates = prototypes_by_tag.get(parent_tag).ok_or_else(|| {
      crate::Error::from_reason(
        "internal error: #[napi(extends)] parent class prototype was not registered",
      )
    })?;
    let parent_proto = if candidates.len() == 1 {
      candidates[0].1
    } else if let Some((_, proto)) = candidates.iter().find(|(js_mod, _)| js_mod == child_js_mod) {
      *proto
    } else {
      return Err(crate::Error::from_reason(
        "ambiguous #[napi(extends)] parent: multiple registered parent classes share one type \
         tag across namespaces, and none matches the child's namespace",
      ));
    };
    resolved.push((*child_proto, parent_proto));
  }

  // Fetch `Object.setPrototypeOf` once (mirrors `setup_iterator_class`).
  let mut global = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_global(env, &mut global) },
    "Failed to get global object for #[napi(extends)] wiring"
  )?;
  let mut object_ctor = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_named_property(env, global, c"Object".as_ptr().cast(), &mut object_ctor)
    },
    "Failed to get Object constructor for #[napi(extends)] wiring"
  )?;
  let mut set_prototype_of = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_get_named_property(
        env,
        object_ctor,
        c"setPrototypeOf".as_ptr().cast(),
        &mut set_prototype_of,
      )
    },
    "Failed to get Object.setPrototypeOf for #[napi(extends)] wiring"
  )?;

  for (child_proto, parent_proto) in resolved {
    let mut argv = [child_proto, parent_proto];
    check_status!(
      unsafe {
        sys::napi_call_function(
          env,
          object_ctor,
          set_prototype_of,
          2,
          argv.as_mut_ptr(),
          ptr::null_mut(),
        )
      },
      "Failed to set #[napi(extends)] prototype chain"
    )?;
  }
  Ok(())
}

/// Collapse the registered-class table into one `NativeClassMetadata` per Rust
/// `TypeId`, the input `build_hierarchy` expects. A single `TypeId` normally has
/// exactly one `(js_mod)` registration (the struct-level and impl-level calls
/// already merged in `register_class`), but multiple `js_mod` entries are folded
/// here defensively: any disagreement on `own_tag`/`parent_tag` across them (or a
/// conflict already flagged at merge time) surfaces as `has_conflict`, which the
/// hierarchy build then fails closed on. Classes with no `own_tag` (pure
/// `#[napi] impl`-only types with no `TypeTag`) carry no tag identity and are
/// dropped — they cannot participate in any hierarchy.
#[cfg(not(feature = "noop"))]
fn snapshot_registered_classes(inner: &ClassPropertyRegistry) -> Vec<NativeClassMetadata> {
  inner
    .iter()
    .filter_map(|(type_id, js_mods)| {
      let mut own_tag: Option<sys::napi_type_tag> = None;
      let mut parent_tag: Option<sys::napi_type_tag> = None;
      let mut implement_iterator = false;
      let mut has_conflict = false;
      for reg in js_mods.values() {
        has_conflict |= reg.own_tag_conflict || reg.parent_tag_conflict;
        implement_iterator |= reg.implement_iterator;
        match (own_tag, reg.own_tag) {
          (None, Some(t)) => own_tag = Some(t),
          (Some(existing), Some(t)) if existing != t => has_conflict = true,
          _ => {}
        }
        match (parent_tag, reg.parent_tag) {
          (None, Some(t)) => parent_tag = Some(t),
          (Some(existing), Some(t)) if existing != t => has_conflict = true,
          _ => {}
        }
      }
      own_tag.map(|own_tag| NativeClassMetadata {
        type_id: *type_id,
        own_tag,
        parent_tag,
        implement_iterator,
        has_conflict,
      })
    })
    .collect()
}

/// Build the strict-descendants ancestry graph from a snapshot of registered
/// classes. Pure: no locks, no globals. `Err` (fail-closed) on any conflict,
/// tag collision, missing parent, iterator-involved edge, or cycle.
#[cfg(not(feature = "noop"))]
fn build_hierarchy(
  snapshot: &[NativeClassMetadata],
) -> std::result::Result<ClassHierarchy, String> {
  // Zero-`extends` early return: an addon that never uses inheritance cannot
  // fail to load because of this feature, full stop — not merely "unlikely to."
  if snapshot.iter().all(|m| m.parent_tag.is_none()) {
    return Ok(ClassHierarchy::empty());
  }

  // Any conflict recorded at merge time (two registrations for one `TypeId`
  // disagreeing on own/parent tag) fails the build closed rather than trusting
  // whichever registration happened to run first.
  for m in snapshot {
    if m.has_conflict {
      return Err(format!(
        "conflicting class registrations for a #[napi(extends)] type (TypeId \
         {:?}): refusing to build an inconsistent class hierarchy",
        m.type_id
      ));
    }
  }

  // Collision check — the load-bearing security piece. Every `own_tag` must map
  // to a single `TypeId`; a second, different `TypeId` claiming the same tag
  // means two distinct Rust types produced the same content-derived tag. This
  // scans *every* registered class (not just ones with a `parent_tag`) once at
  // least one `extends` edge exists. The resulting map doubles as the set of
  // all known `own_tag`s for the missing-parent check below.
  let mut tag_to_type: HashMap<sys::napi_type_tag, TypeId> = HashMap::with_capacity(snapshot.len());
  for m in snapshot {
    match tag_to_type.entry(m.own_tag) {
      std::collections::hash_map::Entry::Vacant(entry) => {
        entry.insert(m.type_id);
      }
      std::collections::hash_map::Entry::Occupied(entry) => {
        if *entry.get() != m.type_id {
          return Err(format!(
            "napi type tag collision: two distinct types share the same tag \
             (lower={:#018x}, upper={:#018x})",
            m.own_tag.lower, m.own_tag.upper
          ));
        }
      }
    }
  }

  // Per-tag iterator flag, for the both-sides-of-an-edge iterator check.
  let mut implements_iterator: HashMap<sys::napi_type_tag, bool> =
    HashMap::with_capacity(snapshot.len());
  for m in snapshot {
    implements_iterator.insert(m.own_tag, m.implement_iterator);
  }

  // Edges: child_tag -> parent_tag. Reject missing parents and iterator-
  // involved edges (defense-in-depth for P2's compile-time rejection, in case a
  // future macro change introduces an iterator-conflicting edge some other way).
  let mut parent_of: HashMap<sys::napi_type_tag, sys::napi_type_tag> =
    HashMap::with_capacity(snapshot.len());
  for m in snapshot {
    let Some(parent_tag) = m.parent_tag else {
      continue;
    };
    if !tag_to_type.contains_key(&parent_tag) {
      return Err(format!(
        "#[napi(extends)] references a parent class that is not registered \
         (child tag lower={:#018x}, upper={:#018x})",
        m.own_tag.lower, m.own_tag.upper
      ));
    }
    let parent_is_iterator = implements_iterator
      .get(&parent_tag)
      .copied()
      .unwrap_or(false);
    if m.implement_iterator || parent_is_iterator {
      return Err(format!(
        "#[napi(extends)] is not supported when either the child or parent \
         class implements an iterator/generator protocol (child tag \
         lower={:#018x}, upper={:#018x})",
        m.own_tag.lower, m.own_tag.upper
      ));
    }
    parent_of.insert(m.own_tag, parent_tag);
  }

  // Build the strict-descendants map: for each class, walk up its parent chain
  // and record it as a descendant of every ancestor found (excluding itself).
  // A per-walk `seen` set makes a cycle a clean `Err` rather than an infinite
  // loop — structurally near-unreachable (a true type cycle needs an
  // infinitely-sized struct, which rustc rejects first), but fail closed.
  let mut descendants: HashMap<sys::napi_type_tag, Vec<sys::napi_type_tag>> = HashMap::new();
  for m in snapshot {
    let mut seen: HashSet<sys::napi_type_tag> = HashSet::new();
    seen.insert(m.own_tag);
    let mut current = m.own_tag;
    while let Some(&parent) = parent_of.get(&current) {
      if !seen.insert(parent) {
        return Err(format!(
          "cycle detected in #[napi(extends)] hierarchy at tag (lower={:#018x}, \
           upper={:#018x})",
          parent.lower, parent.upper
        ));
      }
      descendants.entry(parent).or_default().push(m.own_tag);
      current = parent;
    }
  }

  // Deterministic ordering by `(lower, upper)`.
  let descendants = descendants
    .into_iter()
    .map(|(ancestor, mut kids)| {
      kids.sort_by_key(|t| (t.lower, t.upper));
      (ancestor, kids.into_boxed_slice())
    })
    .collect();

  Ok(ClassHierarchy { descendants })
}

// ---------------------------------------------------------------------------
// Registration manifest — descriptor-level duplicate detection.
//
// N-API module registration defines each export with `napi_set_named_property`
// and each class with `napi_define_class`, both of which SILENTLY let a later
// definition overwrite an earlier one that shares its name. `detect_registration_conflicts`
// is a *pure* pre-pass (no locks, no globals, no env) that `napi_register_module_v1`
// runs before anything is defined: it fails closed on a genuine collision that
// would otherwise vanish without a trace, mirroring `build_hierarchy`'s
// fail-closed posture. It reasons about *final JS definitions* — a getter+setter
// pair for one property is one accessor (not a duplicate), and a class assembled
// from several `#[napi] impl` blocks is one class — never about raw
// registration-call counts.
// ---------------------------------------------------------------------------

/// Set (to any value) to downgrade a registration conflict found by
/// [`detect_registration_conflicts`] from a thrown load error to a stderr
/// warning, letting the addon finish loading anyway. See the pre-pass call
/// site in `napi_register_module_v1` for the full rationale.
#[cfg(not(feature = "noop"))]
const ALLOW_DUPLICATE_EXPORTS_ENV: &str = "NAPI_RS_ALLOW_DUPLICATE_EXPORTS";

/// What a top-level `(js_mod, js_name)` export is, for a clearer diagnostic.
#[cfg(not(feature = "noop"))]
#[derive(Clone, Copy)]
enum ExportKind {
  Function,
  Class,
}

/// One top-level export — a free function/const/enum, or a class — named within
/// an optional namespace (`js_mod`).
#[cfg(not(feature = "noop"))]
struct ExportDescriptor<'a> {
  js_mod: Option<&'a str>,
  js_name: &'a str,
  kind: ExportKind,
}

/// One final class member (the constructor excluded), with the roles it defines.
/// A single descriptor may carry both a getter and a setter (a struct-field
/// accessor, or a getter+setter merged within one `impl` block); equally, two
/// separate descriptors — a getter here, a setter from another `impl` block —
/// describe the same valid accessor. Both shapes must read as "one getter, one
/// setter", so the roles are *counted* across the group, never assumed
/// one-per-descriptor.
#[cfg(not(feature = "noop"))]
struct MemberDescriptor<'a> {
  class_js_mod: Option<&'a str>,
  class_js_name: &'a str,
  is_static: bool,
  name: &'a str,
  is_getter: bool,
  is_setter: bool,
  is_method: bool,
}

#[cfg(not(feature = "noop"))]
fn namespace_suffix(js_mod: Option<&str>) -> String {
  match js_mod {
    Some(m) => format!(" in namespace `{m}`"),
    None => String::new(),
  }
}

#[cfg(not(feature = "noop"))]
fn describe_export_kinds(kinds: &[ExportKind]) -> &'static str {
  let mut has_fn = false;
  let mut has_class = false;
  for k in kinds {
    match k {
      ExportKind::Function => has_fn = true,
      ExportKind::Class => has_class = true,
    }
  }
  match (has_fn, has_class) {
    (true, true) => "as both a function and a class",
    (true, false) => "as a function",
    (false, true) => "as a class",
    (false, false) => "of unknown kind",
  }
}

/// Fail closed on any registration collision N-API would otherwise resolve by
/// silent overwrite. Pure: no locks, no globals, no env. Deterministic — every
/// grouping is ordered, so the *first* reported conflict never depends on
/// linker/constructor execution order (which is not a stable API).
///
/// Rules:
/// * **Module scope** — two exports sharing `(js_mod, js_name)` (function vs
///   function, function vs class, or two distinct classes) is a conflict.
/// * **Within a class** — grouped by `(is_static, name)`: a lone getter and/or
///   setter is valid; anything else with more than one contributor is a conflict
///   (two getters, two setters, or a method sharing a name with another method
///   or with an accessor). Static and instance members of the same name are
///   distinct (constructor vs prototype) and never collide.
#[cfg(not(feature = "noop"))]
fn detect_registration_conflicts(
  exports: &[ExportDescriptor],
  members: &[MemberDescriptor],
) -> std::result::Result<(), String> {
  use std::collections::BTreeMap;

  // --- Module scope: unique (js_mod, js_name). ---
  // BTreeMap keeps iteration ordered so the first reported conflict is stable.
  let mut by_name: BTreeMap<(Option<&str>, &str), Vec<ExportKind>> = BTreeMap::new();
  for e in exports {
    by_name
      .entry((e.js_mod, e.js_name))
      .or_default()
      .push(e.kind);
  }
  for ((js_mod, js_name), kinds) in &by_name {
    if kinds.len() > 1 {
      return Err(format!(
        "duplicate export `{js_name}`{}: registered {} times ({}). Each \
         (namespace, name) must be unique; N-API would otherwise silently keep \
         only the last.",
        namespace_suffix(*js_mod),
        kinds.len(),
        describe_export_kinds(kinds),
      ));
    }
  }

  // --- Within a class: (is_static, name) role validity. ---
  // The key includes the class so members of different classes never collide,
  // and `is_static` so a static and an instance member of one name (distinct
  // targets: constructor vs prototype) are not a false positive.
  #[derive(Default)]
  struct Roles {
    getters: usize,
    setters: usize,
    methods: usize,
  }
  let mut by_member: BTreeMap<(Option<&str>, &str, bool, &str), Roles> = BTreeMap::new();
  for m in members {
    let roles = by_member
      .entry((m.class_js_mod, m.class_js_name, m.is_static, m.name))
      .or_default();
    roles.getters += usize::from(m.is_getter);
    roles.setters += usize::from(m.is_setter);
    roles.methods += usize::from(m.is_method);
  }
  for ((class_js_mod, class_js_name, is_static, name), roles) in &by_member {
    let staticness = if *is_static { "static " } else { "" };
    if roles.methods > 0 && (roles.getters > 0 || roles.setters > 0) {
      return Err(format!(
        "conflicting members named `{name}` on {staticness}class \
         `{class_js_name}`{}: defined as both a method and an accessor \
         (getter/setter).",
        namespace_suffix(*class_js_mod),
      ));
    }
    if roles.methods > 1 {
      return Err(format!(
        "duplicate method `{name}` on {staticness}class `{class_js_name}`{}: \
         defined {} times.",
        namespace_suffix(*class_js_mod),
        roles.methods,
      ));
    }
    if roles.getters > 1 {
      return Err(format!(
        "duplicate getter `{name}` on {staticness}class `{class_js_name}`{}: \
         defined {} times.",
        namespace_suffix(*class_js_mod),
        roles.getters,
      ));
    }
    if roles.setters > 1 {
      return Err(format!(
        "duplicate setter `{name}` on {staticness}class `{class_js_name}`{}: \
         defined {} times.",
        namespace_suffix(*class_js_mod),
        roles.setters,
      ));
    }
  }

  Ok(())
}

#[cfg(all(target_family = "wasm", not(feature = "noop")))]
#[no_mangle]
unsafe extern "C" fn napi_register_wasm_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  unsafe { napi_register_module_v1(env, exports) }
}

#[cfg(not(feature = "noop"))]
#[no_mangle]
/// Register the n-api module exports.
///
/// # Safety
/// This method is meant to be called by Node.js while importing the n-api module.
/// Only call this method if the current module is **not** imported by a node-like runtime.
///
/// Arguments `env` and `exports` must **not** be null.
pub unsafe extern "C" fn napi_register_module_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  #[cfg(any(
    target_env = "msvc",
    all(not(target_family = "wasm"), feature = "dyn-symbols")
  ))]
  unsafe {
    sys::setup();
  }
  #[cfg(feature = "node_version_detect")]
  {
    NODE_VERSION.get_or_init(|| {
      let mut node_version = MaybeUninit::uninit();
      check_status_or_throw!(
        env,
        unsafe { sys::napi_get_node_version(env, node_version.as_mut_ptr()) },
        "Failed to get node version"
      );
      let node_version = *node_version.assume_init();
      unsafe {
        NODE_VERSION_MAJOR = node_version.major;
        NODE_VERSION_MINOR = node_version.minor;
        NODE_VERSION_PATCH = node_version.patch;
      }
      NodeVersion {
        major: node_version.major,
        minor: node_version.minor,
        patch: node_version.patch,
        release: unsafe { CStr::from_ptr(node_version.release).to_str().unwrap() },
      }
    });
  }

  // Build the addon-wide class hierarchy (issue #1164) exactly once, *before* the
  // module-count / first-thread coordination below. `get_or_init` runs its
  // closure to completion exactly once across all concurrent first loads (each
  // worker thread its own `napi_env`), every other caller blocking until the
  // winner finishes and then observing the identical result — unlike a
  // snapshot-then-`set`, where a losing thread would silently keep its own
  // discarded computation. Running before `fetch_add` means a build failure can
  // throw-and-return immediately with no waiter yet blocked on us: no thread ever
  // reaches `wait_first_thread_registered`, so a broken addon fails fast on every
  // `require` (main thread and workers alike) instead of one of them hanging. The
  // `.borrow()` inside the closure is safe — the class-definition loop that also
  // takes this lock hasn't run yet, so there is no recursive-lock hazard.
  if let Err(err) = CLASS_HIERARCHY.get_or_init(|| {
    MODULE_CLASS_PROPERTIES.borrow(|inner| build_hierarchy(&snapshot_registered_classes(inner)))
  }) {
    unsafe { JsError::from(crate::Error::from_reason(err.clone())).throw_into(env) };
    return exports;
  }

  let is_first_registration = MODULE_COUNT.fetch_add(1, Ordering::SeqCst) == 0;
  // From here on the guard owns the "first registration finished" signal: its
  // `Drop` sets `FIRST_MODULE_REGISTERED` on every exit path, so a later failure
  // (e.g. P5's prototype-wiring pass) may throw-and-return without leaving any
  // waiting worker blocked. Must be a named binding (`_first_registration_guard`,
  // not `_`) so it lives to the end of the function rather than dropping now.
  let _first_registration_guard = FirstRegistrationGuard {
    is_first: is_first_registration,
  };
  if !is_first_registration {
    wait_first_thread_registered();
  }

  // Install the per-env custom-GC handle (#3357) BEFORE running ANY module-init
  // callback below (the export-register callbacks, `module_register_hook_callback`,
  // and the compat `MODULE_EXPORTS` callbacks). Those callbacks can capture a
  // `Buffer`/`TypedArray` via `from_napi_value`, which snapshots the thread-local
  // `CURRENT_CUSTOM_GC_HANDLE`. If the handle were installed afterwards (as it was
  // originally), such a value would record `None`; because `Buffer`/`TypedArray`
  // are `Send`, dropping it later on a non-JS thread would fall through to a direct
  // `napi_reference_unref(env, ..)` on the WRONG thread — the cross-isolate
  // use-after-free this change exists to prevent. `create_custom_gc` only needs a
  // valid `env` (it creates a dummy function + the per-env TSFN and never reads
  // `exports`), so running it this early is safe.
  #[cfg(feature = "napi4")]
  create_custom_gc(env);

  let mut exports_objects: HashSet<String> = HashSet::default();

  // Registration-manifest pre-pass. Fail closed on a duplicate
  // `(namespace, name)` export, or a class member defined as both a method and an
  // accessor / more than once — collisions N-API would otherwise resolve by
  // silently overwriting one definition with another (a member simply missing at
  // runtime, with no error). Reads only the static registration tables already
  // populated at dylib load (no env calls) and runs before any export is defined,
  // so a colliding addon throws on every `require` with a clear message. This
  // runs on `worker_threads` loads too — the tables are process-global and fully
  // populated before any registration — so every thread fails consistently.
  //
  // Escape hatch: setting `NAPI_RS_ALLOW_DUPLICATE_EXPORTS` downgrades a found
  // conflict from a thrown error to a stderr warning and lets the module finish
  // loading — for an addon that can't be fixed immediately (a third-party
  // dependency, say) and would rather ship with a silently-missing/overwritten
  // member than fail to load at all. The detection pass itself is unaffected
  // (and still makes no env calls); only this outcome decision reads the var.
  if let Err(err) = {
    let register_callback = MODULE_REGISTER_CALLBACK
      .read()
      .expect("Read MODULE_REGISTER_CALLBACK for the registration manifest failed");
    MODULE_CLASS_PROPERTIES.borrow(|inner| {
      let mut export_descriptors: Vec<ExportDescriptor> = Vec::new();
      for (js_mod, (name, _cb)) in register_callback.iter() {
        export_descriptors.push(ExportDescriptor {
          js_mod: *js_mod,
          js_name: name,
          kind: ExportKind::Function,
        });
      }
      let mut member_descriptors: Vec<MemberDescriptor> = Vec::new();
      for js_mods in inner.values() {
        for (js_mod, class_registration) in js_mods {
          export_descriptors.push(ExportDescriptor {
            js_mod: *js_mod,
            js_name: class_registration.js_name,
            kind: ExportKind::Class,
          });
          for prop in &class_registration.props {
            // The constructor is handled by `napi_define_class`, not defined as a
            // named property; a symbol/computed-named prop carries no static utf8
            // name to compare. Both are skipped.
            if prop.is_ctor {
              continue;
            }
            if let Some(name) = prop.manifest_utf8_name() {
              member_descriptors.push(MemberDescriptor {
                class_js_mod: *js_mod,
                class_js_name: class_registration.js_name,
                is_static: prop.is_static_member(),
                name,
                is_getter: prop.defines_getter(),
                is_setter: prop.defines_setter(),
                is_method: prop.defines_method(),
              });
            }
          }
        }
      }
      detect_registration_conflicts(&export_descriptors, &member_descriptors)
    })
  } {
    if std::env::var(ALLOW_DUPLICATE_EXPORTS_ENV).is_ok() {
      eprintln!(
        "[napi-rs] WARNING: {err} (continuing because {ALLOW_DUPLICATE_EXPORTS_ENV} is set; the \
         colliding export may be silently missing or incorrect at runtime)"
      );
    } else {
      unsafe { JsError::from(crate::Error::from_reason(err)).throw_into(env) };
      return exports;
    }
  }

  {
    let mut register_callback = MODULE_REGISTER_CALLBACK
      .write()
      .expect("Write MODULE_REGISTER_CALLBACK in napi_register_module_v1 failed");
    register_callback
      .iter_mut()
      .fold(
        HashMap::<Option<&'static str>, Vec<(&'static str, ExportRegisterCallback)>>::new(),
        |mut acc, (js_mod, item)| {
          if let Some(k) = acc.get_mut(js_mod) {
            k.push(*item);
          } else {
            acc.insert(*js_mod, vec![*item]);
          }
          acc
        },
      )
      .iter()
      .for_each(|(js_mod, items)| {
        let mut exports_js_mod = ptr::null_mut();
        if let Some(js_mod_str) = js_mod {
          let mod_name_c_str =
            unsafe { CStr::from_bytes_with_nul_unchecked(js_mod_str.as_bytes()) };
          if exports_objects.contains(*js_mod_str) {
            check_status_or_throw!(
              env,
              unsafe {
                sys::napi_get_named_property(
                  env,
                  exports,
                  mod_name_c_str.as_ptr(),
                  &mut exports_js_mod,
                )
              },
              "Get mod {} from exports failed",
              js_mod_str,
            );
          } else {
            check_status_or_throw!(
              env,
              unsafe { sys::napi_create_object(env, &mut exports_js_mod) },
              "Create export JavaScript Object [{}] failed",
              js_mod_str
            );
            check_status_or_throw!(
              env,
              unsafe {
                sys::napi_set_named_property(env, exports, mod_name_c_str.as_ptr(), exports_js_mod)
              },
              "Set exports Object [{}] into exports object failed",
              js_mod_str
            );
            exports_objects.insert(js_mod_str.to_string());
          }
        }
        for (name, callback) in items {
          unsafe {
            let js_name = CStr::from_bytes_with_nul_unchecked(name.as_bytes());
            if let Err(e) = callback(env).and_then(|v| {
              let exported_object = if exports_js_mod.is_null() {
                exports
              } else {
                exports_js_mod
              };
              check_status!(
                sys::napi_set_named_property(env, exported_object, js_name.as_ptr(), v),
                "Failed to register export `{}`",
                name,
              )
            }) {
              JsError::from(e).throw_into(env)
            }
          }
        }
      });
  }

  let mut registered_classes = HashMap::default();

  // issue #1164: only collect prototypes / extends edges when the hierarchy
  // actually has at least one edge — a no-extends addon skips this entirely, for
  // zero added cost. The wiring itself is pure JS `Object.setPrototypeOf`, so it
  // is not gated on napi8 (it powers `instanceof` on every target).
  let wire_prototypes =
    matches!(CLASS_HIERARCHY.get(), Some(Ok(hierarchy)) if !hierarchy.descendants.is_empty());
  let mut prototypes_by_tag: HashMap<
    sys::napi_type_tag,
    Vec<(Option<&'static str>, sys::napi_value)>,
  > = HashMap::new();
  // (child js_mod, parent tag, child prototype)
  let mut extends_edges: Vec<(Option<&'static str>, sys::napi_type_tag, sys::napi_value)> =
    Vec::new();

  MODULE_CLASS_PROPERTIES.borrow(|inner| {
    inner.iter().for_each(|(_, js_mods)| {
      for (js_mod, class_registration) in js_mods {
        let mut exports_js_mod = ptr::null_mut();
        unsafe {
          let js_name = class_registration.js_name;
          let props = &class_registration.props;
          if let Some(js_mod_str) = js_mod {
            let mod_name_c_str = CStr::from_bytes_with_nul_unchecked(js_mod_str.as_bytes());
            if exports_objects.contains(*js_mod_str) {
              check_status_or_throw!(
                env,
                sys::napi_get_named_property(
                  env,
                  exports,
                  mod_name_c_str.as_ptr(),
                  &mut exports_js_mod,
                ),
                "Get mod {} from exports failed",
                js_mod_str,
              );
            } else {
              check_status_or_throw!(
                env,
                sys::napi_create_object(env, &mut exports_js_mod),
                "Create export JavaScript Object [{}] failed",
                js_mod_str
              );
              check_status_or_throw!(
                env,
                sys::napi_set_named_property(env, exports, mod_name_c_str.as_ptr(), exports_js_mod),
                "Set exports Object [{}] into exports object failed",
                js_mod_str
              );
              exports_objects.insert(js_mod_str.to_string());
            }
          }
          let (ctor, props): (Vec<_>, Vec<_>) = props.iter().partition(|prop| prop.is_ctor);

          let ctor = ctor
            .first()
            .map(|c| c.raw().method.unwrap())
            .unwrap_or(noop);

          // issue #1164 (P8): on napi8 + non-wasm, an extended-base class splits
          // its BorrowedUpcast plain methods off from the signature-guarded
          // descriptors handed to `napi_define_class` and rebuilds them below as
          // signature-free functions on the prototype — so a descendant instance
          // reaching them through the prototype chain is not rejected by V8's
          // method-receiver signature. Exact methods (a `Reference<Self>`
          // receiver) are never split out: they keep the exact tag-checked unwrap
          // and must fail on a descendant. `wire_prototypes` is already false for
          // any addon without an extends edge, so ordinary addons skip even the
          // per-class check. On every other config this partition is absent and
          // every method keeps the `napi_define_class` path (an inherited plain
          // method keeps throwing `Illegal invocation`, as before this feature).
          #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
          let (borrowed_upcast_methods, props): (Vec<_>, Vec<_>) = {
            let is_extended_base = wire_prototypes
              && class_registration.own_tag.is_some_and(|own_tag| {
                matches!(
                  CLASS_HIERARCHY.get(),
                  Some(Ok(hierarchy)) if hierarchy.is_extended_base(&own_tag)
                )
              });
            if is_extended_base {
              props
                .into_iter()
                .partition(|prop| prop.is_borrowed_upcast_method)
            } else {
              (Vec::new(), props)
            }
          };

          let raw_props: Vec<_> = props.iter().map(|prop| prop.raw()).collect();

          let js_class_name = CStr::from_bytes_with_nul_unchecked(js_name.as_bytes());
          let mut class_ptr = ptr::null_mut();

          check_status_or_throw!(
            env,
            sys::napi_define_class(
              env,
              js_class_name.as_ptr(),
              js_name.len() as isize - 1,
              Some(ctor),
              ptr::null_mut(),
              raw_props.len(),
              raw_props.as_ptr(),
              &mut class_ptr,
            ),
            "Failed to register class `{}`",
            &js_name,
          );

          if class_registration.implement_iterator {
            crate::bindgen_runtime::iterator::setup_iterator_class(env, class_ptr);
          }

          // issue #1164 (P8): attach the split-off BorrowedUpcast methods to the
          // class prototype as signature-free data-property functions, reusing
          // each method's original callback and data pointer unchanged. The
          // callback's own receiver unwrap (exact-first, with a descendant
          // fallback) still guards dispatch. Empty on any config or class that
          // did not split any methods out above (an iterator class can never be
          // an extended base — that edge is rejected at compile time — so this
          // never races the `setup_iterator_class` prototype mutation above).
          #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
          if !borrowed_upcast_methods.is_empty() {
            let mut class_proto = ptr::null_mut();
            check_status_or_throw!(
              env,
              sys::napi_get_named_property(
                env,
                class_ptr,
                c"prototype".as_ptr().cast(),
                &mut class_proto,
              ),
              "Failed to get prototype of class `{}`",
              &js_name,
            );
            for prop in &borrowed_upcast_methods {
              let descriptor = prop.raw();
              let mut method_fn = ptr::null_mut();
              check_status_or_throw!(
                env,
                sys::napi_create_function(
                  env,
                  descriptor.utf8name,
                  prop.utf8_name_len(),
                  descriptor.method,
                  descriptor.data,
                  &mut method_fn,
                ),
                "Failed to rebuild a borrowed-upcast method of class `{}`",
                &js_name,
              );
              let value_descriptor = sys::napi_property_descriptor {
                utf8name: descriptor.utf8name,
                name: ptr::null_mut(),
                method: None,
                getter: None,
                setter: None,
                value: method_fn,
                attributes: descriptor.attributes,
                data: ptr::null_mut(),
              };
              check_status_or_throw!(
                env,
                sys::napi_define_properties(env, class_proto, 1, &value_descriptor),
                "Failed to define a borrowed-upcast method on the prototype of class `{}`",
                &js_name,
              );
            }
          }

          let mut ctor_ref = ptr::null_mut();
          sys::napi_create_reference(env, class_ptr, 1, &mut ctor_ref);

          registered_classes.insert(js_name.to_string(), ctor_ref);

          check_status_or_throw!(
            env,
            sys::napi_set_named_property(
              env,
              if exports_js_mod.is_null() {
                exports
              } else {
                exports_js_mod
              },
              js_class_name.as_ptr(),
              class_ptr
            ),
            "Failed to register class `{}`",
            &js_name,
          );

          // issue #1164: capture this class's prototype (keyed by tag +
          // namespace) and any extends edge, for the prototype-chain wiring done
          // after the loop. Skipped entirely unless the hierarchy has edges
          // (`wire_prototypes`), so ordinary addons pay nothing.
          if wire_prototypes {
            let mut class_proto = ptr::null_mut();
            check_status_or_throw!(
              env,
              sys::napi_get_named_property(
                env,
                class_ptr,
                c"prototype".as_ptr().cast(),
                &mut class_proto,
              ),
              "Failed to get prototype of class `{}`",
              &js_name,
            );
            if let Some(own_tag) = class_registration.own_tag {
              prototypes_by_tag
                .entry(own_tag)
                .or_default()
                .push((*js_mod, class_proto));
            }
            if let Some(parent_tag) = class_registration.parent_tag {
              extends_edges.push((*js_mod, parent_tag, class_proto));
            }
          }
        }
      }
    });
  });

  // issue #1164: wire Child.prototype -> Parent.prototype for every extends edge
  // (instance side only). A failure here safely throws-and-returns immediately:
  // `_first_registration_guard`'s Drop still unblocks any waiting worker.
  if wire_prototypes && !extends_edges.is_empty() {
    if let Err(err) = unsafe { wire_extends_prototypes(env, &prototypes_by_tag, &extends_edges) } {
      unsafe { JsError::from(err).throw_into(env) };
      return exports;
    }
  }

  REGISTERED_CLASSES.with(|cell| {
    cell.borrow_mut(|map| {
      *map = registered_classes;
    })
  });

  let module_register_hook_callback = MODULE_REGISTER_HOOK_CALLBACK
    .read()
    .expect("Read MODULE_REGISTER_HOOK_CALLBACK failed");
  if let Some(cb) = module_register_hook_callback.as_ref() {
    if let Err(e) = cb(env, exports) {
      JsError::from(e).throw_into(env);
    }
  }

  #[cfg(feature = "compat-mode")]
  {
    let module_exports = MODULE_EXPORTS.read().expect("Read MODULE_EXPORTS failed");
    module_exports.iter().for_each(|callback| unsafe {
      if let Err(e) = callback(env, exports) {
        JsError::from(e).throw_into(env);
      }
    })
  }

  #[cfg(feature = "napi4")]
  {
    // NOTE: `create_custom_gc(env)` is intentionally NOT called here. It now runs
    // earlier in `register` (before any module-init callback) so a value captured
    // during a hook gets a real per-env handle instead of `None` (#3357).
    #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
    {
      crate::tokio_runtime::start_async_runtime();
      #[cfg(not(target_family = "wasm"))]
      {
        // Register a cleanup hook for EVERY registration, not just the first one.
        // `MODULE_COUNT` is incremented on every `napi_register_module_v1` call and
        // `thread_cleanup` decrements it once per env teardown, shutting the shared
        // async runtime down only when the count reaches zero (the last live env).
        // A process-wide one-shot gate used to install the hook for the first
        // registration only, so additional or recreated envs (`worker_threads`,
        // Electron renderer reload) bumped the count with no matching cleanup hook:
        // the count never returned to zero and `shutdown_async_runtime` was never
        // called, leaking backend threads/tasks that outlived the addon image.
        //
        // Each registration gets a distinct cookie so repeated loads of the same
        // addon into one env (`unload.spec.js`) don't collide on Node's unique
        // `(fn, arg)` assertion; the cookie is opaque and never dereferenced.
        let cleanup_cookie =
          ENV_CLEANUP_HOOK_COOKIE.fetch_add(1, Ordering::Relaxed) as *mut std::ffi::c_void;
        check_status_or_throw!(
          env,
          unsafe { sys::napi_add_env_cleanup_hook(env, Some(thread_cleanup), cleanup_cookie) },
          "Failed to add env cleanup hook"
        );
      }
    }
  }

  #[cfg(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4",
    target_family = "wasm"
  ))]
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_wrap(
        env,
        exports,
        std::ptr::null_mut(),
        Some(thread_cleanup),
        std::ptr::null_mut(),
        std::ptr::null_mut(),
      )
    },
    "Failed to add remove thread id cleanup hook"
  );

  // `FIRST_MODULE_REGISTERED` is now set by `_first_registration_guard`'s `Drop`
  // as this scope exits (see `FirstRegistrationGuard`), covering error exits too.
  exports
}

#[cfg(not(feature = "noop"))]
pub(crate) unsafe extern "C" fn noop(
  env: sys::napi_env,
  _info: sys::napi_callback_info,
) -> sys::napi_value {
  if !crate::bindgen_runtime::___CALL_FROM_FACTORY.with(|s| s.get()) {
    unsafe {
      sys::napi_throw_error(
        env,
        ptr::null_mut(),
        c"Class contains no `constructor`, can not new it!".as_ptr(),
      );
    }
  }
  ptr::null_mut()
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn create_custom_gc(env: sys::napi_env) {
  // Per-env custom-GC TSFN (#3357): created for EVERY isolate. It is `napi_unref`'d so it never pins
  // the event loop (worker terminate/exit cannot hang), and Node owns it (torn down via
  // `custom_gc_handle_finalize` at env teardown).
  let mut custom_gc_fn = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_function(
        env,
        c"custom_gc".as_ptr(),
        9,
        Some(empty),
        ptr::null_mut(),
        &mut custom_gc_fn,
      )
    },
    "Create Custom GC Function in napi_register_module_v1 failed"
  );
  let mut async_resource_name = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_create_string_utf8(env, c"CustomGC".as_ptr(), 8, &mut async_resource_name) },
    "Create async resource string in napi_register_module_v1"
  );
  let handle = std::sync::Arc::new(CustomGcHandle {
    tsfn: std::sync::atomic::AtomicPtr::new(ptr::null_mut()),
    aborted: std::sync::RwLock::new(false),
  });
  let weak_ptr = std::sync::Arc::downgrade(&handle).into_raw();
  let mut custom_gc_tsfn = ptr::null_mut();
  let status = unsafe {
    sys::napi_create_threadsafe_function(
      env,
      custom_gc_fn,
      ptr::null_mut(),
      async_resource_name,
      0,
      1,
      weak_ptr.cast_mut().cast(),
      Some(custom_gc_handle_finalize),
      ptr::null_mut(),
      Some(custom_gc),
      &mut custom_gc_tsfn,
    )
  };
  if status != sys::Status::napi_ok || custom_gc_tsfn.is_null() {
    // reclaim the leaked weak count before bailing
    drop(unsafe { std::sync::Weak::from_raw(weak_ptr) });
    check_status_or_throw!(
      env,
      status,
      "Create Custom GC ThreadsafeFunction in napi_register_module_v1 failed"
    );
    // `napi_create_threadsafe_function` only fails under resource exhaustion; `check_status_or_throw!`
    // above leaves a pending exception, which aborts the addon load (`require` throws). No user
    // `#[napi]` code then runs, so no Buffer/TypedArray is ever created with this env's (unset) handle.
    return;
  }
  handle
    .tsfn
    .store(custom_gc_tsfn, std::sync::atomic::Ordering::SeqCst);
  check_status_or_throw!(
    env,
    unsafe { sys::napi_unref_threadsafe_function(env, custom_gc_tsfn) },
    "Unref Custom GC ThreadsafeFunction in napi_register_module_v1 failed"
  );
  CURRENT_CUSTOM_GC_HANDLE.with(|c| *c.borrow_mut() = Some(handle));
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ),
  not(target_family = "wasm")
))]
unsafe extern "C" fn thread_cleanup(_data: *mut std::ffi::c_void) {
  if MODULE_COUNT.fetch_sub(1, Ordering::Relaxed) == 1 {
    crate::tokio_runtime::shutdown_async_runtime();
  }
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ),
  target_family = "wasm"
))]
unsafe extern "C" fn thread_cleanup(
  _env: sys::napi_env,
  _id: *mut std::ffi::c_void,
  _data: *mut std::ffi::c_void,
) {
  if MODULE_COUNT.fetch_sub(1, Ordering::Relaxed) == 1 {
    crate::tokio_runtime::shutdown_async_runtime();
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
#[allow(unused)]
unsafe extern "C" fn empty(env: sys::napi_env, info: sys::napi_callback_info) -> sys::napi_value {
  ptr::null_mut()
}

// Per-env custom-GC finalize (#3357): sets the per-handle `aborted` flag when Node tears down the
// owner env's TSFN. `finalize_data` is the `Weak<CustomGcHandle>` smuggled in via
// `thread_finalize_data`; we reclaim that weak count here.
#[cfg(all(feature = "napi4", not(feature = "noop")))]
unsafe extern "C" fn custom_gc_handle_finalize(
  _env: sys::napi_env,
  finalize_data: *mut std::ffi::c_void,
  _finalize_hint: *mut std::ffi::c_void,
) {
  if finalize_data.is_null() {
    return;
  }
  if let Some(handle) =
    unsafe { std::sync::Weak::<CustomGcHandle>::from_raw(finalize_data.cast()) }.upgrade()
  {
    // owner env gone, ref already invalidated by V8 -> mark aborted (write-lock)
    handle.set_aborted();
  }
  // temp Weak dropped here -> reclaims the weak count
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
// recycle a napi_ref (ArrayBuffer/Buffer/Error) that is not dropped on the main thread
extern "C" fn custom_gc(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  _context: *mut std::ffi::c_void,
  data: *mut std::ffi::c_void,
) {
  // env can be null while the owning env/TSFN is shutting down and Node drains the
  // queue (mirrors the generic call_js_cb guard in threadsafe_function.rs). The owner
  // env is gone and V8 has already invalidated the ref, so this is a safe no-op.
  if env.is_null() || data.is_null() {
    return;
  }
  let mut ref_count = 0;
  check_status_or_throw!(
    env,
    unsafe { sys::napi_reference_unref(env, data.cast(), &mut ref_count) },
    "Failed to unref reference in Custom GC"
  );
  // Both ArrayBuffer/Buffer and `Error` references reach 0 here: each is created
  // at refcount 1 and routed through this TSFN exactly once, by its owner's drop
  // (for `Error`, the last `Arc<ErrorRef>`), so the unref above always hits 0.
  if ref_count == 0 {
    check_status_or_throw!(
      env,
      unsafe { sys::napi_delete_reference(env, data.cast()) },
      "Failed to delete reference in Custom GC"
    );
  }
}

#[cfg(all(test, not(feature = "noop")))]
mod manifest_tests {
  //! Unit tests for the pure `detect_registration_conflicts` duplicate-detection
  //! pre-pass. No Node/N-API — plain descriptor structs — so these
  //! run under `cargo test -p napi --lib`.
  use super::{detect_registration_conflicts, ExportDescriptor, ExportKind, MemberDescriptor};

  fn func<'a>(js_mod: Option<&'a str>, js_name: &'a str) -> ExportDescriptor<'a> {
    ExportDescriptor {
      js_mod,
      js_name,
      kind: ExportKind::Function,
    }
  }
  fn class<'a>(js_mod: Option<&'a str>, js_name: &'a str) -> ExportDescriptor<'a> {
    ExportDescriptor {
      js_mod,
      js_name,
      kind: ExportKind::Class,
    }
  }
  fn member<'a>(
    owner: &'a str,
    name: &'a str,
    is_getter: bool,
    is_setter: bool,
    is_method: bool,
  ) -> MemberDescriptor<'a> {
    MemberDescriptor {
      class_js_mod: None,
      class_js_name: owner,
      is_static: false,
      name,
      is_getter,
      is_setter,
      is_method,
    }
  }
  fn getter<'a>(owner: &'a str, name: &'a str) -> MemberDescriptor<'a> {
    member(owner, name, true, false, false)
  }
  fn setter<'a>(owner: &'a str, name: &'a str) -> MemberDescriptor<'a> {
    member(owner, name, false, true, false)
  }
  fn accessor<'a>(owner: &'a str, name: &'a str) -> MemberDescriptor<'a> {
    member(owner, name, true, true, false)
  }
  fn method<'a>(owner: &'a str, name: &'a str) -> MemberDescriptor<'a> {
    member(owner, name, false, false, true)
  }

  #[test]
  fn a_clean_addon_has_no_conflicts() {
    let exports = [func(None, "a"), class(None, "B"), func(Some("ns\0"), "a")];
    let members = [getter("B", "x"), setter("B", "x"), method("B", "run")];
    assert!(detect_registration_conflicts(&exports, &members).is_ok());
  }

  // Rule 1 — module scope.
  #[test]
  fn module_scope_class_and_function_collide() {
    let exports = [func(None, "thing"), class(None, "thing")];
    let err = detect_registration_conflicts(&exports, &[]).unwrap_err();
    assert!(err.contains("thing"), "{err}");
    assert!(
      err.contains("function") && err.contains("class"),
      "message names both kinds: {err}"
    );
  }

  #[test]
  fn two_functions_of_one_name_collide() {
    let exports = [func(None, "dup"), func(None, "dup")];
    assert!(detect_registration_conflicts(&exports, &[]).is_err());
  }

  #[test]
  fn two_classes_of_one_name_collide() {
    let exports = [class(None, "Dup"), class(None, "Dup")];
    assert!(detect_registration_conflicts(&exports, &[]).is_err());
  }

  #[test]
  fn one_name_in_different_namespaces_is_ok() {
    let exports = [
      func(None, "a"),
      func(Some("ns\0"), "a"),
      class(Some("other\0"), "a"),
    ];
    assert!(detect_registration_conflicts(&exports, &[]).is_ok());
  }

  // Rule 2 — a getter+setter pair is one accessor, whether it arrives as two
  // descriptors (getter here, setter from another impl block)...
  #[test]
  fn getter_and_setter_of_one_name_two_descriptors_is_ok() {
    let members = [getter("C", "value"), setter("C", "value")];
    assert!(detect_registration_conflicts(&[], &members).is_ok());
  }

  // ...or as one descriptor carrying both roles (a struct-field accessor).
  #[test]
  fn getter_and_setter_of_one_name_one_descriptor_is_ok() {
    let members = [accessor("C", "value")];
    assert!(detect_registration_conflicts(&[], &members).is_ok());
  }

  // Rule 3 — a method sharing a name with an accessor.
  #[test]
  fn method_and_getter_of_one_name_conflict() {
    let members = [getter("C", "x"), method("C", "x")];
    let err = detect_registration_conflicts(&[], &members).unwrap_err();
    assert!(err.contains("method") && err.contains("accessor"), "{err}");
  }

  // Rule 4 — two methods of one name.
  #[test]
  fn two_methods_of_one_name_conflict() {
    let members = [method("C", "run"), method("C", "run")];
    let err = detect_registration_conflicts(&[], &members).unwrap_err();
    assert!(err.contains("run"), "{err}");
  }

  // Rule 5 — several impl blocks contributing DISTINCT members merge into one
  // valid class (the regression guard on the existing merge path).
  #[test]
  fn several_impl_blocks_of_distinct_members_is_ok() {
    // block A: getter `a` + method `run`; block B: setter `a` + method `stop`.
    // Merged, `a` is a valid accessor and the two methods are distinct.
    let members = [
      getter("C", "a"),
      method("C", "run"),
      setter("C", "a"),
      method("C", "stop"),
    ];
    assert!(detect_registration_conflicts(&[], &members).is_ok());
  }

  #[test]
  fn two_getters_of_one_name_conflict() {
    let members = [getter("C", "x"), getter("C", "x")];
    assert!(detect_registration_conflicts(&[], &members).is_err());
  }

  #[test]
  fn two_setters_of_one_name_conflict() {
    let members = [setter("C", "x"), setter("C", "x")];
    assert!(detect_registration_conflicts(&[], &members).is_err());
  }

  #[test]
  fn one_member_name_on_different_classes_is_ok() {
    let members = [method("A", "run"), method("B", "run")];
    assert!(detect_registration_conflicts(&[], &members).is_ok());
  }

  #[test]
  fn a_static_and_an_instance_member_of_one_name_is_ok() {
    // A static method and an instance getter of one name live on the constructor
    // vs the prototype — distinct targets, not a collision.
    let instance_getter = member("C", "kind", true, false, false);
    let mut static_method = method("C", "kind");
    static_method.is_static = true;
    assert!(detect_registration_conflicts(&[], &[instance_getter, static_method]).is_ok());
  }

  #[test]
  fn reported_conflict_is_deterministic_regardless_of_input_order() {
    // Two independent conflicts; the reported one must not depend on input order
    // (grouping is BTreeMap-ordered). `alpha` sorts before `zeta`, so it wins.
    let forward = [
      func(None, "zeta"),
      func(None, "zeta"),
      func(None, "alpha"),
      func(None, "alpha"),
    ];
    let reverse = [
      func(None, "alpha"),
      func(None, "alpha"),
      func(None, "zeta"),
      func(None, "zeta"),
    ];
    let a = detect_registration_conflicts(&forward, &[]).unwrap_err();
    let b = detect_registration_conflicts(&reverse, &[]).unwrap_err();
    assert_eq!(a, b);
    assert!(a.contains("alpha"), "{a}");
  }
}

#[cfg(all(test, not(feature = "noop")))]
mod hierarchy_tests {
  //! Unit tests for the pure `build_hierarchy` ancestry builder (issue #1164).
  //! No Node/N-API involved — `sys::napi_type_tag` is a plain POD struct here,
  //! so these run under `cargo test -p napi --lib module_register`.
  use super::{build_hierarchy, NativeClassMetadata};
  use crate::sys;
  use std::any::TypeId;

  // Distinct 'static marker types → distinct, stable `TypeId`s.
  struct T1;
  struct T2;
  struct T3;
  struct T4;

  fn tag(n: u64) -> sys::napi_type_tag {
    // Spread the two words so distinct `n` never accidentally collide on either.
    sys::napi_type_tag {
      lower: n,
      upper: n.wrapping_mul(0x9e37_79b9_7f4a_7c15),
    }
  }

  fn meta(
    type_id: TypeId,
    own: sys::napi_type_tag,
    parent: Option<sys::napi_type_tag>,
  ) -> NativeClassMetadata {
    NativeClassMetadata {
      type_id,
      own_tag: own,
      parent_tag: parent,
      implement_iterator: false,
      has_conflict: false,
    }
  }

  #[test]
  fn zero_extends_returns_empty_without_scanning() {
    let snapshot = [
      meta(TypeId::of::<T1>(), tag(1), None),
      meta(TypeId::of::<T2>(), tag(2), None),
    ];
    let h = build_hierarchy(&snapshot).expect("no edges must succeed");
    assert!(h.descendants.is_empty());
    assert!(!h.is_extended_base(&tag(1)));
  }

  #[test]
  fn non_extended_class_has_no_descendant_set_even_when_inheritance_exists_elsewhere() {
    // The structural regression guard behind `unwrap_borrowed_receiver`'s
    // "exact-first" fast path (see type_tag.rs): a non-extended class pays
    // exactly one tag check and consults the descendant set ONLY on an exact
    // mismatch — and for such a class there is no descendant set to consult, so
    // the fallback loop can never run for it. This asserts the *code path*, not
    // its duration: even in an addon that uses inheritance elsewhere (T1 <- T2),
    // a class uninvolved in inheritance (T3) is absent from `descendants`, so
    // `class_descendants(T3_tag)` returns `Ok(None)` and the receiver unwrap
    // does zero hierarchy traversal beyond the single exact check.
    let snapshot = [
      meta(TypeId::of::<T1>(), tag(1), None),
      meta(TypeId::of::<T2>(), tag(2), Some(tag(1))),
      meta(TypeId::of::<T3>(), tag(3), None),
    ];
    let h = build_hierarchy(&snapshot).expect("valid mixed hierarchy");

    // The extended base has a descendant set...
    assert!(h.is_extended_base(&tag(1)));
    assert_eq!(&*h.descendants[&tag(1)], &[tag(2)]);

    // ...but the non-extended class has NONE: `class_descendants` maps this to
    // `Ok(None)`, so the descendant fallback loop is unreachable for it.
    assert!(
      !h.descendants.contains_key(&tag(3)),
      "a non-extended class must not appear in the descendant map",
    );
    assert!(
      !h.is_extended_base(&tag(3)),
      "a non-extended class is not an extended base",
    );
    // It is also not anyone's descendant, so no ancestor's fallback loop ever
    // visits it either.
    assert!(!h.is_descendant(&tag(1), &tag(3)));
    assert!(!h.is_descendant(&tag(2), &tag(3)));
  }

  #[test]
  fn four_level_chain_builds_strict_descendants() {
    // T1 <- T2 <- T3 <- T4
    let snapshot = [
      meta(TypeId::of::<T1>(), tag(1), None),
      meta(TypeId::of::<T2>(), tag(2), Some(tag(1))),
      meta(TypeId::of::<T3>(), tag(3), Some(tag(2))),
      meta(TypeId::of::<T4>(), tag(4), Some(tag(3))),
    ];
    let h = build_hierarchy(&snapshot).expect("valid chain");

    assert_eq!(&*h.descendants[&tag(1)], &[tag(2), tag(3), tag(4)]);
    assert_eq!(&*h.descendants[&tag(2)], &[tag(3), tag(4)]);
    assert_eq!(&*h.descendants[&tag(3)], &[tag(4)]);
    assert!(!h.descendants.contains_key(&tag(4)), "leaf has no entry");

    assert!(h.is_extended_base(&tag(1)));
    assert!(h.is_extended_base(&tag(3)));
    assert!(!h.is_extended_base(&tag(4)));

    assert!(h.is_descendant(&tag(1), &tag(4)));
    assert!(h.is_descendant(&tag(2), &tag(3)));
    assert!(!h.is_descendant(&tag(4), &tag(1)));
    assert!(
      !h.is_descendant(&tag(2), &tag(1)),
      "ancestor is not a descendant"
    );
  }

  #[test]
  fn recorded_conflict_fails_closed() {
    let mut conflicted = meta(TypeId::of::<T1>(), tag(1), Some(tag(2)));
    conflicted.has_conflict = true;
    let snapshot = [conflicted, meta(TypeId::of::<T2>(), tag(2), None)];
    let err = build_hierarchy(&snapshot).unwrap_err();
    assert!(err.contains("conflicting class registrations"), "{err}");
  }

  #[test]
  fn tag_collision_between_distinct_types_is_rejected() {
    // T1 and T2 collide on tag(1); an unrelated edge (T3 -> T4) gets us past
    // the zero-extends early return so the collision scan actually runs.
    let snapshot = [
      meta(TypeId::of::<T1>(), tag(1), None),
      meta(TypeId::of::<T2>(), tag(1), None),
      meta(TypeId::of::<T3>(), tag(3), Some(tag(4))),
      meta(TypeId::of::<T4>(), tag(4), None),
    ];
    let err = build_hierarchy(&snapshot).unwrap_err();
    assert!(err.contains("tag collision"), "{err}");
  }

  #[test]
  fn same_type_id_repeated_is_not_a_collision() {
    // The same `TypeId` legitimately appears more than once (struct-level +
    // impl-level registrations collapse to one metadata entry, but a duplicate
    // must not be mistaken for two types sharing a tag).
    let snapshot = [
      meta(TypeId::of::<T1>(), tag(1), None),
      meta(TypeId::of::<T1>(), tag(1), None),
      meta(TypeId::of::<T2>(), tag(2), Some(tag(1))),
    ];
    let h = build_hierarchy(&snapshot).expect("same TypeId is fine");
    assert_eq!(&*h.descendants[&tag(1)], &[tag(2)]);
  }

  #[test]
  fn missing_parent_is_rejected() {
    let snapshot = [meta(TypeId::of::<T1>(), tag(1), Some(tag(99)))];
    let err = build_hierarchy(&snapshot).unwrap_err();
    assert!(err.contains("not registered"), "{err}");
  }

  #[test]
  fn iterator_on_either_side_of_an_edge_is_rejected() {
    // Parent implements an iterator.
    let mut parent = meta(TypeId::of::<T1>(), tag(1), None);
    parent.implement_iterator = true;
    let child = meta(TypeId::of::<T2>(), tag(2), Some(tag(1)));
    let err = build_hierarchy(&[parent, child]).unwrap_err();
    assert!(err.contains("iterator/generator"), "{err}");

    // Child implements an iterator.
    let parent = meta(TypeId::of::<T3>(), tag(3), None);
    let mut child = meta(TypeId::of::<T4>(), tag(4), Some(tag(3)));
    child.implement_iterator = true;
    let err = build_hierarchy(&[parent, child]).unwrap_err();
    assert!(err.contains("iterator/generator"), "{err}");
  }

  #[test]
  fn cycle_is_rejected() {
    // T1 <-> T2 mutually extend each other (impossible for real types, but the
    // runtime builder must still terminate with a clean error).
    let snapshot = [
      meta(TypeId::of::<T1>(), tag(1), Some(tag(2))),
      meta(TypeId::of::<T2>(), tag(2), Some(tag(1))),
    ];
    let err = build_hierarchy(&snapshot).unwrap_err();
    assert!(err.contains("cycle"), "{err}");
  }

  #[test]
  fn diamond_shaped_forest_stays_a_forest() {
    // Each class has at most one parent, so a "diamond" can't form; two
    // siblings sharing a parent must both appear as that parent's descendants.
    let snapshot = [
      meta(TypeId::of::<T1>(), tag(1), None),
      meta(TypeId::of::<T2>(), tag(2), Some(tag(1))),
      meta(TypeId::of::<T3>(), tag(3), Some(tag(1))),
      meta(TypeId::of::<T4>(), tag(4), Some(tag(2))),
    ];
    let h = build_hierarchy(&snapshot).expect("valid forest");
    // tag(1) has descendants tag(2), tag(3) (direct) and tag(4) (via tag(2)).
    assert_eq!(&*h.descendants[&tag(1)], &[tag(2), tag(3), tag(4)]);
    assert_eq!(&*h.descendants[&tag(2)], &[tag(4)]);
    assert!(
      !h.descendants.contains_key(&tag(3)),
      "sibling leaf has no entry"
    );
  }
}
