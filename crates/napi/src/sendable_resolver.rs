use std::{
  any::Any,
  cell::{Cell, RefCell},
  collections::{hash_map::Entry, HashMap, HashSet},
  marker::PhantomData,
  sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, LazyLock, Mutex,
  },
  thread::{self, ThreadId},
};

use crate::{Error, Result, Status};
use napi_sys as sys;

type ResolverId = usize;
type EnvId = usize;

struct ResolverEntry {
  #[cfg_attr(
    not(any(feature = "tokio_rt", feature = "async-runtime")),
    allow(dead_code)
  )]
  env: Option<EnvId>,
  resolver: Option<Box<dyn Any>>,
}

impl Drop for ResolverEntry {
  fn drop(&mut self) {
    if let Some(resolver) = self.resolver.take() {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(resolver));
    }
  }
}

thread_local! {
  static RESOLVERS: RefCell<HashMap<ResolverId, ResolverEntry>> = RefCell::new(HashMap::new());
  static CLOSING_ENVS: RefCell<HashSet<EnvId>> = RefCell::new(HashSet::new());
  static CURRENT_RESOLVER_ENV: Cell<Option<EnvId>> = const { Cell::new(None) };
  static RESOLVER_CLEANUP_ENVS: RefCell<HashSet<EnvId>> = RefCell::new(HashSet::new());
  static RESOLVER_THREAD_GUARD: ResolverThreadGuard = const { ResolverThreadGuard };
}

static NEXT_RESOLVER_ID: AtomicUsize = AtomicUsize::new(1);
static RESOLVER_CLEANUP: LazyLock<Mutex<ResolverCleanup>> =
  LazyLock::new(|| Mutex::new(ResolverCleanup::default()));

#[derive(Default)]
struct ResolverCleanup {
  active_owners: HashSet<ThreadId>,
  pending: HashMap<ThreadId, Vec<ResolverId>>,
}

struct ResolverThreadGuard;

impl Drop for ResolverThreadGuard {
  fn drop(&mut self) {
    let owner = thread::current().id();
    let mut cleanup = RESOLVER_CLEANUP
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    cleanup.active_owners.remove(&owner);
    cleanup.pending.remove(&owner);
  }
}

struct ResolverHandle {
  id: ResolverId,
  owner: ThreadId,
}

impl Drop for ResolverHandle {
  fn drop(&mut self) {
    if self.id == 0 {
      return;
    }
    if self.owner == thread::current().id() {
      if let Ok(Some(entry)) =
        RESOLVERS.try_with(|resolvers| resolvers.borrow_mut().remove(&self.id))
      {
        drop(entry);
      }
    } else {
      let mut cleanup = RESOLVER_CLEANUP
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if cleanup.active_owners.contains(&self.owner) {
        cleanup.pending.entry(self.owner).or_default().push(self.id);
      }
    }
  }
}

fn drain_pending_resolver_cleanup() {
  let owner = thread::current().id();
  let ids = RESOLVER_CLEANUP
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .pending
    .remove(&owner)
    .unwrap_or_default();
  let entries = RESOLVERS.with(|resolvers| {
    let mut resolvers = resolvers.borrow_mut();
    ids
      .into_iter()
      .filter_map(|id| resolvers.remove(&id))
      .collect::<Vec<_>>()
  });
  drop(entries);
}

pub(crate) fn register_resolver_env(env: sys::napi_env) -> Result<()> {
  CURRENT_RESOLVER_ENV.with(|current| current.set(Some(env as EnvId)));
  #[cfg(feature = "napi3")]
  {
    if RESOLVER_CLEANUP_ENVS.with(|envs| envs.borrow().contains(&(env as EnvId))) {
      return Ok(());
    }
    #[cfg(not(target_family = "wasm"))]
    let status =
      unsafe { sys::napi_add_env_cleanup_hook(env, Some(resolver_env_cleanup), env.cast()) };
    #[cfg(target_family = "wasm")]
    let status =
      unsafe { crate::napi_add_env_cleanup_hook(env, Some(resolver_env_cleanup), env.cast()) };
    if status != sys::Status::napi_ok {
      CURRENT_RESOLVER_ENV.with(|current| current.set(None));
      return Err(Error::new(
        Status::GenericFailure,
        "Failed to add SendableResolver environment cleanup hook",
      ));
    }
    RESOLVER_CLEANUP_ENVS.with(|envs| {
      envs.borrow_mut().insert(env as EnvId);
    });
  }
  Ok(())
}

