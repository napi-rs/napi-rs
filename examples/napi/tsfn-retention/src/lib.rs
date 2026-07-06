use std::{
  path::Path,
  sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{channel, sync_channel, Receiver, Sender, SyncSender},
    Arc, Mutex,
  },
  thread::{self, JoinHandle},
  time::{Duration, Instant},
};

use napi::{bindgen_prelude::*, threadsafe_function::ThreadsafeFunction};
use napi_derive::napi;

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod native_release_probe {
  use std::{
    ffi::{c_char, c_void, CStr},
    ptr,
    sync::{
      atomic::{AtomicBool, Ordering},
      OnceLock,
    },
  };

  use napi::sys;

  type CleanupHook = Option<unsafe extern "C" fn(*mut c_void)>;
  type AddEnvCleanupHook =
    unsafe extern "C" fn(sys::napi_env, CleanupHook, *mut c_void) -> sys::napi_status;
  type ReleaseThreadsafeFunction = unsafe extern "C" fn(
    sys::napi_threadsafe_function,
    sys::napi_threadsafe_function_release_mode,
  ) -> sys::napi_status;

  static FAIL_NEXT_CLEANUP_HOOK: AtomicBool = AtomicBool::new(false);
  static NATIVE_FINALIZER_DROP_ACTIVE: AtomicBool = AtomicBool::new(false);
  static REAL_ADD_ENV_CLEANUP_HOOK: OnceLock<AddEnvCleanupHook> = OnceLock::new();
  static REAL_RELEASE_THREADSAFE_FUNCTION: OnceLock<ReleaseThreadsafeFunction> = OnceLock::new();

  #[cfg(target_os = "macos")]
  unsafe extern "C" {
    fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
  }

  #[cfg(target_os = "linux")]
  #[link(name = "dl")]
  unsafe extern "C" {
    fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
  }

  fn resolve_symbol<T: Copy>(name: &'static CStr) -> T {
    // Looking up the symbol through the process handle finds Node/libnode
    // before this dynamically loaded fixture. The equality checks below keep
    // an unexpected loader order from recursing through the interposer.
    let process = unsafe { dlopen(ptr::null(), 1) };
    assert!(!process.is_null(), "failed to open the current process");
    let symbol = unsafe { dlsym(process, name.as_ptr()) };
    assert!(
      !symbol.is_null(),
      "failed to resolve {}",
      name.to_string_lossy()
    );
    unsafe { std::mem::transmute_copy(&symbol) }
  }

  fn real_add_env_cleanup_hook() -> AddEnvCleanupHook {
    *REAL_ADD_ENV_CLEANUP_HOOK.get_or_init(|| {
      let symbol = resolve_symbol::<AddEnvCleanupHook>(c"napi_add_env_cleanup_hook");
      assert_ne!(
        symbol as usize, napi_add_env_cleanup_hook as *const () as usize,
        "cleanup-hook interposer resolved itself"
      );
      symbol
    })
  }

  fn real_release_threadsafe_function() -> ReleaseThreadsafeFunction {
    *REAL_RELEASE_THREADSAFE_FUNCTION.get_or_init(|| {
      let symbol = resolve_symbol::<ReleaseThreadsafeFunction>(c"napi_release_threadsafe_function");
      assert_ne!(
        symbol as usize, napi_release_threadsafe_function as *const () as usize,
        "TSFN release interposer resolved itself"
      );
      symbol
    })
  }

  #[no_mangle]
  unsafe extern "C" fn napi_add_env_cleanup_hook(
    env: sys::napi_env,
    fun: CleanupHook,
    arg: *mut c_void,
  ) -> sys::napi_status {
    if FAIL_NEXT_CLEANUP_HOOK.swap(false, Ordering::AcqRel) {
      return sys::Status::napi_generic_failure;
    }
    unsafe { real_add_env_cleanup_hook()(env, fun, arg) }
  }

  #[no_mangle]
  unsafe extern "C" fn napi_release_threadsafe_function(
    func: sys::napi_threadsafe_function,
    mode: sys::napi_threadsafe_function_release_mode,
  ) -> sys::napi_status {
    if NATIVE_FINALIZER_DROP_ACTIVE.load(Ordering::Acquire) {
      // Reentering this API while Node owns the active native finalizer can
      // consume or access a TSFN that Node deletes when the callback returns.
      std::process::abort();
    }
    unsafe { real_release_threadsafe_function()(func, mode) }
  }

  pub(super) fn fail_next_cleanup_hook() {
    assert!(
      !FAIL_NEXT_CLEANUP_HOOK.swap(true, Ordering::AcqRel),
      "cleanup-hook failure injection already armed"
    );
  }

  pub(super) struct NativeFinalizerDropGuard;

  impl NativeFinalizerDropGuard {
    pub(super) fn enter() -> Self {
      assert!(
        !NATIVE_FINALIZER_DROP_ACTIVE.swap(true, Ordering::AcqRel),
        "native finalizer drop probe is already active"
      );
      Self
    }
  }

  impl Drop for NativeFinalizerDropGuard {
    fn drop(&mut self) {
      assert!(
        NATIVE_FINALIZER_DROP_ACTIVE.swap(false, Ordering::AcqRel),
        "native finalizer drop probe was not active"
      );
    }
  }
}

