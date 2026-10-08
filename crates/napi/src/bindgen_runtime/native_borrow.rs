use std::{
  cell::RefCell,
  collections::HashMap,
  ptr,
  sync::{Arc, LazyLock, Mutex, MutexGuard},
  thread::{self, ThreadId},
};

#[cfg(all(feature = "napi4", not(feature = "noop")))]
use crate::bindgen_runtime::module_register::{current_custom_gc_handle, CustomGcHandle};
use crate::{sys, Error, Result, Status};

#[derive(Clone, Copy)]
enum NativeBorrowKind {
  Shared,
  Exclusive,
}

#[derive(Default)]
struct NativeBorrowState {
  shared: usize,
  exclusive: bool,
}

static NATIVE_BORROWS: LazyLock<Mutex<HashMap<usize, NativeBorrowState>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

thread_local! {
  static NATIVE_BORROW_SCOPES: RefCell<Vec<*const Mutex<NativeBorrowStorage>>> =
    const { RefCell::new(Vec::new()) };
  static DEFERRED_NATIVE_BORROW_SCOPES: RefCell<Vec<FinishedNativeBorrowScope>> =
    const { RefCell::new(Vec::new()) };
}

#[derive(Default)]
struct NativeBorrowStorage {
  guards: Vec<NativeBorrowGuard>,
  roots: Vec<NativeBorrowRoot>,
  /// The `(env, napi_value)` pairs behind each registered borrow, recorded cheaply at
  /// conversion time. They become `roots` only when an async sink claims a lease on the
  /// scope ([`NativeBorrowStorage::ensure_rooted`]); a scope released without a claim
  /// (every synchronous callback) never pays a `napi_create_reference`.
  borrowed_values: Vec<NativeBorrowedValue>,
  root_values: bool,
  owner_thread: Option<ThreadId>,
  /// Set when the scope is closed: the deferred reclaim guard at the end of return-value
  /// conversion, or `release`/`abandon`/`Drop` for a scope that was never deferred.
  /// Guards and roots are released only once the scope is closed AND `open_leases` is
  /// zero — a compound return (`Vec<AsyncTask>`, tuples mixing `AsyncTask`/`AsyncBlock`)
  /// takes one lease per async sink, and the work must stay rooted until the last one
  /// settles.
  closed: bool,
  /// Async sinks holding a claim on this scope. Incremented by
  /// [`claim_deferred_native_borrow_lease`] during return-value conversion, decremented by
  /// each lease's release/drop; the transition to zero after `closed` performs the
  /// actual release.
  open_leases: usize,
  /// The owning env's custom-GC threadsafe function, captured when the first root is
  /// created (always on the owner thread). A release that lands on a foreign thread — or
  /// on the owner thread at a point where the env may already be gone — hands the roots
  /// to that tsfn for unref+delete on the JavaScript thread instead of calling
  /// `napi_delete_reference` off-thread or leaking unconditionally.
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  custom_gc: Option<Arc<CustomGcHandle>>,
}

// Send + Sync so `Arc<Mutex<NativeBorrowStorage>>` can travel between the deferring
// JavaScript thread and whichever thread drops a lease or the scope. The raw pointers
// inside (`NativeBorrowGuard` keys, `napi_ref` roots, recorded `napi_value`s) are only
// ever dereferenced through Node-API on the owning JavaScript thread (`release`,
// `ensure_rooted`) or through the custom-GC threadsafe function — every off-thread path
// either mutates plain counters under the `Mutex` or hands roots to the tsfn.
unsafe impl Send for NativeBorrowStorage {}
unsafe impl Sync for NativeBorrowStorage {}

struct NativeBorrowRoot {
  env: sys::napi_env,
  reference: sys::napi_ref,
}

/// The JavaScript value a registered borrow was unwrapped from. Recorded — not rooted — so
/// the common synchronous path stays free of napi calls; a scope claimed by async work
/// upgrades them into `napi_ref` roots while the callback frame that produced them is still
/// on the stack, which is the last point where they are known to be valid.
struct NativeBorrowedValue {
  env: sys::napi_env,
  value: sys::napi_value,
}