#[cfg(feature = "napi3")]
unsafe extern "C" fn resolver_env_cleanup(data: *mut core::ffi::c_void) {
  let env = data.cast();
  crate::bindgen_runtime::catch_unwind_safely(|| clear_resolvers_for_env(env));
  let _ = RESOLVER_CLEANUP_ENVS.try_with(|envs| {
    envs.borrow_mut().remove(&(env as EnvId));
  });
}

/// A resolver handle that can cross worker threads while its closure remains owned by the
/// JavaScript thread where the handle was created.
///
/// With N-API 3 or newer, environment cleanup invalidates outstanding handles and drops their
/// closures on the JavaScript owner thread. N-API 1/2 do not provide environment cleanup hooks;
/// on those API levels callers must consume or drop every handle on its JavaScript owner thread
/// before the Node environment closes. Dropping the last handle from another thread only queues
/// owner-thread cleanup and cannot guarantee reclamation before teardown.
pub struct SendableResolver<
  Data: 'static + Send,
  R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>,
> {
  handle: Arc<ResolverHandle>,
  _data: PhantomData<Data>,
  // The resolver itself remains in the owner JavaScript thread's registry. A function-pointer
  // marker preserves the generic type for downcasting without making auto-traits depend on R.
  _resolver: PhantomData<fn() -> R>,
}

impl<Data: 'static + Send, R: 'static + FnOnce(sys::napi_env, Data) -> Result<sys::napi_value>>
  SendableResolver<Data, R>
{
  /// Create a resolver owned by the current thread.
  pub fn new(resolver: R) -> Self {
    Self::insert(CURRENT_RESOLVER_ENV.with(Cell::get), resolver)
  }

  #[cfg_attr(
    not(any(feature = "tokio_rt", feature = "async-runtime")),
    allow(dead_code)
  )]
  pub(crate) fn new_for_env(env: sys::napi_env, resolver: R) -> Self {
    Self::insert(Some(env as EnvId), resolver)
  }

  #[cfg_attr(
    not(any(feature = "tokio_rt", feature = "async-runtime")),
    allow(dead_code)
  )]
  pub(crate) fn clone_handle(&self) -> Self {
    Self {
      handle: Arc::clone(&self.handle),
      _data: PhantomData,
      _resolver: PhantomData,
    }
  }

  fn insert(env: Option<EnvId>, resolver: R) -> Self {
    if env.is_some_and(|env| CLOSING_ENVS.with(|envs| envs.borrow().contains(&env))) {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(resolver));
      return Self {
        handle: Arc::new(ResolverHandle {
          id: 0,
          owner: thread::current().id(),
        }),
        _data: PhantomData,
        _resolver: PhantomData,
      };
    }
    drain_pending_resolver_cleanup();
    let mut resolver: Option<Box<dyn Any>> = Some(Box::new(resolver));
    let id = RESOLVERS.with(|resolvers| loop {
      let id = NEXT_RESOLVER_ID.fetch_add(1, Ordering::Relaxed);
      if id == 0 {
        continue;
      }
      if let Entry::Vacant(entry) = resolvers.borrow_mut().entry(id) {
        entry.insert(ResolverEntry {
          env,
          resolver: Some(resolver.take().expect("resolver is inserted exactly once")),
        });
        break id;
      }
    });
    RESOLVER_THREAD_GUARD.with(|_| {});
    RESOLVER_CLEANUP
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .active_owners
      .insert(thread::current().id());
    Self {
      handle: Arc::new(ResolverHandle {
        id,
        owner: thread::current().id(),
      }),
      _data: PhantomData,
      _resolver: PhantomData,
    }
  }

  /// Resolve on the owner thread where this handle was created.
  ///
  /// The handle may cross worker threads, but consuming it there returns a cancellation error
  /// and queues the owner-thread closure for cleanup by the next resolver operation on that
  /// thread or, on N-API 3+, by environment teardown, instead of invoking it on the wrong thread.
  pub fn resolve(self, env: sys::napi_env, data: Data) -> Result<sys::napi_value> {
    let resolver = self.take()?;
    resolver(env, data)
  }

  #[cfg_attr(
    not(any(feature = "tokio_rt", feature = "async-runtime")),
    allow(dead_code)
  )]
  pub(crate) fn discard(self) -> Result<()> {
    self.take().map(drop)
  }

  fn take(self) -> Result<R> {
    if self.handle.owner != thread::current().id() {
      return Err(Error::new(
        Status::Cancelled,
        "Async resolver must be consumed on the thread where it was created",
      ));
    }
    drain_pending_resolver_cleanup();
    let mut entry = RESOLVERS
      .with(|resolvers| resolvers.borrow_mut().remove(&self.handle.id))
      .ok_or_else(|| {
        Error::new(
          Status::Cancelled,
          "Async resolver is no longer available because its Node environment was closed",
        )
      })?;
    let resolver = entry
      .resolver
      .take()
      .expect("registered resolver is taken exactly once");
    match resolver.downcast::<R>() {
      Ok(resolver) => Ok(*resolver),
      Err(resolver) => {
        crate::bindgen_runtime::catch_unwind_safely(|| drop(resolver));
        Err(Error::new(
          Status::GenericFailure,
          "Async resolver type mismatch",
        ))
      }
    }
  }
}

