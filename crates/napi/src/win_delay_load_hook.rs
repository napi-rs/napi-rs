//! The following directly was copied from [neon][].
//!
//! Rust port of [win_delay_load_hook.cc][].
//!
//! When the addon tries to load the "node.exe" DLL module, this module gives it the pointer to the
//! .exe we are running in instead. Typically, that will be the same value. But if the node executable
//! was renamed, you would not otherwise get the correct DLL.
//!
//! [neon]: https://github.com/neon-bindings/neon/blob/5ffa2d282177b63094c46e92b20b8e850d122e65/src/win_delay_load_hook.rs
//! [win_delay_load_hook.cc]: https://github.com/nodejs/node-gyp/blob/e18a61afc1669d4897e6c5c8a6694f4995a0f4d6/src/win_delay_load_hook.cc

use std::ffi::CStr;

use windows_sys::Win32::Foundation::{HINSTANCE, PSTR};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleA;
use windows_sys::Win32::System::WindowsProgramming::{
  DELAYLOAD_INFO, PDELAYLOAD_FAILURE_DLL_CALLBACK,
};

// Structures hand-copied from
// https://docs.microsoft.com/en-us/cpp/build/reference/structure-and-constant-definitions

const HOST_BINARIES: &[&[u8]] = &[b"node.exe", b"electron.exe"];

unsafe extern "C" fn load_exe_hook(event: u32, info: *const DELAYLOAD_INFO) -> HINSTANCE {
  if event != 0x01
  /* dliNotePreLoadLibrary */
  {
    return HINSTANCE::default();
  }

  let dll_name = unsafe { CStr::from_ptr((*info).TargetDllName.0 as *mut i8) };
  if !HOST_BINARIES
    .iter()
    .any(|&host_name| host_name == dll_name.to_bytes())
  {
    return HINSTANCE::default();
  }

  unsafe { GetModuleHandleA(PSTR::default()) }
}

#[no_mangle]
static mut __pfnDliNotifyHook2: *mut PDELAYLOAD_FAILURE_DLL_CALLBACK =
  load_exe_hook as *mut PDELAYLOAD_FAILURE_DLL_CALLBACK;