fn lock_storage(storage: &Mutex<NativeBorrowStorage>) -> MutexGuard<'_, NativeBorrowStorage> {
  storage
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl NativeBorrowStorage {
  /// Direct release on the JavaScript owner thread: drops the alias guards (the Rust
  /// references captured by the async work are already gone) and unref+deletes every
  /// root — which may run wrapper finalizers, i.e. re-entrant JavaScript.
  fn release(&mut self, expected_env: Option<sys::napi_env>) {
    self.guards.clear();
    if self.roots.is_empty() {
      return;
    }
    if self.owner_thread != Some(thread::current().id()) {
      std::process::abort();
    }
    for root in self.roots.drain(..) {
      if expected_env.is_some_and(|expected_env| expected_env != root.env) {
        std::process::abort();
      }
      let mut ref_count = 0;
      let unref_status =
        unsafe { sys::napi_reference_unref(root.env, root.reference, &mut ref_count) };
      let delete_status = unsafe { sys::napi_delete_reference(root.env, root.reference) };
      if cfg!(debug_assertions)
        && (unref_status != sys::Status::napi_ok || delete_status != sys::Status::napi_ok)
      {
        crate::bindgen_runtime::catch_unwind_safely(|| {
          eprintln!(
            "Failed to release generated native borrow root: unref={}, delete={}",
            Status::from(unref_status),
            Status::from(delete_status)
          );
        });
      }
    }
  }

  /// Release reached without a known-live owner thread: the scope/lease was dropped
  /// rather than released through a settle path — a settle callback discarded during
  /// env teardown, an `AsyncWork` box reclaimed on a foreign thread, a runtime
  /// shutdown dropping pending futures' `JsDeferred` clones on worker threads.
  ///
  /// Drops the alias guards (that only needs the global borrow map), then hands each
  /// JavaScript root to the owning env's custom-GC threadsafe function — callable from
  /// any thread, and it unref+deletes the ref on the JavaScript thread (same protocol
  /// as `Buffer`/`FunctionRef` off-thread drops). The roots are leaked only when no
  /// handle was captured or the handle reports the env already gone — env teardown has
  /// then reclaimed the refs anyway, so the leak is free.
  fn release_or_delegate(&mut self) {
    self.guards.clear();
    self.borrowed_values.clear();
    if self.roots.is_empty() {
      return;
    }
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    if let Some(handle) = self.custom_gc.clone() {
      let roots = std::mem::take(&mut self.roots);
      handle.with_read_aborted(|aborted| {
        if aborted {
          // The owner env is gone and V8 has already invalidated the refs — the
          // drained queue would deliver them to `custom_gc` with a null env. Leaking
          // is safe: env teardown reclaimed the storage.
          return;
        }
        for root in roots {
          // Even on the owner thread the enqueue is the safe route: this path runs
          // precisely when the env may already be dying (uninvoked settle closures),
          // and a direct `napi_reference_unref` on a dead env is a use-after-free.
          // A `napi_closing` status means the tsfn is draining; the ref then dies
          // with the env.
          let status = unsafe {
            sys::napi_call_threadsafe_function(handle.get_raw(), root.reference.cast(), 1)
          };
          if cfg!(debug_assertions)
            && status != sys::Status::napi_ok
            && status != sys::Status::napi_closing
          {
            crate::bindgen_runtime::catch_unwind_safely(|| {
              eprintln!(
                "Failed to enqueue native borrow root for release: {}",
                Status::from(status)
              );
            });
          }
        }
      });
      return;
    }
    // No handle captured (pre-napi4/noop build, or the scope rooted before module
    // registration): the owner env is unreachable, so the roots leak.
    self.roots.clear();
  }

  /// Upgrades the recorded borrowed values into `napi_ref` roots.
  ///
  /// Runs at lease-claim time — inside the same callback frame, on the JavaScript owner
  /// thread, while the recorded `napi_value`s are still valid — so any return spelling
  /// that reaches an async sink (`Option<AsyncTask>`, a `Vec<AsyncTask>`, a type alias,
  /// a tuple member) is protected without generated code having to recognize the return
  /// type. Scopes that are never claimed (every purely synchronous callback) never pay
  /// for the references. Idempotent: the first claim roots, later claims see
  /// `root_values` already set.
  fn ensure_rooted(&mut self) -> Result<()> {
    if self.root_values {
      return Ok(());
    }
    self.root_values = true;
    self.owner_thread = Some(thread::current().id());
    for borrowed in std::mem::take(&mut self.borrowed_values) {
      let mut reference = ptr::null_mut();
      let status =
        unsafe { sys::napi_create_reference(borrowed.env, borrowed.value, 1, &mut reference) };
      if status != sys::Status::napi_ok {
        return Err(Error::new(
          Status::from(status),
          "Failed to root JavaScript value for a native borrow".to_owned(),
        ));
      }
      self.capture_custom_gc();
      self.roots.push(NativeBorrowRoot {
        env: borrowed.env,
        reference,
      });
    }
    Ok(())
  }

  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  fn capture_custom_gc(&mut self) {
    // The caller is on the owning JavaScript thread (root creation only ever happens
    // there), so the thread-local handle is this env's own custom-GC tsfn.
    if self.custom_gc.is_none() {
      self.custom_gc = current_custom_gc_handle();
    }
  }

  #[cfg(not(all(feature = "napi4", not(feature = "noop"))))]
  fn capture_custom_gc(&mut self) {}
}

/// Closes a scope and releases its storage if no lease still holds it. `settle_env` is
/// the env a settle path runs against (live, on the owner thread); `None` marks a drop
/// on an unknown thread, which delegates or leaks the roots instead of calling napi.
fn close_scope(storage: &Mutex<NativeBorrowStorage>, settle_env: Option<sys::napi_env>) {
  let mut storage = lock_storage(storage);
  storage.closed = true;
  if storage.open_leases != 0 {
    // Outstanding leases own the release: the last one out performs it.
    return;
  }
  match settle_env {
    Some(env) => storage.release(Some(env)),
    None => storage.release_or_delegate(),
  }
}

/// Closes a scope dropped while still collecting — reachable only on the owner thread
/// inside the live callback frame that created it, because `NativeBorrowScope` is
/// `!Send`. The env behind every recorded root is provably alive here, so roots
/// unref+delete directly instead of leaking on pre-napi4 builds, which have no
/// custom-GC delegate to offload the release to.
fn close_scope_in_frame(storage: &Mutex<NativeBorrowStorage>) {
  let mut storage = lock_storage(storage);
  storage.closed = true;
  if storage.open_leases != 0 {
    // Defensive: a collecting scope should never hold a lease — claims happen only on
    // deferred (finished) scopes.
    return;
  }
  storage.release(None);
}

/// Releases one lease; the transition to zero leases on a closed scope performs the
/// scope's release — directly when `settle_env` names the live env on the owner
/// thread, through the custom-GC delegate otherwise.
fn release_lease(storage: &Mutex<NativeBorrowStorage>, settle_env: Option<sys::napi_env>) {
  let mut storage = lock_storage(storage);
  debug_assert!(
    storage.open_leases != 0,
    "native borrow lease released more times than it was claimed"
  );
  storage.open_leases = storage.open_leases.saturating_sub(1);
  if !storage.closed || storage.open_leases != 0 {
    return;
  }
  match settle_env {
    Some(env) => storage.release(Some(env)),
    None => storage.release_or_delegate(),
  }
}