#[cfg_attr(
  not(any(feature = "tokio_rt", feature = "async-runtime")),
  allow(dead_code)
)]
pub(crate) fn clear_resolvers_for_env(env: sys::napi_env) {
  drain_pending_resolver_cleanup();
  CLOSING_ENVS.with(|envs| {
    envs.borrow_mut().insert(env as EnvId);
  });
  let entries = RESOLVERS.with(|resolvers| {
    let mut resolvers = resolvers.borrow_mut();
    let ids = resolvers
      .iter()
      .filter_map(|(id, entry)| {
        (entry.env.is_none() || entry.env == Some(env as EnvId)).then_some(*id)
      })
      .collect::<Vec<_>>();
    ids
      .into_iter()
      .filter_map(|id| resolvers.remove(&id))
      .collect::<Vec<_>>()
  });
  for entry in entries {
    drop(entry);
  }
  CLOSING_ENVS.with(|envs| {
    envs.borrow_mut().remove(&(env as EnvId));
  });
  CURRENT_RESOLVER_ENV.with(|current| {
    if current.get() == Some(env as EnvId) {
      current.set(None);
    }
  });
}

#[cfg(test)]
mod tests {
  use std::{
    cell::Cell,
    ptr,
    rc::Rc,
    sync::mpsc,
    thread::{self, ThreadId},
  };

  use super::*;

  struct DropThread {
    dropped_on: Rc<Cell<Option<ThreadId>>>,
  }

  impl Drop for DropThread {
    fn drop(&mut self) {
      self.dropped_on.set(Some(thread::current().id()));
    }
  }

  struct ReentrantDrop {
    env: sys::napi_env,
    dropped: Rc<Cell<bool>>,
    nested_dropped_on: Rc<Cell<Option<ThreadId>>>,
  }

  impl Drop for ReentrantDrop {
    fn drop(&mut self) {
      self.dropped.set(true);
      let captured = DropThread {
        dropped_on: Rc::clone(&self.nested_dropped_on),
      };
      let nested = SendableResolver::new_for_env(self.env, move |_, _: u32| {
        drop(captured);
        Ok(ptr::null_mut())
      });
      std::mem::forget(nested);
    }
  }

  struct PanickingDrop;

  impl Drop for PanickingDrop {
    fn drop(&mut self) {
      panic!("resolver destructor panic");
    }
  }

  #[test]
  fn non_send_resolver_is_owned_and_dropped_by_the_javascript_thread() {
    let owner_thread = thread::current().id();
    let dropped_on = Rc::new(Cell::new(None));
    let captured = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    let resolver = SendableResolver::new(move |_, value: u32| {
      drop(captured);
      Ok(value as sys::napi_value)
    });

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || sender.send(resolver).unwrap())
      .join()
      .unwrap();
    let resolver = receiver.recv().unwrap();

