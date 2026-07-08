use std::{
  future::Future,
  pin::Pin,
  sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
  },
  thread::JoinHandle,
};

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod native_cleanup_hook_failure {
  use std::{
    ffi::c_void,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
  };

  use napi::sys;

  type CleanupHook = Option<unsafe extern "C" fn(*mut c_void)>;
  type AddEnvCleanupHook =
    unsafe extern "C" fn(sys::napi_env, CleanupHook, *mut c_void) -> sys::napi_status;

  static FAIL_CLEANUP_HOOK_COUNTDOWN: AtomicUsize = AtomicUsize::new(0);
  static CLEANUP_HOOK_FAILURE_ARMED: AtomicBool = AtomicBool::new(false);

  #[cfg(target_os = "macos")]
  mod macos {
    use std::{
      ffi::{c_char, c_void},
      ptr,
      sync::OnceLock,
    };

    use napi::sys;

    use super::{intercept_add_env_cleanup_hook, AddEnvCleanupHook, CleanupHook};

    static REAL_ADD_ENV_CLEANUP_HOOK: OnceLock<AddEnvCleanupHook> = OnceLock::new();

    unsafe extern "C" {
      fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
      fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    fn real_add_env_cleanup_hook() -> AddEnvCleanupHook {
      *REAL_ADD_ENV_CLEANUP_HOOK.get_or_init(|| {
        let process = unsafe { dlopen(ptr::null(), 1) };
        assert!(!process.is_null(), "failed to open the current process");
        let symbol = unsafe { dlsym(process, c"napi_add_env_cleanup_hook".as_ptr()) };
        assert!(
          !symbol.is_null(),
          "failed to resolve napi_add_env_cleanup_hook"
        );
        let function =
          unsafe { std::mem::transmute_copy::<*mut c_void, AddEnvCleanupHook>(&symbol) };
        assert_ne!(
          function as usize, napi_add_env_cleanup_hook as *const () as usize,
          "cleanup-hook interposer resolved itself"
        );
        function
      })
    }

    #[no_mangle]
    unsafe extern "C" fn napi_add_env_cleanup_hook(
      env: sys::napi_env,
      fun: CleanupHook,
      arg: *mut c_void,
    ) -> sys::napi_status {
      unsafe { intercept_add_env_cleanup_hook(env, fun, arg, real_add_env_cleanup_hook()) }
    }
  }

  #[cfg(target_os = "linux")]
  unsafe extern "C" {
    fn __real_napi_add_env_cleanup_hook(
      env: sys::napi_env,
      fun: CleanupHook,
      arg: *mut c_void,
    ) -> sys::napi_status;
  }

  #[cfg(target_os = "linux")]
  #[no_mangle]
  unsafe extern "C" fn __wrap_napi_add_env_cleanup_hook(
    env: sys::napi_env,
    fun: CleanupHook,
    arg: *mut c_void,
  ) -> sys::napi_status {
    unsafe { intercept_add_env_cleanup_hook(env, fun, arg, __real_napi_add_env_cleanup_hook) }
  }

  unsafe fn intercept_add_env_cleanup_hook(
    env: sys::napi_env,
    fun: CleanupHook,
    arg: *mut c_void,
    real_add_env_cleanup_hook: AddEnvCleanupHook,
  ) -> sys::napi_status {
    if std::env::var_os("NAPI_MODULE_INIT_ROLLBACK_FAIL_RUNTIME_CLEANUP_HOOK").is_some()
      && CLEANUP_HOOK_FAILURE_ARMED
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
      // Module registration installs the resolver hook first and the runtime hook second.
      FAIL_CLEANUP_HOOK_COUNTDOWN.store(2, Ordering::Release);
    }
    let countdown =
      FAIL_CLEANUP_HOOK_COUNTDOWN.fetch_update(Ordering::AcqRel, Ordering::Acquire, |remaining| {
        remaining.checked_sub(1)
      });
    if countdown == Ok(1) {
      return sys::Status::napi_generic_failure;
    }
    unsafe { real_add_env_cleanup_hook(env, fun, arg) }
  }
}

static RUNTIME_START_CALLS: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_SHUTDOWN_CALLS: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_SHUTDOWN_TOKIO_ENTRIES: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_SHUTDOWN_TOKIO_ENTRY_FAILURES: AtomicUsize = AtomicUsize::new(0);