/// Prevents a reentrant callback from registering native references in an outer
/// conversion scope, and from claiming an outer deferred borrow scope.
///
/// The deferred half matters for the zero-argument fast path: such a callback skips
/// `CallbackInfo` and the defer emit entirely, so an `AsyncTask`/`AsyncBlock` it returns
/// converts with no scope of its own — and without the barrier it would claim the
/// OUTER deferred scope still armed for the outer callback's in-flight return-value
/// conversion (a `Function`/`Promise`/container conversion that ran JavaScript).
#[doc(hidden)]
pub struct NativeBorrowBarrier {
  // The outer callback's deferred scopes, parked while this frame runs. Claims inside
  // the barrier observe only deferred scopes the reentrant frame itself pushed.
  saved_deferred: Vec<FinishedNativeBorrowScope>,
  _not_send: std::marker::PhantomData<std::rc::Rc<()>>,
}

impl NativeBorrowBarrier {
  #[doc(hidden)]
  pub fn new() -> Self {
    NATIVE_BORROW_SCOPES.with(|scopes| scopes.borrow_mut().push(ptr::null()));
    let saved_deferred =
      DEFERRED_NATIVE_BORROW_SCOPES.with(|scopes| std::mem::take(&mut *scopes.borrow_mut()));
    Self {
      saved_deferred,
      _not_send: std::marker::PhantomData,
    }
  }
}

impl Drop for NativeBorrowBarrier {
  fn drop(&mut self) {
    NATIVE_BORROW_SCOPES.with(|scopes| {
      let barrier = scopes
        .borrow_mut()
        .pop()
        .expect("native borrow barriers must be dropped in stack order");
      assert!(
        barrier.is_null(),
        "native borrow barriers must not overlap conversion scopes"
      );
    });
    DEFERRED_NATIVE_BORROW_SCOPES.with(|scopes| {
      let mut scopes = scopes.borrow_mut();
      // A well-formed reentrant frame pops every scope it deferred through its own
      // reclaim guards. Anything left belongs to a frame that unwound past them;
      // dropping it takes the teardown-safe abandon path rather than leaking it back
      // into the restored outer stack.
      scopes.clear();
      *scopes = std::mem::take(&mut self.saved_deferred);
    });
  }
}

/// Collects native borrows created while generated code converts callback arguments.
///
/// The scope is collecting — and `!Send` — until [`NativeBorrowScope::finish`] pops it
/// from this thread's conversion stack. Collecting ties the scope to the creating
/// thread: the stack entry is a raw pointer into that thread's TLS, so moving a
/// collecting scope to another thread would let `finish`/`Drop` pop a foreign stack
/// (panic) and leave the source thread's TLS pointing at freed storage for the next
/// `register_native_borrow` to dereference. Only the finished form,
/// [`FinishedNativeBorrowScope`], is allowed to travel.
#[doc(hidden)]
pub struct NativeBorrowScope {
  // `Arc` because the TLS conversion stack stores the storage address and deferred
  // scopes share it with every lease claimed during conversion: the storage must
  // outlive the callback frame and stay put whichever handle moves. The `Mutex`
  // serializes the lease counter against scope close and release-vs-release across
  // threads; it is never held across a napi call that can reenter this storage.
  storage: Arc<Mutex<NativeBorrowStorage>>,
  collecting: bool,
  // `!Send` while collecting; `finish_sendable` is the only way to move the scope's
  // storage into a thread-crossing handle.
  _not_send: std::marker::PhantomData<std::rc::Rc<()>>,
}

impl NativeBorrowScope {
  /// Starts collecting native borrows created by generated callback argument conversion.
  ///
  /// # Safety
  ///
  /// The scope must only be created by callback glue that owns every reference produced while the
  /// scope is collecting. It must remain alive until those references have been dropped.
  #[doc(hidden)]
  pub unsafe fn new() -> Self {
    unsafe { Self::new_inner(false) }
  }

  /// Starts collecting native borrows and exact JavaScript roots for an async callback.
  ///
  /// # Safety
  ///
  /// The scope must be released on the JavaScript owner thread after the generated future has
  /// destroyed every reference produced while the scope is collecting.
  #[doc(hidden)]
  pub unsafe fn new_async() -> Self {
    unsafe { Self::new_inner(true) }
  }

  unsafe fn new_inner(root_values: bool) -> Self {
    let storage = Arc::new(Mutex::new(NativeBorrowStorage {
      root_values,
      owner_thread: root_values.then(|| thread::current().id()),
      ..Default::default()
    }));
    NATIVE_BORROW_SCOPES.with(|scopes| scopes.borrow_mut().push(Arc::as_ptr(&storage)));
    Self {
      storage,
      collecting: true,
      _not_send: std::marker::PhantomData,
    }
  }

  /// Stops argument conversion from adding guards while retaining all acquired borrows.
  #[doc(hidden)]
  pub fn finish(&mut self) {
    if !self.collecting {
      return;
    }
    let expected = Arc::as_ptr(&self.storage);
    NATIVE_BORROW_SCOPES.with(|scopes| {
      let actual = scopes
        .borrow_mut()
        .pop()
        .expect("native borrow scopes must be finished in stack order");
      assert_eq!(actual, expected, "native borrow scopes must not overlap");
    });
    self.collecting = false;
  }

  /// Finishes the scope and moves its storage into the `Send`-able finished form.
  ///
  /// Consumed on the creating thread: popping this thread's conversion stack is only
  /// legal here. Anything the finished scope may still do on another thread —
  /// `Drop`/`abandon` delegating roots to the custom-GC tsfn — never touches TLS.
  pub(crate) fn finish_sendable(self) -> FinishedNativeBorrowScope {
    // Skip `Drop`: the finished form owns the close from here on.
    let mut this = std::mem::ManuallyDrop::new(self);
    this.finish();
    // Move the `Arc` out wholesale — a clone + forgotten original would strand one
    // strong reference forever.
    let storage = unsafe { ptr::read(&this.storage) };
    FinishedNativeBorrowScope { storage }
  }

  /// Releases collected alias guards and exact JavaScript roots on their owner thread.
  ///
  /// For a deferred scope with outstanding leases this only closes the scope; the last
  /// lease release performs the actual cleanup. Kept for callback glue generated by
  /// released `napi-derive` versions; current glue routes through
  /// `defer_native_borrow_scope`/`NativeBorrowScopeRelease` instead.
  #[doc(hidden)]
  pub fn release(mut self, env: sys::napi_env) {
    self.finish();
    close_scope(&self.storage, Some(env));
    // The drop below runs `close_scope` again; it is idempotent (`closed` is already
    // set and the storage is already drained).
  }
}

