//! Picks, once per env when this addon registers into it, how that env's `AsyncTask` /
//! `Env::spawn` promises are settled. See `promise.rs` for the two ways.

/// How the promises of one env are settled.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SettleMode {
  /// `napi_create_promise`, then `napi_resolve_deferred` / `napi_reject_deferred` when the task
  /// completes. The cheap way, as before #3689. Chosen only where the env dies with its process
  /// (the main env of Node and Bun) or with its realm (wasm). One host is not told apart: an
  /// embedder that links `libnode.so` and creates and frees several envs on the default loop
  /// gets this mode too, and leaks one deferred per task in flight at each teardown, as before.
  Deferred,
  /// The deferred is settled at once with a thenable (see `promise.rs`). Costs more main-thread
  /// CPU per task, but a task still in flight when the env is torn down leaks nothing.
  Thenable,
}

impl SettleMode {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      SettleMode::Deferred => "deferred",
      SettleMode::Thenable => "thenable",
    }
  }
}

/// Picks the settle mode of `env`. Called once per load from `napi_register_module_v1`,
/// before the env's registration record is made. Never throws, never fails the load, and
/// never clears an exception it did not cause. Every doubt gives `Thenable`, which is
/// always correct, only slower.
///
/// Native, in this order:
///
/// 1. `globalThis.process.versions` is read first. Electron and NW.js (`versions.electron` /
///    `versions.nw` set), Bun before 1.4.4, Bun on Windows (its main thread does not run
///    libuv's default loop there), a pending exception, and a read that fails or finds the
///    wrong types all give `Thenable`.
/// 2. macOS, Linux and the other Unix hosts: `uv_default_loop()` is called only in a host that
///    is Node-based (it exports `node::Buffer::Data`) or that `versions.bun` names as Bun
///    1.4.4 or later. Bun before 1.4.4 exports `uv_default_loop` as a stub that aborts the
///    process, and a script can remove `versions.bun`; such a host is neither, so it gets
///    `Thenable` and the stub is never reached. Any other host (Deno too) gets `Thenable`.
///    Windows skips this step: Node, Electron and Bun all have a real libuv there, and Deno
///    does not export `uv_default_loop`.
/// 3. `Deferred` only when the host exports both `uv_default_loop` and
///    `napi_get_uv_event_loop` (found at run time, never linked) and the env's loop is the
///    default loop: the main env of Node and Bun. Workers give `Thenable`.
#[cfg(not(feature = "noop"))]
pub(crate) fn detect(env: crate::sys::napi_env) -> SettleMode {
  #[cfg(target_family = "wasm")]
  {
    // emnapi refuses JavaScript only after `Context.destroy()`; a deferred refused there is a
    // JavaScript object that dies with the realm.
    let _ = env;
    SettleMode::Deferred
  }
  #[cfg(not(target_family = "wasm"))]
  {
    // The loop check must not run where the versions read said no.
    let bun_with_default_loop = match host::read_versions(env) {
      host::Versions::Thenable => return SettleMode::Thenable,
      host::Versions::BunWithDefaultLoop => true,
      host::Versions::NotBun => false,
    };
    if host::runs_on_default_loop(env, bun_with_default_loop) {
      SettleMode::Deferred
    } else {
      SettleMode::Thenable
    }
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
mod host {
  use std::ffi::{c_void, CStr};
  use std::ptr;
  use std::sync::OnceLock;

  use crate::sys;

  /// The first Bun release whose `uv_default_loop` is a real function on macOS, Linux and
  /// FreeBSD. Earlier ones export a stub that aborts the process (`panic: unsupported uv
  /// function: uv_default_loop`).
  const BUN_WITH_DEFAULT_LOOP: (u32, u32, u32) = (1, 4, 4);

  /// What `globalThis.process.versions` tells about the host.
  #[derive(Clone, Copy, PartialEq, Eq, Debug)]
  pub(super) enum Versions {
    /// A host whose envs can die before the process, or where the loop check must not run.
    /// Also given when it cannot tell: an exception was already pending, or a read failed,
    /// threw or found the wrong type.
    Thenable,
    /// `versions.bun` names Bun 1.4.4 or later (not on Windows): `uv_default_loop` is real.
    BunWithDefaultLoop,
    /// No `versions.bun`, `versions.electron` or `versions.nw`.
    NotBun,
  }

  pub(super) fn read_versions(env: sys::napi_env) -> Versions {
    let mut pending = false;
    // An exception left by `create_custom_gc` must reach the loader untouched.
    if unsafe { sys::napi_is_exception_pending(env, &mut pending) } != sys::Status::napi_ok
      || pending
    {
      return Versions::Thenable;
    }
    let mut scope = ptr::null_mut();
    if unsafe { sys::napi_open_handle_scope(env, &mut scope) } != sys::Status::napi_ok {
      return Versions::Thenable;
    }
    let verdict = versions_verdict(env);
    // Nothing was pending before, so anything pending now came from the reads above.
    let threw = crate::async_work::promise::take_pending_exception(env).is_some();
    unsafe { sys::napi_close_handle_scope(env, scope) };
    if threw {
      return Versions::Thenable;
    }
    verdict.unwrap_or(Versions::Thenable)
  }

  /// `None` when `process.versions` cannot be read.
  fn versions_verdict(env: sys::napi_env) -> Option<Versions> {
    let mut global = ptr::null_mut();
    if unsafe { sys::napi_get_global(env, &mut global) } != sys::Status::napi_ok || global.is_null()
    {
      return None;
    }
    let process = object_property(env, global, c"process")?;
    let versions = object_property(env, process, c"versions")?;
    for embedder in [c"electron", c"nw"] {
      let value = named_property(env, versions, embedder)?;
      if value_type(env, value)? != sys::ValueType::napi_undefined {
        return Some(Versions::Thenable);
      }
    }
    let bun = named_property(env, versions, c"bun")?;
    match value_type(env, bun)? {
      sys::ValueType::napi_undefined => Some(Versions::NotBun),
      // Bun on Windows runs its main thread on its own loop, not on libuv's default one;
      // calling `uv_default_loop()` there would only create an unused loop.
      sys::ValueType::napi_string if cfg!(windows) => Some(Versions::Thenable),
      sys::ValueType::napi_string => {
        let version = string_value(env, bun)?;
        Some(if bun_version_below(&version, BUN_WITH_DEFAULT_LOOP)? {
          Versions::Thenable
        } else {
          Versions::BunWithDefaultLoop
        })
      }
      _ => None,
    }
  }

  /// `object[key]` when it is an object. Checking the type before the next read matters:
  /// `napi_get_named_property` on `undefined` throws through `ToObject`, and on a primitive it
  /// reads prototype getters.
  fn object_property(
    env: sys::napi_env,
    object: sys::napi_value,
    key: &CStr,
  ) -> Option<sys::napi_value> {
    let value = named_property(env, object, key)?;
    (value_type(env, value)? == sys::ValueType::napi_object).then_some(value)
  }

  fn named_property(
    env: sys::napi_env,
    object: sys::napi_value,
    key: &CStr,
  ) -> Option<sys::napi_value> {
    let mut value = ptr::null_mut();
    (unsafe { sys::napi_get_named_property(env, object, key.as_ptr(), &mut value) }
      == sys::Status::napi_ok
      && !value.is_null())
    .then_some(value)
  }

  fn value_type(env: sys::napi_env, value: sys::napi_value) -> Option<sys::napi_valuetype> {
    let mut value_type = sys::ValueType::napi_undefined;
    (unsafe { sys::napi_typeof(env, value, &mut value_type) } == sys::Status::napi_ok)
      .then_some(value_type)
  }

  /// A short JavaScript string as UTF-8. `None` when it does not fit in the buffer.
  fn string_value(env: sys::napi_env, value: sys::napi_value) -> Option<String> {
    let mut buffer = [0u8; 64];
    let mut length = 0;
    if unsafe {
      sys::napi_get_value_string_utf8(
        env,
        value,
        buffer.as_mut_ptr().cast(),
        buffer.len(),
        &mut length,
      )
    } != sys::Status::napi_ok
      || length >= buffer.len() - 1
    {
      return None;
    }
    String::from_utf8(buffer[..length].to_vec()).ok()
  }

  /// Whether `version` (`major.minor.patch`, then an optional `-prerelease` or `+build`) is
  /// below `minimum`. A prerelease of `minimum` counts as below it. `None` when it does not
  /// parse.
  fn bun_version_below(version: &str, minimum: (u32, u32, u32)) -> Option<bool> {
    let mut parts = version.splitn(3, '.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    let rest = parts.next()?;
    let digits = rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    let patch: u32 = rest[..digits].parse().ok()?;
    let suffix = &rest[digits..];
    if !(suffix.is_empty() || suffix.starts_with('-') || suffix.starts_with('+')) {
      return None;
    }
    let release = (major, minor, patch);
    Some(release < minimum || (release == minimum && suffix.starts_with('-')))
  }

  type UvDefaultLoop = unsafe extern "C" fn() -> *mut c_void;
  type GetUvEventLoop = unsafe extern "C" fn(sys::napi_env, *mut *mut c_void) -> sys::napi_status;

  struct HostLoop {
    /// `uv_default_loop()`, called once, and only in a host [`may_call_default_loop`] allows.
    /// libuv keeps the default loop in one static struct, so the address never changes for the
    /// life of the process. In a host that never used the default loop, this first call creates
    /// it: one loop and its backend fd stay open for the life of the process (Node, Bun 1.4.4+
    /// and Electron create it at startup, so nothing changes there).
    default_loop: usize,
    get_uv_event_loop: GetUvEventLoop,
  }

  /// Set by the first env that may call `uv_default_loop()`. An env that may not leaves it
  /// unset, so a later env that may still sets it.
  static HOST_LOOP: OnceLock<Option<HostLoop>> = OnceLock::new();

  fn host_loop(bun_with_default_loop: bool) -> Option<&'static HostLoop> {
    if !may_call_default_loop(bun_with_default_loop) {
      return None;
    }
    HOST_LOOP
      .get_or_init(|| {
        let (uv_default_loop, get_uv_event_loop) = host_symbols()?;
        let default_loop = unsafe { uv_default_loop() };
        (!default_loop.is_null()).then_some(HostLoop {
          default_loop: default_loop as usize,
          get_uv_event_loop,
        })
      })
      .as_ref()
  }

  /// Whether `env` runs on libuv's default loop, the loop of the host's main thread. `false`
  /// when `uv_default_loop()` may not be called, the host does not export both symbols, or
  /// `uv_default_loop()` gives null. `bun_with_default_loop`: `process.versions` names Bun
  /// 1.4.4 or later.
  pub(super) fn runs_on_default_loop(env: sys::napi_env, bun_with_default_loop: bool) -> bool {
    let Some(host) = host_loop(bun_with_default_loop) else {
      return false;
    };
    let mut event_loop = ptr::null_mut();
    // No `NAPI_PREAMBLE` (Node: `CHECK_ENV` + `CHECK_ARG` only).
    (unsafe { (host.get_uv_event_loop)(env, &mut event_loop) } == sys::Status::napi_ok)
      && !event_loop.is_null()
      && event_loop as usize == host.default_loop
  }

  /// Whether `uv_default_loop()` may be called: only in a Node-based host or in Bun 1.4.4+.
  /// Bun before 1.4.4 exports it as a stub that aborts the process. `process.versions.bun` is
  /// the only sign of Bun, and a script can delete it, so a missing `versions.bun` does not
  /// prove the host is not Bun. A host that is neither (a Bun below 1.4.4 whose
  /// `versions.bun` was removed, Deno, any other) never has it called and takes the thenable
  /// path.
  #[cfg(any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "solaris",
    target_os = "illumos"
  ))]
  fn may_call_default_loop(bun_with_default_loop: bool) -> bool {
    bun_with_default_loop || node_host()
  }

  /// Whether the host exports `node::Buffer::Data(v8::Local<v8::Value>)` (Itanium-mangled),
  /// declared `NODE_EXTERN` in `node_buffer.h` since Node 0.x. Exported by Node and Electron;
  /// not by Bun (which exports some other `node::` functions) nor Deno. Looked up once.
  #[cfg(any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "solaris",
    target_os = "illumos"
  ))]
  fn node_host() -> bool {
    static NODE_HOST: OnceLock<bool> = OnceLock::new();
    *NODE_HOST.get_or_init(|| {
      // glibc before 2.34 keeps `dlsym` in a separate library.
      #[cfg(any(target_os = "linux", target_os = "android"))]
      #[link(name = "dl")]
      unsafe extern "C" {}

      // `dlsym` adds the leading `_` of Mach-O names itself.
      !unsafe {
        libc::dlsym(
          libc::RTLD_DEFAULT,
          c"_ZN4node6Buffer4DataEN2v85LocalINS1_5ValueEEE".as_ptr(),
        )
      }
      .is_null()
    })
  }

  /// `uv_default_loop` and `napi_get_uv_event_loop` from the global scope, the same scope
  /// napi-sys loads every Node-API function from. Found at run time, not linked: a link-time
  /// import of `uv_default_loop` fails to load on Deno, which does not export it. Also finds
  /// them in a `libnode.so` the executable depends on, so a distro `node` built against it is
  /// placed correctly, and an embedder that links it is not told apart (see
  /// [`SettleMode::Deferred`]). Windows checks the executable only; this difference between the
  /// platforms is accepted.
  #[cfg(any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "solaris",
    target_os = "illumos"
  ))]
  fn host_symbols() -> Option<(UvDefaultLoop, GetUvEventLoop)> {
    // glibc before 2.34 keeps `dlsym` in a separate library.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[link(name = "dl")]
    unsafe extern "C" {}

    let uv_default_loop = unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"uv_default_loop".as_ptr()) };
    let get_uv_event_loop =
      unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"napi_get_uv_event_loop".as_ptr()) };
    if uv_default_loop.is_null() || get_uv_event_loop.is_null() {
      return None;
    }
    // SAFETY: both are the host's exported C functions with these signatures.
    Some(unsafe {
      (
        std::mem::transmute::<*mut c_void, UvDefaultLoop>(uv_default_loop),
        std::mem::transmute::<*mut c_void, GetUvEventLoop>(get_uv_event_loop),
      )
    })
  }

  /// Windows: always, as before. Node, Electron and Bun all have a real libuv there, so the
  /// call cannot abort, and Deno does not export `uv_default_loop`.
  #[cfg(windows)]
  fn may_call_default_loop(_bun_with_default_loop: bool) -> bool {
    true
  }

  /// Windows: the process executable only, not `libnode.dll` / `node.dll`. A host that keeps
  /// Node in a DLL is an embedder, which may create and free several envs on the default loop.
  #[cfg(windows)]
  fn host_symbols() -> Option<(UvDefaultLoop, GetUvEventLoop)> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
      fn GetModuleHandleW(module_name: *const u16) -> *mut c_void;
      fn GetProcAddress(module: *mut c_void, proc_name: *const std::ffi::c_char) -> *mut c_void;
    }
    // Takes no reference, so nothing is freed.
    let exe = unsafe { GetModuleHandleW(ptr::null()) };
    if exe.is_null() {
      return None;
    }
    let uv_default_loop = unsafe { GetProcAddress(exe, c"uv_default_loop".as_ptr()) };
    let get_uv_event_loop = unsafe { GetProcAddress(exe, c"napi_get_uv_event_loop".as_ptr()) };
    if uv_default_loop.is_null() || get_uv_event_loop.is_null() {
      return None;
    }
    // SAFETY: both are the host's exported C functions with these signatures (cdecl, as
    // `NAPI_CDECL` / `UV_EXTERN` declare them, also on i686).
    Some(unsafe {
      (
        std::mem::transmute::<*mut c_void, UvDefaultLoop>(uv_default_loop),
        std::mem::transmute::<*mut c_void, GetUvEventLoop>(get_uv_event_loop),
      )
    })
  }

  /// No portable way to find the symbols: the thenable path.
  #[cfg(not(any(
    windows,
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "solaris",
    target_os = "illumos"
  )))]
  fn may_call_default_loop(_bun_with_default_loop: bool) -> bool {
    false
  }

  /// No portable way to find the symbols: the thenable path.
  #[cfg(not(any(
    windows,
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "solaris",
    target_os = "illumos"
  )))]
  fn host_symbols() -> Option<(UvDefaultLoop, GetUvEventLoop)> {
    None
  }

  #[cfg(test)]
  mod tests {
    use super::bun_version_below;

    #[test]
    fn bun_versions() {
      let min = (1, 4, 4);
      assert_eq!(bun_version_below("1.4.3", min), Some(true));
      assert_eq!(bun_version_below("1.2.21", min), Some(true));
      assert_eq!(bun_version_below("1.4.4", min), Some(false));
      assert_eq!(bun_version_below("1.4.10", min), Some(false));
      assert_eq!(bun_version_below("1.5.0", min), Some(false));
      assert_eq!(bun_version_below("2.0.0", min), Some(false));
      assert_eq!(bun_version_below("1.4.4-canary.1", min), Some(true));
      assert_eq!(bun_version_below("1.4.4+abcdef", min), Some(false));
      assert_eq!(bun_version_below("1.4.5-canary.1", min), Some(false));
      assert_eq!(bun_version_below("1.4", min), None);
      assert_eq!(bun_version_below("1.4.", min), None);
      assert_eq!(bun_version_below("x.4.4", min), None);
      assert_eq!(bun_version_below("1.4.4x", min), None);
      assert_eq!(bun_version_below("", min), None);
    }
  }
}
