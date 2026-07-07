#[cfg(not(feature = "noop"))]
use std::{
  cell::{Cell, RefCell},
  rc::Rc,
  sync::atomic::{AtomicUsize, Ordering},
};

use napi::bindgen_prelude::*;
#[cfg(not(feature = "noop"))]
use napi::{AsyncCleanupHook, CleanupEnvHook};

#[cfg(not(feature = "noop"))]
struct CleanupHookDropProbe(&'static AtomicUsize);

#[cfg(not(feature = "noop"))]
impl Drop for CleanupHookDropProbe {
  fn drop(&mut self) {
    self.0.fetch_add(1, Ordering::SeqCst);
  }
}

#[cfg(not(feature = "noop"))]
struct CleanupHookDropCounter(Rc<Cell<usize>>);

#[cfg(not(feature = "noop"))]
impl Drop for CleanupHookDropCounter {
  fn drop(&mut self) {
    self.0.set(self.0.get() + 1);
  }
}

#[cfg(not(feature = "noop"))]
static SYNC_CLEANUP_DATA_DROPS: AtomicUsize = AtomicUsize::new(0);
#[cfg(not(feature = "noop"))]
static SYNC_CLEANUP_CAPTURE_DROPS: AtomicUsize = AtomicUsize::new(0);
#[cfg(not(feature = "noop"))]
static SYNC_CLEANUP_CALLS: AtomicUsize = AtomicUsize::new(0);
#[cfg(not(feature = "noop"))]
static ASYNC_CLEANUP_DATA_DROPS: AtomicUsize = AtomicUsize::new(0);
#[cfg(not(feature = "noop"))]
static ASYNC_CLEANUP_CAPTURE_DROPS: AtomicUsize = AtomicUsize::new(0);
#[cfg(not(feature = "noop"))]
static ASYNC_CLEANUP_CALLS: AtomicUsize = AtomicUsize::new(0);

#[cfg(not(feature = "noop"))]
thread_local! {
  static REMOVABLE_SYNC_CLEANUP_HOOK: RefCell<Option<CleanupEnvHook<CleanupHookDropProbe>>> =
    const { RefCell::new(None) };
  static REMOVABLE_ASYNC_CLEANUP_HOOK: RefCell<Option<AsyncCleanupHook>> =
    const { RefCell::new(None) };
  static SELF_REMOVING_SYNC_CLEANUP_HOOK:
    RefCell<Option<CleanupEnvHook<CleanupHookDropCounter>>> = const { RefCell::new(None) };
  static SELF_DROPPING_ASYNC_CLEANUP_HOOK: RefCell<Option<AsyncCleanupHook>> =
    const { RefCell::new(None) };
}

#[cfg(not(feature = "noop"))]
pub(crate) fn record_runtime_transition_probe(result_path: &str) {
  let mut result = 0;
  if try_start_async_runtime().is_ok() {
    result |= 1;
  }
  if try_shutdown_async_runtime().is_ok() {
    result |= 2;
  }
  let _ = std::fs::write(result_path, result.to_string());
}

#[cfg(not(feature = "noop"))]
#[napi]
pub fn register_env_cleanup_runtime_lifecycle_probes(
  env: &Env,
  cleanup_result_path: String,
  async_cleanup_result_path: String,
) -> Result<()> {
  env.add_env_cleanup_hook(cleanup_result_path, |result_path| {
    record_runtime_transition_probe(&result_path);
  })?;
  env.add_async_cleanup_hook(async_cleanup_result_path, |result_path| {
    record_runtime_transition_probe(&result_path);
  })
}

#[cfg(not(feature = "noop"))]
#[napi]
pub fn set_instance_data_runtime_lifecycle_probe(env: &Env, result_path: String) -> Result<()> {
  env.set_instance_data((), result_path, |context| {
    record_runtime_transition_probe(&context.hint);
  })
}

#[cfg(not(feature = "noop"))]
#[napi]
fn register_removable_sync_cleanup_hook(env: &Env) -> Result<()> {
  let already_registered = REMOVABLE_SYNC_CLEANUP_HOOK.with(|stored| stored.borrow().is_some());
  if already_registered {
    return Err(Error::new(
      Status::InvalidArg,
      "a removable sync cleanup hook is already registered".to_owned(),
    ));
  }

  let capture = CleanupHookDropProbe(&SYNC_CLEANUP_CAPTURE_DROPS);
  let hook = env.add_env_cleanup_hook(
    CleanupHookDropProbe(&SYNC_CLEANUP_DATA_DROPS),
    move |data| {
      SYNC_CLEANUP_CALLS.fetch_add(1, Ordering::SeqCst);
      drop(data);
      drop(capture);
    },
  )?;
  REMOVABLE_SYNC_CLEANUP_HOOK.with(|stored| *stored.borrow_mut() = Some(hook));
  Ok(())
}

#[cfg(not(feature = "noop"))]
#[napi]
fn remove_removable_sync_cleanup_hook(env: &Env) -> Result<()> {
  let hook = REMOVABLE_SYNC_CLEANUP_HOOK
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no removable sync cleanup hook is registered"))?;
  env.remove_env_cleanup_hook(hook)
}

#[cfg(not(feature = "noop"))]
#[napi]
fn sync_cleanup_hook_counts() -> Vec<u32> {
  vec![
    SYNC_CLEANUP_DATA_DROPS.load(Ordering::SeqCst) as u32,
    SYNC_CLEANUP_CAPTURE_DROPS.load(Ordering::SeqCst) as u32,
    SYNC_CLEANUP_CALLS.load(Ordering::SeqCst) as u32,
  ]
}

#[cfg(not(feature = "noop"))]
#[napi]
fn register_removable_async_cleanup_hook(env: &Env) -> Result<()> {
  let already_registered = REMOVABLE_ASYNC_CLEANUP_HOOK.with(|stored| stored.borrow().is_some());
  if already_registered {
    return Err(Error::new(
      Status::InvalidArg,
      "a removable async cleanup hook is already registered".to_owned(),
    ));
  }

  let capture = CleanupHookDropProbe(&ASYNC_CLEANUP_CAPTURE_DROPS);
  let hook = env.add_removable_async_cleanup_hook(
    CleanupHookDropProbe(&ASYNC_CLEANUP_DATA_DROPS),
    move |data| {
      ASYNC_CLEANUP_CALLS.fetch_add(1, Ordering::SeqCst);
      drop(data);
      drop(capture);
    },
  )?;
  REMOVABLE_ASYNC_CLEANUP_HOOK.with(|stored| *stored.borrow_mut() = Some(hook));
  Ok(())
}

#[cfg(not(feature = "noop"))]
#[napi]
fn remove_removable_async_cleanup_hook() -> Result<()> {
  let hook = REMOVABLE_ASYNC_CLEANUP_HOOK
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no removable async cleanup hook is registered"))?;
  drop(hook);
  Ok(())
}

#[cfg(not(feature = "noop"))]
#[napi]
fn async_cleanup_hook_counts() -> Vec<u32> {
  vec![
    ASYNC_CLEANUP_DATA_DROPS.load(Ordering::SeqCst) as u32,
    ASYNC_CLEANUP_CAPTURE_DROPS.load(Ordering::SeqCst) as u32,
    ASYNC_CLEANUP_CALLS.load(Ordering::SeqCst) as u32,
  ]
}

#[cfg(not(feature = "noop"))]
#[napi]
fn register_self_removing_sync_cleanup_hook(env: &Env, result_path: String) -> Result<()> {
  let already_registered = SELF_REMOVING_SYNC_CLEANUP_HOOK.with(|stored| stored.borrow().is_some());
  if already_registered {
    return Err(Error::from_reason(
      "a self-removing sync cleanup hook is already registered",
    ));
  }

  let raw_env = env.raw();
  let data_drops = Rc::new(Cell::new(0));
  let capture_drops = Rc::new(Cell::new(0));
  let data_drops_for_result = Rc::clone(&data_drops);
  let capture_drops_for_result = Rc::clone(&capture_drops);
  let capture = CleanupHookDropCounter(Rc::clone(&capture_drops));
  let hook = env.add_env_cleanup_hook(CleanupHookDropCounter(data_drops), move |data| {
    let stored_hook = SELF_REMOVING_SYNC_CLEANUP_HOOK.with(|stored| stored.borrow_mut().take());
    let removed = stored_hook
      .map(|hook| Env::from_raw(raw_env).remove_env_cleanup_hook(hook))
      .transpose()
      .is_ok_and(|result| result.is_some());
    drop(data);
    drop(capture);
    let _ = std::fs::write(
      result_path,
      format!(
        "removed={removed};data={};capture={}",
        data_drops_for_result.get(),
        capture_drops_for_result.get()
      ),
    );
  })?;
  SELF_REMOVING_SYNC_CLEANUP_HOOK.with(|stored| stored.borrow_mut().replace(hook));
  Ok(())
}

#[cfg(not(feature = "noop"))]
#[napi]
fn register_self_dropping_async_cleanup_hook(env: &Env, result_path: String) -> Result<()> {
  let already_registered =
    SELF_DROPPING_ASYNC_CLEANUP_HOOK.with(|stored| stored.borrow().is_some());
  if already_registered {
    return Err(Error::from_reason(
      "a self-dropping async cleanup hook is already registered",
    ));
  }

  let data_drops = Rc::new(Cell::new(0));
  let capture_drops = Rc::new(Cell::new(0));
  let data_drops_for_result = Rc::clone(&data_drops);
  let capture_drops_for_result = Rc::clone(&capture_drops);
  let capture = CleanupHookDropCounter(Rc::clone(&capture_drops));
  let hook =
    env.add_removable_async_cleanup_hook(CleanupHookDropCounter(data_drops), move |data| {
      let stored_hook = SELF_DROPPING_ASYNC_CLEANUP_HOOK.with(|stored| stored.borrow_mut().take());
      let dropped_handle = stored_hook.is_some();
      drop(stored_hook);
      drop(data);
      drop(capture);
      let _ = std::fs::write(
        result_path,
        format!(
          "dropped={dropped_handle};data={};capture={}",
          data_drops_for_result.get(),
          capture_drops_for_result.get()
        ),
      );
    })?;
  SELF_DROPPING_ASYNC_CLEANUP_HOOK.with(|stored| stored.borrow_mut().replace(hook));
  Ok(())
}

#[napi]
pub fn run_script(env: &Env, script: String) -> Result<Unknown<'_>> {
  env.run_script(script)
}

#[napi]
pub fn get_module_file_name(env: Env) -> Result<String> {
  env.get_module_file_name()
}

#[napi]
pub fn throw_syntax_error(env: Env, error: String, code: Option<String>) {
  env.throw_syntax_error(error, code);
}