/// The `Send`-able form of [`NativeBorrowScope`] once collecting is done.
///
/// Everything a finished scope does is safe on any thread: `release` performs its napi
/// calls on the owner thread against the live env it is handed, while `Drop`/`abandon`
/// touch no TLS and hand roots to the custom-GC threadsafe function — or leak them —
/// rather than unref-ing through a possibly-dead env from a foreign thread.
#[doc(hidden)]
pub struct FinishedNativeBorrowScope {
  storage: Arc<Mutex<NativeBorrowStorage>>,
}

impl FinishedNativeBorrowScope {
  /// Releases collected alias guards and exact JavaScript roots on their owner thread.
  /// With outstanding leases this only closes the scope; the last lease release
  /// performs the actual cleanup.
  #[doc(hidden)]
  pub fn release(self, env: sys::napi_env) {
    close_scope(&self.storage, Some(env));
    // The drop below closes again; `closed` is already set, so it is a no-op.
  }

  /// Drops the scope without an owner-thread release: the alias guards are released
  /// (that only needs the global borrow map) and any JavaScript roots are handed to the
  /// owning env's custom-GC threadsafe function — or deliberately leaked when no handle
  /// was captured or the env is already gone.
  ///
  /// This is the teardown-safe abandonment path. It exists for scopes whose owning
  /// environment is unreachable from the dropping thread — a settle callback that never
  /// ran because the threadsafe function was torn down, or a closure dropped on a
  /// runtime worker thread. Unref-ing roots requires the owner env on its own thread,
  /// so off-thread the only options are the custom-GC delegate or a leak.
  pub(crate) fn abandon(self) {
    close_scope(&self.storage, None);
  }
}

impl Drop for FinishedNativeBorrowScope {
  fn drop(&mut self) {
    close_scope(&self.storage, None);
  }
}

impl Drop for NativeBorrowScope {
  fn drop(&mut self) {
    if self.collecting {
      // Still collecting: this drop is inside the callback frame on the owner thread
      // (`!Send` guarantees the scope cannot have left it), so the recorded env is
      // live and roots unref+delete directly. `finish` first — it pops this thread's
      // conversion stack, and it panics if the scope is not the current top.
      self.finish();
      close_scope_in_frame(&self.storage);
    } else {
      // Finished without being deferred or wrapped: no env is in hand, so take the
      // delegate-or-leak path. Generated glue always routes finished scopes through
      // `defer_native_borrow_scope`/`NativeBorrowScopeRelease` first.
      close_scope(&self.storage, None);
    }
  }
}

/// One async consumer's hold on a deferred borrow scope.
///
/// Claimed inside `AsyncTask`/`AsyncBlock` conversion via
/// [`claim_deferred_native_borrow_lease`]. The scope's guards and roots release only
/// after the scope is closed (end of return-value conversion) and every lease has been
/// released — so a compound return keeps its wrappers rooted until the slowest task
/// settles. Each holder releases on the JavaScript owner thread in its settle path
/// (`AsyncWork::complete_impl`, the `AsyncBlock` deferred's settle callback). A lease
/// dropped anywhere else — a failed queue dropping the `AsyncWork` box, a settle
/// closure discarded uninvoked during env teardown — releases through
/// `Drop`, which delegates the roots to the owner env's custom-GC threadsafe
/// function rather than calling napi on the wrong thread.
#[doc(hidden)]
pub struct NativeBorrowLease {
  storage: Option<Arc<Mutex<NativeBorrowStorage>>>,
}

impl NativeBorrowLease {
  /// Releases this lease on the JavaScript owner thread against `env`.
  #[doc(hidden)]
  pub fn release(mut self, env: sys::napi_env) {
    if let Some(storage) = self.storage.take() {
      release_lease(&storage, Some(env));
    }
  }
}

// The lease only observes the shared storage's counters off-thread; napi is touched
// either on the owner thread in `release` or not at all (the custom-GC delegate makes
// `napi_call_threadsafe_function`, which is legal from any thread).
unsafe impl Send for NativeBorrowLease {}

impl Drop for NativeBorrowLease {
  fn drop(&mut self) {
    if let Some(storage) = self.storage.take() {
      release_lease(&storage, None);
    }
  }
}

/// Reclaims a deferred borrow scope once return-value conversion is done.
///
/// A deferred scope can only ever be observed while its own callback's return value is
/// being converted. The scope stays on the stack for the whole conversion so every
/// async sink reached can claim a lease on it (peek, not pop); this guard's drop then
/// pops it and releases it against the callback's live env. With no leases the scope
/// releases in place; with leases, the last one out performs the release.
#[doc(hidden)]
pub struct DeferredNativeBorrowScopeGuard {
  storage: *const Mutex<NativeBorrowStorage>,
  env: sys::napi_env,
}

/// Defers a finished borrow scope until the async work produced by the callback claims it.
///
/// Generated synchronous glue calls this after the native call produced its return value
/// and before that value is converted — unconditionally, for every return spelling,
/// because rooting is lazy: a scope that no async sink claims costs no napi calls at
/// all, and the claim inside `AsyncTask`/`AsyncBlock` conversion is what upgrades the
/// recorded borrowed values into roots. Arming the stack during conversion, not during
/// the call, is what makes the claim unambiguous: async sinks (`Env::spawn_future`, a
/// nested `AsyncBlockBuilder::build`, a reentrant `#[napi]` conversion) invoked inside
/// the callback body always observe an empty stack and can never claim a scope that is
/// not theirs. The scope is leased by every async sink the conversion reaches — each
/// element of a `Vec<AsyncTask>`, a returned `AsyncBlock`, a tuple member — and its
/// guards and roots release only once the scope is closed and every lease has been
/// released on the JavaScript owner thread. The returned guard releases the scope
/// itself when nothing claims it (a synchronous return value, an `Err` return, a throw,
/// or a panic unwinding out of the callback). `env` is the callback's live env: the
/// reclaim guard releases an unclaimed scope against it directly — the only release
/// path that touches napi on pre-napi4 builds, which have no custom-GC delegate.
#[doc(hidden)]
pub fn defer_native_borrow_scope(
  scope: NativeBorrowScope,
  env: sys::napi_env,
) -> DeferredNativeBorrowScopeGuard {
  let scope = scope.finish_sendable();
  let storage = Arc::as_ptr(&scope.storage);
  DEFERRED_NATIVE_BORROW_SCOPES.with(|scopes| scopes.borrow_mut().push(scope));
  DeferredNativeBorrowScopeGuard { storage, env }
}