    resolver.resolve(ptr::null_mut(), 1).unwrap();
    assert_eq!(dropped_on.get(), Some(owner_thread));
  }

  #[test]
  fn dropping_an_internal_clone_does_not_invalidate_the_resolver() {
    let resolver = SendableResolver::new_for_env(ptr::null_mut(), |_, value: u32| {
      Ok(value as sys::napi_value)
    });
    let clone = resolver.clone_handle();

    drop(clone);

    assert_eq!(resolver.resolve(ptr::null_mut(), 42).unwrap() as usize, 42);
  }

  #[test]
  fn off_owner_resolution_defers_cleanup_to_the_owner_thread() {
    let owner_thread = thread::current().id();
    let dropped_on = Rc::new(Cell::new(None));
    let captured = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    let resolver = SendableResolver::new(move |_, _: u32| {
      drop(captured);
      Ok(ptr::null_mut())
    });

    let error = thread::spawn(move || resolver.resolve(ptr::null_mut(), 1).unwrap_err().reason)
      .join()
      .unwrap();
    assert!(error.contains("thread where it was created"));
    assert_eq!(dropped_on.get(), None);

    let trigger = SendableResolver::new(|_, _: u32| Ok(ptr::null_mut()));
    drop(trigger);
    assert_eq!(dropped_on.get(), Some(owner_thread));
  }

  #[test]
  fn environment_cleanup_drops_registered_resolvers_on_the_owner_thread() {
    let owner_thread = thread::current().id();
    let dropped_on = Rc::new(Cell::new(None));
    let captured = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    let env = 1usize as sys::napi_env;
    let resolver =
      SendableResolver::new_for_env(env, move |_, _: u32| -> Result<sys::napi_value> {
        drop(captured);
        Ok(ptr::null_mut())
      });

    thread::spawn(move || {
      let _resolver = resolver;
    })
    .join()
    .unwrap();
    assert_eq!(dropped_on.get(), None);

    clear_resolvers_for_env(env);
    assert_eq!(dropped_on.get(), Some(owner_thread));
  }

  #[test]
  fn public_constructor_is_bound_to_the_current_environment() {
    let owner_thread = thread::current().id();
    let env = 4usize as sys::napi_env;
    CURRENT_RESOLVER_ENV.with(|current| current.set(Some(env as EnvId)));
    let dropped_on = Rc::new(Cell::new(None));
    let captured = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    let resolver = SendableResolver::new(move |_, _: u32| {
      drop(captured);
      Ok(ptr::null_mut())
    });
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (resolver_tx, resolver_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
      ready_tx.send(()).unwrap();
      release_rx.recv().unwrap();
      resolver_tx.send(resolver).unwrap();
    });

    ready_rx.recv().unwrap();
    clear_resolvers_for_env(env);
    release_tx.send(()).unwrap();
    let resolver = resolver_rx.recv().unwrap();
    worker.join().unwrap();

    assert_eq!(dropped_on.get(), Some(owner_thread));
    let error = resolver
      .resolve(env, 1)
      .expect_err("environment cleanup must invalidate the public resolver handle");
    assert!(error.reason.contains("environment was closed"));
  }

  #[test]
  fn environment_cleanup_allows_reentrant_resolver_destruction() {
    let env = 2usize as sys::napi_env;
    let dropped = Rc::new(Cell::new(false));
    let nested_dropped_on = Rc::new(Cell::new(None));
    let captured = ReentrantDrop {
      env,
      dropped: Rc::clone(&dropped),
      nested_dropped_on: Rc::clone(&nested_dropped_on),
    };
    let _resolver =
      SendableResolver::new_for_env(env, move |_, _: u32| -> Result<sys::napi_value> {
        drop(captured);
        Ok(ptr::null_mut())
      });

    clear_resolvers_for_env(env);
    assert!(dropped.get());
    assert_eq!(nested_dropped_on.get(), Some(thread::current().id()));
  }

  #[test]
  fn environment_cleanup_contains_resolver_destructor_panics() {
    let env = 3usize as sys::napi_env;
    let captured = PanickingDrop;
    let _resolver =
      SendableResolver::new_for_env(env, move |_, _: u32| -> Result<sys::napi_value> {
        drop(captured);
        Ok(ptr::null_mut())
      });

    clear_resolvers_for_env(env);
  }
}