const SETUP_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

type ProbeTsfn = ThreadsafeFunction<(), (), (), Status, false, false, 0>;

struct TsfnHolder {
  stop: Sender<()>,
  worker: Mutex<Option<JoinHandle<()>>>,
}

impl TsfnHolder {
  fn new() -> (Arc<Self>, Receiver<()>) {
    let (stop, stopped) = channel();
    (
      Arc::new(Self {
        stop,
        worker: Mutex::new(None),
      }),
      stopped,
    )
  }

  fn install(&self, worker: JoinHandle<()>) {
    let previous = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .replace(worker);
    debug_assert!(previous.is_none());
  }

  fn quiesce(&self) {
    let _ = self.stop.send(());
    let worker = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("TSFN holder thread must be installed");
    worker.join().expect("TSFN holder thread must not panic");
  }
}

struct PanicOnDropAfterQuiescence {
  quiesced: Arc<AtomicBool>,
}

impl Drop for PanicOnDropAfterQuiescence {
  fn drop(&mut self) {
    assert!(
      self.quiesced.load(Ordering::Acquire),
      "TSFN callback capture dropped before quiescence"
    );
    panic!("intentional TSFN callback capture Drop panic");
  }
}

struct PostFinalizeProbe {
  entered_path: String,
  release_path: String,
  completed_path: String,
}

impl PostFinalizeProbe {
  fn enter(&self) -> std::result::Result<(), String> {
    std::fs::write(&self.entered_path, b"entered")
      .map_err(|error| format!("failed to create probe entered marker: {error}"))
  }

  fn wait_for_release_and_complete(&self) {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    while !Path::new(&self.release_path).exists() && Instant::now() < deadline {
      thread::sleep(Duration::from_millis(1));
    }
    if Path::new(&self.release_path).exists() {
      execute_post_finalize_probe(&self.completed_path);
    }
  }

  fn spawn(self) -> Result<()> {
    let (ready, started) = sync_channel(0);
    thread::spawn(move || {
      if ready.send(self.enter()).is_err() {
        return;
      }
      self.wait_for_release_and_complete();
    });

    started
      .recv_timeout(SETUP_TIMEOUT)
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("post-finalization probe did not start: {error}"),
        )
      })?
      .map_err(|reason| Error::new(Status::GenericFailure, reason))
  }

  fn spawn_after_last_handle_drop(
    self,
    tsfn: ProbeTsfn,
    drop_request: Receiver<()>,
    last_handle_dropped: SyncSender<std::result::Result<(), String>>,
  ) -> Result<()> {
    let (ready, started) = sync_channel(0);
    thread::spawn(move || {
      if ready.send(()).is_err() {
        return;
      }
      if let Err(error) = drop_request.recv_timeout(PROBE_TIMEOUT) {
        let _ = last_handle_dropped.send(Err(format!(
          "timed out waiting for last-handle drop request: {error}"
        )));
        return;
      }

      // This is the last Rust handle. Its field drop glue releases the native
      // owner and decrements the Rust-handle lease before `enter` publishes
      // that this thread is still executing addon code.
      drop(tsfn);
      if last_handle_dropped.send(self.enter()).is_err() {
        return;
      }
      self.wait_for_release_and_complete();
    });

    started.recv_timeout(SETUP_TIMEOUT).map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("post-finalization probe did not start: {error}"),
      )
    })?;
    Ok(())
  }
}

struct DropLastHandleDuringFinalization {
  drop_request: Sender<()>,
  last_handle_dropped: Receiver<std::result::Result<(), String>>,
  reject_native_release: bool,
}