/// Claims a lease on the most recently deferred borrow scope, if any.
///
/// Claiming is what turns a deferred scope into an async one: the recorded borrowed
/// values are upgraded to `napi_ref` roots here, on the JavaScript owner thread and
/// inside the callback frame that produced them. The scope is peeked — not popped — so
/// every async sink reached while the conversion runs (each element of a
/// `Vec<AsyncTask>`, a returned `AsyncBlock` alongside a task) takes its own lease on
/// the same scope; the reclaim guard closes the scope at the end of the conversion and
/// the last lease released performs the actual cleanup. A conversion with no deferred
/// scope (the task came from `Env::spawn`, `spawn_future`, user code) yields `None`.
pub(crate) fn claim_deferred_native_borrow_lease() -> Result<Option<NativeBorrowLease>> {
  let storage = DEFERRED_NATIVE_BORROW_SCOPES
    .with(|scopes| scopes.borrow().last().map(|scope| scope.storage.clone()));
  match storage {
    Some(storage) => {
      {
        let mut storage = lock_storage(&storage);
        storage.ensure_rooted()?;
        storage.open_leases += 1;
      }
      Ok(Some(NativeBorrowLease {
        storage: Some(storage),
      }))
    }
    None => Ok(None),
  }
}

impl Drop for DeferredNativeBorrowScopeGuard {
  fn drop(&mut self) {
    // Pop first, release after the TLS borrow is gone: releasing roots may run wrapper
    // finalizers — re-entrant JavaScript that could reach this TLS again.
    let scope = DEFERRED_NATIVE_BORROW_SCOPES.with(|scopes| {
      let mut scopes = scopes.borrow_mut();
      if scopes
        .last()
        .is_some_and(|scope| Arc::as_ptr(&scope.storage) == self.storage)
      {
        scopes.pop()
      } else {
        None
      }
    });
    if let Some(scope) = scope {
      // This thread is the callback's thread and `env` is its live env, so an
      // unclaimed scope releases in place here; a claimed one merely closes and the
      // last lease out performs the release.
      scope.release(self.env);
    }
  }
}

/// Wraps a scope so an uninvoked settle callback abandons it instead of releasing it.
///
/// `JsDeferred` stores its settle callback as `Box<dyn FnOnce(napi_env)>` behind a
/// shared slot; generated async glue installs `move |env| releaser.release(env)` into
/// it. When the environment tears down before the deferred settles, that closure can be
/// dropped without ever running — on a worker thread (the future's last `JsDeferred`
/// clone dropped there) or on the owner thread while the null-env teardown drain
/// discards queued settles. Either way `Drop` abandons the scope: the alias guards are
/// released and the JavaScript roots go through the custom-GC delegate when the env is
/// still reachable, or leak when it is gone — never a direct unref through a dead
/// environment or from a foreign thread. It holds the `Send`-able finished form:
/// `new` finishes the collecting scope eagerly on the owner thread so a drop on any
/// thread can never touch the creator's TLS conversion stack.
#[doc(hidden)]
pub struct NativeBorrowScopeRelease {
  scope: Option<FinishedNativeBorrowScope>,
}

impl NativeBorrowScopeRelease {
  #[doc(hidden)]
  pub fn new(scope: NativeBorrowScope) -> Self {
    Self {
      scope: Some(scope.finish_sendable()),
    }
  }

  /// Releases the scope's guards and roots against `env`. Consumes the wrapper so the
  /// `Drop` abandonment below can only fire when this never ran.
  #[doc(hidden)]
  pub fn release(mut self, env: sys::napi_env) {
    if let Some(scope) = self.scope.take() {
      scope.release(env);
    }
  }
}

impl Drop for NativeBorrowScopeRelease {
  fn drop(&mut self) {
    if let Some(scope) = self.scope.take() {
      scope.abandon();
    }
  }
}

#[doc(hidden)]
pub struct NativeBorrowGuard {
  key: usize,
  kind: NativeBorrowKind,
}

impl NativeBorrowGuard {
  fn acquire<T>(value: *mut T, kind: NativeBorrowKind) -> Result<Self> {
    if value.is_null() {
      return Err(Error::new(
        Status::InvalidArg,
        "Cannot borrow a null native value".to_owned(),
      ));
    }
    let key = value as usize;
    let mut borrows = NATIVE_BORROWS
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let state = borrows.entry(key).or_default();
    let conflict = match kind {
      NativeBorrowKind::Shared => state.exclusive,
      NativeBorrowKind::Exclusive => state.exclusive || state.shared != 0,
    };
    if conflict {
      return Err(Error::new(
        Status::InvalidArg,
        "The same native value cannot be borrowed mutably while another borrow is active"
          .to_owned(),
      ));
    }
    match kind {
      NativeBorrowKind::Shared => {
        state.shared = state
          .shared
          .checked_add(1)
          .expect("native shared borrow count overflow");
      }
      NativeBorrowKind::Exclusive => state.exclusive = true,
    }
    Ok(Self { key, kind })
  }
}