#[derive(Default)]
struct ModuleInitRuntime {
  tasks: Mutex<Vec<JoinHandle<()>>>,
}

unsafe impl AsyncRuntime for ModuleInitRuntime {
  fn spawn(&self, task: AsyncRuntimeTask) -> std::result::Result<(), AsyncRuntimeTask> {
    let task = std::thread::spawn(move || futures::executor::block_on(task));
    self
      .tasks
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .push(task);
    Ok(())
  }

  fn block_on(&self, future: Pin<&mut dyn Future<Output = ()>>) {
    futures::executor::block_on(future);
  }

  fn start(&self) -> Result<()> {
    RUNTIME_START_CALLS.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }

  fn shutdown(&self) -> Result<()> {
    RUNTIME_SHUTDOWN_CALLS.fetch_add(1, Ordering::SeqCst);
    match try_within_runtime_if_available(|| ()) {
      Ok(()) => {
        RUNTIME_SHUTDOWN_TOKIO_ENTRIES.fetch_add(1, Ordering::SeqCst);
      }
      Err(error) => {
        RUNTIME_SHUTDOWN_TOKIO_ENTRY_FAILURES.fetch_add(1, Ordering::SeqCst);
        return Err(error);
      }
    }
    if let (Some(entered_path), Some(release_path)) = (
      std::env::var_os("NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_ENTERED"),
      std::env::var_os("NAPI_MODULE_INIT_ROLLBACK_SHUTDOWN_RELEASE"),
    ) {
      std::fs::write(&entered_path, "entered").map_err(|error| {
        Error::from_reason(format!("failed to publish shutdown entry: {error}"))
      })?;
      let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
      while !std::path::Path::new(&release_path).exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(5));
      }
      if !std::path::Path::new(&release_path).exists() {
        return Err(Error::from_reason(
          "timed out waiting to release module-init runtime shutdown",
        ));
      }
    }
    let tasks = std::mem::take(
      &mut *self
        .tasks
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    for task in tasks {
      task
        .join()
        .map_err(|_| Error::from_reason("module rollback async task panicked"))?;
    }
    Ok(())
  }
}

#[napi_derive::module_init]
fn initialize_runtime() {
  register_async_runtime(ModuleInitRuntime::default());
  try_start_async_runtime().expect("module-init runtime should start before module loading");
}

#[napi]
pub fn module_init_rollback_probe() -> &'static str {
  "ready"
}

#[napi]
pub fn module_init_rollback_runtime_lifecycle() -> Vec<u32> {
  [
    RUNTIME_START_CALLS.load(Ordering::SeqCst),
    RUNTIME_SHUTDOWN_CALLS.load(Ordering::SeqCst),
    RUNTIME_SHUTDOWN_TOKIO_ENTRIES.load(Ordering::SeqCst),
    RUNTIME_SHUTDOWN_TOKIO_ENTRY_FAILURES.load(Ordering::SeqCst),
  ]
  .into_iter()
  .map(|count| u32::try_from(count).expect("runtime lifecycle counter overflow"))
  .collect()
}

#[napi]
pub async fn module_init_rollback_async_probe(value: u32) -> u32 {
  value + 1
}

#[napi]
pub fn module_init_rollback_drop_buffers_on_native_thread(buffers: Vec<Buffer>) -> Result<()> {
  if buffers.is_empty() {
    return Err(Error::from_reason(
      "custom-GC module-init probe array must not be empty",
    ));
  }
  std::thread::spawn(move || drop(buffers))
    .join()
    .map_err(|_| Error::from_reason("custom-GC probe thread panicked"))
}

#[napi]
pub struct ModuleInitRollbackClass {
  value: u32,
}

#[napi]
impl ModuleInitRollbackClass {
  #[napi(constructor)]
  pub fn new(value: u32) -> Self {
    Self { value }
  }

  #[napi]
  pub fn incremented(&self) -> Self {
    Self {
      value: self.value + 1,
    }
  }

  #[napi]
  pub async fn incremented_async(&self) -> u32 {
    self.value + 1
  }

  #[napi(getter)]
  pub fn value(&self) -> u32 {
    self.value
  }
}