impl Drop for DropLastHandleDuringFinalization {
  fn drop(&mut self) {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let _native_finalizer_drop_guard = self
      .reject_native_release
      .then(native_release_probe::NativeFinalizerDropGuard::enter);
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = self.reject_native_release;
    self
      .drop_request
      .send(())
      .expect("last-handle probe thread must accept the drop request");
    self
      .last_handle_dropped
      .recv_timeout(SETUP_TIMEOUT)
      .expect("last-handle probe thread must acknowledge the drop")
      .expect("last-handle probe thread must enter addon code after the drop");
  }
}

#[inline(never)]
fn execute_post_finalize_probe(completed_path: &str) {
  std::fs::write(completed_path, b"completed")
    .expect("post-finalization probe must create its completion marker");
}

fn install_holder(holder: &Arc<TsfnHolder>, stopped: Receiver<()>, tsfn: ProbeTsfn) -> Result<()> {
  let (ready, started) = sync_channel(0);
  holder.install(thread::spawn(move || {
    if ready.send(()).is_err() {
      return;
    }
    let _ = stopped.recv();
    drop(tsfn);
  }));
  started.recv_timeout(SETUP_TIMEOUT).map_err(|error| {
    Error::new(
      Status::GenericFailure,
      format!("TSFN holder thread did not start: {error}"),
    )
  })
}

fn prepare_finalizer_panic(callback: &Function<(), ()>, probe: PostFinalizeProbe) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(|_| Ok(()))?;
  let (holder, stopped) = TsfnHolder::new();
  let finalizer_holder = Arc::clone(&holder);

  // SAFETY: The callback joins the only thread that can use this TSFN before
  // the intentional panic. The separate probe thread is intentionally left
  // live so the test can verify native-image retention after finalization.
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_holder.quiesce();
      panic!("intentional TSFN quiescence finalizer panic");
    })
  }?;

  install_holder(&holder, stopped, tsfn)?;
  probe.spawn()
}

fn prepare_callback_drop_panic(
  callback: &Function<(), ()>,
  probe: PostFinalizeProbe,
) -> Result<()> {
  let quiesced = Arc::new(AtomicBool::new(false));
  let callback_capture = PanicOnDropAfterQuiescence {
    quiesced: Arc::clone(&quiesced),
  };
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(move |_| {
      let _keep_alive = &callback_capture;
      Ok(())
    })?;
  let (holder, stopped) = TsfnHolder::new();
  let finalizer_holder = Arc::clone(&holder);

  // SAFETY: The callback joins the only thread that can use this TSFN and
  // records quiescence before the JavaScript callback capture is destroyed.
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_holder.quiesce();
      quiesced.store(true, Ordering::Release);
    })
  }?;

  install_holder(&holder, stopped, tsfn)?;
  probe.spawn()
}

fn prepare_unregistered_finalizer(
  callback: &Function<(), ()>,
  probe: PostFinalizeProbe,
  reject_native_release: bool,
) -> Result<()> {
  let (drop_request, wait_for_drop_request) = channel();
  let (last_handle_dropped, wait_for_last_handle_drop) = sync_channel(0);
  let callback_capture = DropLastHandleDuringFinalization {
    drop_request,
    last_handle_dropped: wait_for_last_handle_drop,
    reject_native_release,
  };
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(move |_| {
      let _keep_alive = &callback_capture;
      Ok(())
    })?;
  probe.spawn_after_last_handle_drop(tsfn, wait_for_drop_request, last_handle_dropped)
}

#[napi]
pub fn start_retention_probe(
  callback: Function<(), ()>,
  scenario: String,
  entered_path: String,
  release_path: String,
  completed_path: String,
) -> Result<()> {
  let probe = PostFinalizeProbe {
    entered_path,
    release_path,
    completed_path,
  };

  match scenario.as_str() {
    "finalizer-panic" => prepare_finalizer_panic(&callback, probe),
    "callback-drop-panic" => prepare_callback_drop_panic(&callback, probe),
    "unregistered-finalizer" => prepare_unregistered_finalizer(&callback, probe, false),
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    "unregistered-finalizer-no-cleanup-hook" => {
      native_release_probe::fail_next_cleanup_hook();
      prepare_unregistered_finalizer(&callback, probe, true)
    }
    _ => Err(Error::new(
      Status::InvalidArg,
      format!("unknown TSFN retention scenario: {scenario}"),
    )),
  }
}