impl Drop for NativeBorrowGuard {
  fn drop(&mut self) {
    let mut borrows = NATIVE_BORROWS
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let state = borrows
      .get_mut(&self.key)
      .expect("native borrow guard must have a registered state");
    match self.kind {
      NativeBorrowKind::Shared => {
        state.shared = state
          .shared
          .checked_sub(1)
          .expect("native shared borrow count underflow");
      }
      NativeBorrowKind::Exclusive => state.exclusive = false,
    }
    if state.shared == 0 && !state.exclusive {
      borrows.remove(&self.key);
    }
  }
}

/// Registers a generated callback argument borrow in the current conversion scope.
#[doc(hidden)]
pub fn register_native_borrow<T>(value: *mut T, mutable: bool) -> Result<()> {
  let scope = current_native_borrow_scope()?;
  let guard = NativeBorrowGuard::acquire(value, native_borrow_kind(mutable))?;
  lock_storage(unsafe { &*scope }).guards.push(guard);
  Ok(())
}

/// Registers a generated callback argument borrow and roots its exact source JavaScript value.
///
/// # Safety
///
/// `env` and `napi_val` must be a valid same-environment Node-API value for the active callback,
/// and `value` must point to the native allocation represented by that JavaScript value for the
/// full generated borrow scope.
#[doc(hidden)]
pub unsafe fn register_native_borrow_with_value<T>(
  env: sys::napi_env,
  napi_val: sys::napi_value,
  value: *mut T,
  mutable: bool,
) -> Result<()> {
  let scope = current_native_borrow_scope()?;
  unsafe { register_native_borrow_with_value_in_scope(scope, env, napi_val, value, mutable) }
}

/// Preserves reference conversion for callbacks generated by previously released `napi-derive`.
///
/// Legacy callback glue does not install a native borrow scope. An explicit barrier still rejects
/// conversion so a reentrant legacy callback cannot attach its references to an outer callback's
/// scope. Current generated callbacks always take the scoped path.
///
/// # Safety
///
/// `env` and `napi_val` must be a valid same-environment Node-API value, and `value` must point to
/// the native allocation represented by that JavaScript value for the callback invocation.
// Runtime call sites (`External` reference conversion, compat-mode `CallContext` barriers) arrive
// with their own reworks; kept so barrier semantics stay covered by the unit tests below.
#[allow(dead_code)]
pub(crate) unsafe fn register_legacy_native_borrow_with_value<T>(
  env: sys::napi_env,
  napi_val: sys::napi_value,
  value: *mut T,
  mutable: bool,
) -> Result<()> {
  match current_native_borrow_scope_entry() {
    None => Ok(()),
    Some(scope) if scope.is_null() => Err(missing_native_borrow_scope_error()),
    Some(scope) => unsafe {
      register_native_borrow_with_value_in_scope(scope, env, napi_val, value, mutable)
    },
  }
}

unsafe fn register_native_borrow_with_value_in_scope<T>(
  scope: *const Mutex<NativeBorrowStorage>,
  env: sys::napi_env,
  napi_val: sys::napi_value,
  value: *mut T,
  mutable: bool,
) -> Result<()> {
  let guard = NativeBorrowGuard::acquire(value, native_borrow_kind(mutable))?;
  let mut storage = lock_storage(unsafe { &*scope });
  if storage.root_values {
    // Async callbacks root eagerly: their scope leaves this thread inside the generated
    // future's finalize closure before any claim could upgrade it.
    if napi_val.is_null() {
      return Err(Error::new(
        Status::InvalidArg,
        "Cannot root a null JavaScript value for a native borrow".to_owned(),
      ));
    }
    let mut reference = ptr::null_mut();
    let status = unsafe { sys::napi_create_reference(env, napi_val, 1, &mut reference) };
    if status != sys::Status::napi_ok {
      return Err(Error::new(
        Status::from(status),
        "Failed to root JavaScript value for a native borrow".to_owned(),
      ));
    }
    storage.capture_custom_gc();
    storage.roots.push(NativeBorrowRoot { env, reference });
  } else if !napi_val.is_null() {
    // Synchronous scopes only record the source value: the pair costs two stores and no
    // napi call, and is upgraded into a real `napi_ref` root only if an async sink claims
    // a lease on the deferred scope during return-value conversion.
    storage.borrowed_values.push(NativeBorrowedValue {
      env,
      value: napi_val,
    });
  }
  storage.guards.push(guard);
  Ok(())
}

fn current_native_borrow_scope() -> Result<*const Mutex<NativeBorrowStorage>> {
  current_native_borrow_scope_entry()
    .filter(|scope| !scope.is_null())
    .ok_or_else(missing_native_borrow_scope_error)
}

fn current_native_borrow_scope_entry() -> Option<*const Mutex<NativeBorrowStorage>> {
  NATIVE_BORROW_SCOPES.with(|scopes| scopes.borrow().last().copied())
}

fn missing_native_borrow_scope_error() -> Error {
  Error::new(
    Status::InvalidArg,
    "Native references can only be created by generated callback argument conversion".to_owned(),
  )
}

fn native_borrow_kind(mutable: bool) -> NativeBorrowKind {
  if mutable {
    NativeBorrowKind::Exclusive
  } else {
    NativeBorrowKind::Shared
  }
}

