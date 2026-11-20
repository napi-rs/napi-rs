//! Self-loading trampoline for compressed `.node` addons. Node loads the stub,
//! which resolves the embedded addon and forwards N-API registration.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

type NapiEnv = *mut c_void;
type NapiValue = *mut c_void;
type RegisterFn = unsafe extern "C" fn(NapiEnv, NapiValue) -> NapiValue;
static REGISTER: std::sync::Mutex<Option<RegisterFn>> = std::sync::Mutex::new(None);

unsafe fn throw_init_error(env: NapiEnv) {
  #[cfg(unix)]
  {
    type ThrowError =
      unsafe extern "C" fn(NapiEnv, *const std::ffi::c_char, *const std::ffi::c_char) -> i32;
    let function = libc::dlsym(libc::RTLD_DEFAULT, c"napi_throw_error".as_ptr());
    if !function.is_null() {
      let function: ThrowError = std::mem::transmute(function);
      function(
        env,
        std::ptr::null(),
        c"compressed addon initialization failed".as_ptr(),
      );
    }
  }
  #[cfg(windows)]
  {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    type ThrowError =
      unsafe extern "C" fn(NapiEnv, *const std::ffi::c_char, *const std::ffi::c_char) -> i32;
    let module = GetModuleHandleW(std::ptr::null());
    if !module.is_null() {
      if let Some(function) = GetProcAddress(module, c"napi_throw_error".as_ptr().cast()) {
        let function: ThrowError = std::mem::transmute(function);
        function(
          env,
          std::ptr::null(),
          c"compressed addon initialization failed".as_ptr(),
        );
      }
    }
  }
}

/// Node's entry point for a native addon.
///
/// # Safety
/// Called by Node with a valid env/exports during module load.
#[no_mangle]
pub unsafe extern "C" fn napi_register_module_v1(env: NapiEnv, exports: NapiValue) -> NapiValue {
  let register = {
    let mut loaded = REGISTER.lock().unwrap_or_else(|error| error.into_inner());
    if loaded.is_none() {
      *loaded = trampoline().ok();
    }
    *loaded
  };
  match register {
    Some(register) => register(env, exports),
    None => {
      throw_init_error(env);
      std::ptr::null_mut()
    }
  }
}

unsafe fn trampoline() -> Result<RegisterFn, ()> {
  let stub = own_path().ok_or(())?;
  // Resolve the embedded payload to a cached addon. On Btrfs, the carrier is also
  // replaced for future processes.
  let loadable = napi_native_addon::resolve_self(&stub).ok_or(())?;
  let register = load_register(&loadable).ok_or(())?;
  napi_native_addon::cleanup_after_load(&loadable);
  Ok(register)
}

#[cfg(unix)]
unsafe fn own_path() -> Option<PathBuf> {
  use std::os::unix::ffi::OsStrExt;
  let mut info: libc::Dl_info = std::mem::zeroed();
  if libc::dladdr(napi_register_module_v1 as *const c_void, &mut info) == 0
    || info.dli_fname.is_null()
  {
    return None;
  }
  let bytes = std::ffi::CStr::from_ptr(info.dli_fname).to_bytes();
  Some(PathBuf::from(std::ffi::OsStr::from_bytes(bytes)))
}

#[cfg(unix)]
unsafe fn load_register(path: &Path) -> Option<RegisterFn> {
  use std::os::unix::ffi::OsStrExt;
  let cpath = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
  let handle = libc::dlopen(cpath.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
  if handle.is_null() {
    return None;
  }
  let sym = libc::dlsym(handle, c"napi_register_module_v1".as_ptr());
  if sym.is_null() {
    return None;
  }
  Some(std::mem::transmute::<*mut c_void, RegisterFn>(sym))
}

#[cfg(windows)]
unsafe fn own_path() -> Option<PathBuf> {
  use std::os::windows::ffi::OsStringExt;

  use windows_sys::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
  };

  let mut module = std::ptr::null_mut();
  let ok = GetModuleHandleExW(
    GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    napi_register_module_v1 as *const u16,
    &mut module,
  );
  if ok == 0 {
    return None;
  }
  let mut buf = [0u16; 32768];
  let len = GetModuleFileNameW(module, buf.as_mut_ptr(), buf.len() as u32);
  if len == 0 {
    return None;
  }
  Some(PathBuf::from(std::ffi::OsString::from_wide(
    &buf[..len as usize],
  )))
}

#[cfg(windows)]
unsafe fn load_register(path: &Path) -> Option<RegisterFn> {
  use std::os::windows::ffi::OsStrExt;

  use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

  let wide: Vec<u16> = path
    .as_os_str()
    .encode_wide()
    .chain(std::iter::once(0))
    .collect();
  let module = LoadLibraryW(wide.as_ptr());
  if module.is_null() {
    return None;
  }
  let proc = GetProcAddress(module, c"napi_register_module_v1".as_ptr().cast())?;
  Some(std::mem::transmute::<
    unsafe extern "system" fn() -> isize,
    RegisterFn,
  >(proc))
}