/// Acquires a native borrow for a closure-based public API.
#[doc(hidden)]
pub fn acquire_native_borrow<T>(value: *mut T, mutable: bool) -> Result<NativeBorrowGuard> {
  NativeBorrowGuard::acquire(
    value,
    if mutable {
      NativeBorrowKind::Exclusive
    } else {
      NativeBorrowKind::Shared
    },
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn native_borrows_reject_aliasing_and_release_on_drop() {
    let mut value = 1u32;
    let value_ptr = &mut value as *mut u32;
    let shared = acquire_native_borrow(value_ptr, false).unwrap();
    let second_shared = acquire_native_borrow(value_ptr, false).unwrap();
    assert!(acquire_native_borrow(value_ptr, true).is_err());
    drop(second_shared);
    drop(shared);

    let exclusive = acquire_native_borrow(value_ptr, true).unwrap();
    assert!(acquire_native_borrow(value_ptr, false).is_err());
    assert!(acquire_native_borrow(value_ptr, true).is_err());
    drop(exclusive);

    assert!(acquire_native_borrow(value_ptr, true).is_ok());
  }

  #[test]
  fn generated_native_borrows_require_a_scope() {
    let mut value = 1u32;
    let error = register_native_borrow(&mut value, false).unwrap_err();
    assert_eq!(error.status, Status::InvalidArg);
    assert!(error
      .reason
      .contains("generated callback argument conversion"));
  }

  #[test]
  fn legacy_native_borrows_allow_an_absent_scope() {
    let mut value = 1u32;
    unsafe {
      register_legacy_native_borrow_with_value(ptr::null_mut(), ptr::null_mut(), &mut value, false)
    }
    .unwrap();

    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn legacy_native_borrows_join_an_active_scope() {
    let mut value = 1u32;
    let scope = unsafe { NativeBorrowScope::new() };
    unsafe {
      register_legacy_native_borrow_with_value(ptr::null_mut(), ptr::null_mut(), &mut value, false)
    }
    .unwrap();

    assert!(acquire_native_borrow(&mut value, true).is_err());
    drop(scope);
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn legacy_native_borrows_respect_callback_barriers() {
    let mut outer_value = 1u32;
    let mut reentrant_value = 2u32;
    let outer_scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut outer_value, false).unwrap();

    {
      let _barrier = NativeBorrowBarrier::new();
      let error = unsafe {
        register_legacy_native_borrow_with_value(
          ptr::null_mut(),
          ptr::null_mut(),
          &mut reentrant_value,
          false,
        )
      }
      .unwrap_err();

      assert_eq!(error.status, Status::InvalidArg);
      assert!(error
        .reason
        .contains("generated callback argument conversion"));
    }

    assert!(register_native_borrow(&mut outer_value, false).is_ok());
    drop(outer_scope);
  }

  #[test]
  fn callback_barrier_hides_outer_conversion_scope() {
    let mut outer_value = 1u32;
    let mut inner_value = 2u32;
    let mut outer_scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut outer_value, false).unwrap();

    {
      let _barrier = NativeBorrowBarrier::new();
      assert!(register_native_borrow(&mut inner_value, false).is_err());

      let mut inner_scope = unsafe { NativeBorrowScope::new() };
      register_native_borrow(&mut inner_value, false).unwrap();
      inner_scope.finish();
    }

    register_native_borrow(&mut outer_value, false).unwrap();
    outer_scope.finish();
  }

  #[test]
  fn deferred_scope_lease_outlives_guard_reclaim() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();

    let guard = defer_native_borrow_scope(scope, ptr::null_mut());
    let lease = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("deferred scope must lease");
    // Closing the scope must not release while a lease is outstanding.
    drop(guard);
    assert!(acquire_native_borrow(&mut value, true).is_err());
    drop(lease);
    assert!(acquire_native_borrow(&mut value, true).is_ok());
    assert!(claim_deferred_native_borrow_lease().unwrap().is_none());
  }

  #[test]
  fn deferred_scope_serves_multiple_leases_until_last_release() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();

    let guard = defer_native_borrow_scope(scope, ptr::null_mut());
    // A compound return (`Vec<AsyncTask>`, a tuple) claims one lease per async sink on
    // the same deferred scope.
    let first = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("first sink must lease");
    let second = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("second sink must lease the same scope");

    drop(guard);
    // The first task settling — `lease.release(env)` in `complete_impl` — must not
    // release the scope's borrows while the second task still runs.
    drop(first);
    assert!(acquire_native_borrow(&mut value, true).is_err());
    drop(second);
    assert!(acquire_native_borrow(&mut value, true).is_ok());
    assert!(claim_deferred_native_borrow_lease().unwrap().is_none());
  }

  #[test]
  fn lease_released_with_env_still_waits_for_scope_close() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();

    let guard = defer_native_borrow_scope(scope, ptr::null_mut());
    let lease = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("deferred scope must lease");
    // A settle that somehow runs before conversion ends releases its lease but cannot
    // finish the scope: the reclaim guard still has to close it.
    lease.release(ptr::null_mut());
    assert!(acquire_native_borrow(&mut value, true).is_err());
    drop(guard);
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn last_lease_dropped_on_foreign_thread_releases_guards() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();

    let guard = defer_native_borrow_scope(scope, ptr::null_mut());
    let lease = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("deferred scope must lease");
    drop(guard);
    // The AsyncWork box reclaimed on a foreign thread (a failed queue, a runtime
    // teardown dropping a settle payload): the last lease's `Drop` must release the
    // alias guards without napi calls.
    std::thread::spawn(move || drop(lease))
      .join()
      .expect("foreign-thread lease drop must not panic or abort");
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn rooted_last_lease_dropped_on_foreign_thread_delegates_roots() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();
    // Simulate a claimed+rooted scope: a JavaScript root owned by this thread. The fake
    // ref is never dereferenced — with no captured custom-GC handle the delegate can
    // only leak it, and that must make no napi calls at all.
    {
      let mut storage = lock_storage(&scope.storage);
      storage.roots.push(NativeBorrowRoot {
        env: ptr::null_mut(),
        reference: ptr::null_mut(),
      });
      storage.owner_thread = Some(thread::current().id());
    }

    let guard = defer_native_borrow_scope(scope, ptr::null_mut());
    let lease = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("deferred scope must lease");
    drop(guard);
    std::thread::spawn(move || drop(lease))
      .join()
      .expect("foreign-thread lease drop must not panic or abort");
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn unclaimed_deferred_scope_is_reclaimed_by_guard() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();

    let guard = defer_native_borrow_scope(scope, ptr::null_mut());
    drop(guard);
    assert!(claim_deferred_native_borrow_lease().unwrap().is_none());
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn callback_barrier_hides_outer_deferred_scope() {
    // A nested `#[napi]` callback invoked while the outer callback's return value is
    // still converting — a `Function` call inside a `ToNapiValue` — must not see the
    // outer deferred scope. The zero-argument fast path emits the barrier but no scope
    // of its own, so without the barrier its returned `AsyncTask` would claim the
    // outer scope and hold the outer callback's argument roots until it settled.
    let mut outer_value = 1u32;
    let mut outer_scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut outer_value, false).unwrap();
    outer_scope.finish();
    let outer_guard = defer_native_borrow_scope(outer_scope, ptr::null_mut());

    {
      let _barrier = NativeBorrowBarrier::new();
      // The zero-arg fast path: no scope, no defer — the claim must see nothing.
      assert!(claim_deferred_native_borrow_lease().unwrap().is_none());

      // A nested callback WITH arguments still defers and claims its own scope.
      let mut inner_scope = unsafe { NativeBorrowScope::new() };
      inner_scope.finish();
      let inner_guard = defer_native_borrow_scope(inner_scope, ptr::null_mut());
      let inner_lease = claim_deferred_native_borrow_lease()
        .unwrap()
        .expect("inner scope must lease");
      drop(inner_guard);
      drop(inner_lease);
      // The inner guard already reclaimed the inner scope; the barrier restores the
      // outer stack on drop.
      assert!(claim_deferred_native_borrow_lease().unwrap().is_none());
    }

    let outer_lease = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("outer scope must lease after the barrier drops");
    drop(outer_guard);
    drop(outer_lease);
    assert!(acquire_native_borrow(&mut outer_value, true).is_ok());
    assert!(claim_deferred_native_borrow_lease().unwrap().is_none());
  }

  #[test]
  fn deferred_scopes_reclaim_in_lifo_order() {
    let mut first_value = 1u32;
    let mut second_value = 2u32;

    let mut outer_scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut first_value, false).unwrap();
    outer_scope.finish();
    let outer_guard = defer_native_borrow_scope(outer_scope, ptr::null_mut());

    let mut inner_scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut second_value, false).unwrap();
    inner_scope.finish();
    let inner_guard = defer_native_borrow_scope(inner_scope, ptr::null_mut());

    // Claims observe only the inner (top) scope; the outer scope stays deferred under
    // it. The inner guard then closes its scope while the lease keeps the storage
    // alive until it is released.
    let inner_lease = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("inner scope must lease");
    drop(inner_guard);
    assert!(acquire_native_borrow(&mut second_value, true).is_err());
    drop(inner_lease);
    assert!(acquire_native_borrow(&mut second_value, true).is_ok());
    assert!(acquire_native_borrow(&mut first_value, true).is_err());

    // Reclaiming the outer scope pops it off the stack.
    drop(outer_guard);
    assert!(acquire_native_borrow(&mut first_value, true).is_ok());
    assert!(claim_deferred_native_borrow_lease().unwrap().is_none());
  }

  #[test]
  fn rooted_scope_dropped_on_foreign_thread_abandons() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();
    // Simulate a claimed scope: a JavaScript root owned by this thread. The fake ref is
    // never dereferenced — abandonment must not call napi at all.
    {
      let mut storage = lock_storage(&scope.storage);
      storage.roots.push(NativeBorrowRoot {
        env: ptr::null_mut(),
        reference: ptr::null_mut(),
      });
      storage.owner_thread = Some(thread::current().id());
    }
    // Only the finished form may cross threads: `finish_sendable` drains this thread's
    // TLS entry before the scope's storage travels.
    let scope = scope.finish_sendable();

    // The env-teardown case: the settle callback carrying the scope dies on a runtime
    // worker thread. Dropping it there must abandon — release the alias guards and
    // delegate-or-leak the roots — instead of aborting the process.
    std::thread::spawn(move || drop(scope))
      .join()
      .expect("foreign-thread drop must not panic or abort");
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn only_finished_scopes_are_send() {
    // `NativeBorrowScope` stays `!Send` while collecting (its `Rc` marker); the finished
    // form and the lease are the handles that legitimately cross to worker threads.
    fn assert_send<T: Send>() {}
    assert_send::<FinishedNativeBorrowScope>();
    assert_send::<NativeBorrowLease>();
    assert_send::<NativeBorrowScopeRelease>();
  }

  #[test]
  fn finish_sendable_drains_the_collecting_stack() {
    let mut value = 1u32;
    let scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    // Consume via `finish_sendable` — the way `defer_native_borrow_scope` and
    // `NativeBorrowScopeRelease::new` take the scope — and confirm the conversion
    // stack is empty afterwards.
    let finished = scope.finish_sendable();
    assert!(current_native_borrow_scope_entry().is_none());
    drop(finished);
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn uninvoked_scope_release_abandons_instead_of_calling_napi() {
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();
    {
      let mut storage = lock_storage(&scope.storage);
      storage.roots.push(NativeBorrowRoot {
        env: ptr::null_mut(),
        reference: ptr::null_mut(),
      });
      storage.owner_thread = Some(thread::current().id());
    }

    // Dropped without `release` ever running — the null-env teardown drain case. The
    // roots go to the custom-GC delegate when the env is reachable and leak when it is
    // confirmed gone — never a direct unref through a possibly-dead env.
    drop(NativeBorrowScopeRelease::new(scope));
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }

  #[test]
  fn deferred_scope_with_values_claim_upgrades_and_release_clears_guards() {
    // `register_native_borrow` records no JavaScript value, so claiming this scope is a
    // no-op upgrade — the napi-rooting side of `ensure_rooted` needs a live env and is
    // covered by the examples suite instead.
    let mut value = 1u32;
    let mut scope = unsafe { NativeBorrowScope::new() };
    register_native_borrow(&mut value, false).unwrap();
    scope.finish();

    let guard = defer_native_borrow_scope(scope, ptr::null_mut());
    let lease = claim_deferred_native_borrow_lease()
      .unwrap()
      .expect("deferred scope must lease");
    drop(guard);
    drop(lease);
    assert!(acquire_native_borrow(&mut value, true).is_ok());
  }
}
