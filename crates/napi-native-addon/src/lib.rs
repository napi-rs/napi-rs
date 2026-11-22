//! Runtime support for compressed N-API addons.
//!
//! The producer places a zstd payload in a signable section of a small `.node`
//! trampoline. The trampoline decodes it to a per-user cache and forwards N-API
//! registration. On Btrfs, it also tries to replace the carrier with the decoded
//! addon using the filesystem's enabled compression codec.
//!
//! Decoding failures leave the carrier untouched and fall back to the ordinary
//! loader failure. Unsupported filesystems use the cache path.

#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

use std::path::Path;

/// Lock the directory containing a carrier while reading or replacing it.
/// The producer takes the same lock before publishing a rebuilt addon.
#[cfg(target_os = "linux")]
pub fn lock_output_directory(path: &Path) -> std::io::Result<std::fs::File> {
  use std::os::fd::AsRawFd;

  let dir = path
    .parent()
    .filter(|dir| !dir.as_os_str().is_empty())
    .unwrap_or_else(|| Path::new("."));
  let lock = std::fs::File::open(dir)?;
  if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } == -1 {
    return Err(std::io::Error::last_os_error());
  }
  Ok(lock)
}

/// What happened to the file. Only `Err` is a hard failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
  /// Applied and on-disk allocation actually decreased.
  Compressed { before: u64, after: u64 },
  /// Applied (or already set) but on-disk size did not drop — incompressible
  /// or sub-cluster. Content is byte-identical and fully loadable.
  NoGain { before: u64, after: u64 },
  /// Already carried the Btrfs compression flag before we touched it.
  AlreadyCompressed { before: u64 },
  /// This FS/OS has no per-file transparent compression (ext4, xfs, ZFS, ReFS,
  /// FAT, tmpfs, overlay/network mounts). Caller falls through to the cache.
  Unsupported { reason: UnsupportedReason },
  /// Detected support but could not apply (permissions, locks, filesystem limits).
  /// Warn-and-continue; never a hard error.
  Skipped { reason: SkipReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsupportedReason {
  /// Filesystem (by allowlist) has no transparent compression.
  Filesystem,
  /// Network/overlay/bind mount where the signal is unreliable.
  NetworkOrOverlay,
  /// Built for an OS with no backend (or skeleton: not yet implemented).
  PlatformBuild,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
  /// EACCES / EPERM / EROFS — read-only or unowned (e.g. unprivileged container).
  PermissionDenied,
  /// A write handle is held / ETXTBSY / sharing violation; could not lock.
  Busy,
  /// Post-apply loadability (magic-bytes) check failed, rolled back.
  NotLoadable,
  /// Exceeds a backend limit (e.g. napi-native-addon u32 offsets cap at 4 GiB).
  TooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Support {
  Supported,
  AlreadyCompressed,
  Unsupported(UnsupportedReason),
}

/// Genuine failures only. A capability/permission gap is an `Outcome`, not an `Error`.
#[derive(Debug)]
pub enum Error {
  Io {
    context: &'static str,
    source: std::io::Error,
  },
  NotFound(std::path::PathBuf),
}

impl std::fmt::Display for Error {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Error::Io { context, source } => write!(f, "io error at {context}: {source}"),
      Error::NotFound(p) => write!(f, "file not found: {}", p.display()),
    }
  }
}

impl std::error::Error for Error {
  fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
    match self {
      Error::Io { source, .. } => Some(source),
      Error::NotFound(_) => None,
    }
  }
}

/// First bytes of a raw, loadable native module: ELF, Mach-O (32/64, LE/BE,
/// universal), or PE. Used to verify a decoded payload will actually load.
fn is_native_binary(head: &[u8]) -> bool {
  if head.len() < 4 {
    return false;
  }
  matches!(
    [head[0], head[1], head[2], head[3]],
    [0x7f, 0x45, 0x4c, 0x46]        // ELF
            | [0xcf, 0xfa, 0xed, 0xfe]  // Mach-O 64 LE
            | [0xfe, 0xed, 0xfa, 0xcf]  // Mach-O 64 BE
            | [0xce, 0xfa, 0xed, 0xfe]  // Mach-O 32 LE
            | [0xfe, 0xed, 0xfa, 0xce]  // Mach-O 32 BE
            | [0xca, 0xfe, 0xba, 0xbe]  // Mach-O universal
            | [0xbe, 0xba, 0xfe, 0xca] // Mach-O universal (byte-swapped)
  ) || (head[0] == 0x4d && head[1] == 0x5a) // PE ("MZ")
}

/// Wrap the last OS error with context — shared by every backend.
#[cfg(target_os = "linux")]
pub(crate) fn io(context: &'static str) -> Error {
  Error::Io {
    context,
    source: std::io::Error::last_os_error(),
  }
}

/// A NUL-checked C string from a path, for the unix backends that hand paths to
/// libc.
#[cfg(target_os = "linux")]
pub(crate) fn cstring(path: &Path) -> Result<std::ffi::CString, Error> {
  use std::os::unix::ffi::OsStrExt;
  std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| Error::Io {
    context: "path has interior NUL",
    source: std::io::Error::from(std::io::ErrorKind::InvalidInput),
  })
}

/// The stub entry point. Reads its own `SMOL/__NAPI_PAYLOAD`
/// section to locate the zstd payload + its content hash, then takes the cheapest
/// path:
///   - a warm cache returns the cached path after reading its hash and checking it;
///   - a cold miss decodes the payload, optionally replaces the carrier on Btrfs,
///     and writes a cache file for the current load.
///
/// Sweep + the expensive work happen only on a real miss, never on the hot path.
pub fn resolve_self(self_path: &Path) -> Option<std::path::PathBuf> {
  let section = match section::read_self_section(self_path) {
    Some(section) => section,
    None => {
      // Another process may have replaced the carrier after this one loaded it.
      let cache = write_cache_from_file(self_path)?;
      if let Some(dir) = self_path.parent() {
        sweep_old(dir);
      }
      return Some(cache);
    }
  };
  if let Some(hit) = cache_path(self_path, section.content_hash).filter(|path| {
    path.is_file()
      && cache_entry_is_trusted(path)
      && path.parent().is_some_and(cache_entry_is_trusted)
  }) {
    return Some(hit);
  }

  #[cfg(target_os = "linux")]
  let output_lock = lock_output_directory(self_path).ok();
  #[cfg(target_os = "linux")]
  let section = if output_lock.is_some() {
    match section::read_self_section(self_path) {
      Some(section) => section,
      None => {
        let cache = write_cache_from_file(self_path)?;
        if let Some(dir) = self_path.parent() {
          sweep_old(dir);
        }
        return Some(cache);
      }
    }
  } else {
    section
  };
  #[cfg(target_os = "linux")]
  let carrier_identity = output_lock
    .as_ref()
    .and_then(|_| CarrierIdentity::read(self_path));

  if let Some(hit) = cache_path(self_path, section.content_hash).filter(|path| {
    path.is_file()
      && cache_entry_is_trusted(path)
      && path.parent().is_some_and(cache_entry_is_trusted)
  }) {
    return Some(hit);
  }

  let replace_for_btrfs = matches!(
    probe(self_path),
    Ok(Support::Supported) | Ok(Support::AlreadyCompressed)
  );
  let cache = write_cache(self_path, section.content_hash, &section.payload)?;

  if let Some(dir) = self_path.parent() {
    sweep_old(dir);
  }
  if replace_for_btrfs {
    #[cfg(target_os = "linux")]
    if let Some(identity) = carrier_identity {
      let _ = replace_self(self_path, &cache, identity);
    }
  }
  Some(cache)
}

/// The content-addressed cache path for `hash` — computable from the section header
/// alone, so
/// the warm path never decodes. Location follows `NAPI_RS_NATIVE_CACHE`; `=0` uses a
/// per-process name so disk never holds more than the blob plus one expansion.
fn cache_path(self_path: &Path, hash: u64) -> Option<std::path::PathBuf> {
  let dir = resolve_cache_dir(self_path)?;
  let stem = self_path.file_stem()?.to_string_lossy();
  let no_cache = matches!(
    std::env::var("NAPI_RS_NATIVE_CACHE").as_deref(),
    Ok("0") | Ok("false") | Ok("none")
  );
  Some(if no_cache {
    dir.join(format!("{stem}-{hash:016x}-p{}.node", std::process::id()))
  } else {
    dir.join(format!("{stem}-{hash:016x}.node"))
  })
}

/// Decode a cache miss to a sibling file and publish it atomically.
fn write_cache(self_path: &Path, hash: u64, payload: &[u8]) -> Option<std::path::PathBuf> {
  let cache_file = cache_path(self_path, hash)?;
  let dir = cache_file.parent()?;
  create_cache_dir(dir)?;
  let temp = unique_temp_path(dir, "napi-addon-cache")?;
  let result = (|| {
    let mut file = private_new_file(&temp)?;
    decode_into(payload, hash, &mut file)?;
    file.sync_all().ok()?;
    drop(file);
    match std::fs::rename(&temp, &cache_file) {
      Ok(()) => Some(cache_file.clone()),
      Err(_) if cache_file.exists() => Some(cache_file.clone()),
      Err(_) => None,
    }
  })();
  if result.is_none() || temp.exists() {
    let _ = std::fs::remove_file(&temp);
  }
  result
}

/// Cache an addon another process has already unpacked into the carrier path.
fn write_cache_from_file(self_path: &Path) -> Option<std::path::PathBuf> {
  use std::io::{Read, Write};

  let dir = resolve_cache_dir(self_path)?;
  create_cache_dir(&dir)?;
  let temp = unique_temp_path(&dir, "napi-addon-cache")?;
  let result = (|| {
    let mut input = std::fs::File::open(self_path).ok()?;
    let mut output = private_new_file(&temp)?;
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let mut head = [0; 4];
    let mut head_len = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
      let count = input.read(&mut buffer).ok()?;
      if count == 0 {
        break;
      }
      let bytes = &buffer[..count];
      let remaining = head.len() - head_len;
      let copied = remaining.min(bytes.len());
      head[head_len..head_len + copied].copy_from_slice(&bytes[..copied]);
      head_len += copied;
      for &byte in bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
      }
      output.write_all(bytes).ok()?;
    }
    if !is_native_binary(&head[..head_len]) {
      return None;
    }
    output.sync_all().ok()?;
    drop(output);

    let cache_file = cache_path(self_path, hash)?;
    match std::fs::rename(&temp, &cache_file) {
      Ok(()) => {}
      Err(_) if cache_file.exists() => {
        let _ = std::fs::remove_file(&temp);
      }
      Err(_) => return None,
    }
    (cache_entry_is_trusted(&cache_file) && cache_file.parent().is_some_and(cache_entry_is_trusted))
      .then_some(cache_file)
  })();
  if result.is_none() || temp.exists() {
    let _ = std::fs::remove_file(&temp);
  }
  result
}

/// Remove leftovers from crashed runs. Called only when doing real work.
fn sweep_old(dir: &Path) {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let name = entry.file_name();
    let name = name.to_string_lossy();
    if name.ends_with(".old") && name.contains(".node.") {
      let _ = std::fs::remove_file(entry.path());
    }
    #[cfg(windows)]
    if let Some((_, pid)) = name
      .strip_suffix(".node")
      .and_then(|stem| stem.rsplit_once("-p"))
    {
      if let Ok(pid) = pid.parse::<u32>() {
        if pid != std::process::id() && !windows_process_is_running(pid) {
          let _ = std::fs::remove_file(entry.path());
        }
      }
    }
  }
}

#[cfg(windows)]
fn windows_process_is_running(pid: u32) -> bool {
  use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
  use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
  };

  let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
  if process.is_null() {
    return false;
  }
  let mut exit_code = 0;
  let running =
    unsafe { GetExitCodeProcess(process, &mut exit_code) != 0 && exit_code == STILL_ACTIVE as u32 };
  unsafe { CloseHandle(process) };
  running
}

/// Cheap content-address (FNV-1a 64) the producer runs over the RAW addon and stamps
/// into the `__NAPI_PAYLOAD` section header — a cache-lookup key, not a security boundary
/// (npm + the FS cover integrity), so no crypto dep; collisions across a node_modules
/// are irrelevant.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
  let mut hash = 0xcbf2_9ce4_8422_2325u64;
  for &b in bytes {
    hash ^= b as u64;
    hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
  }
  hash
}

/// Install the decoded addon after filesystem compression succeeds.
#[cfg(target_os = "linux")]
fn replace_self(
  self_path: &Path,
  raw_path: &Path,
  expected_identity: CarrierIdentity,
) -> Option<()> {
  use std::io::Write;

  if CarrierIdentity::read(self_path)? != expected_identity {
    return None;
  }
  let temp = unique_temp_path(self_path.parent()?, "napi-addon-copy")?;
  let result = (|| {
    let mut input = std::fs::File::open(raw_path).ok()?;
    let mut output = private_new_file(&temp)?;
    std::io::copy(&mut input, &mut output).ok()?;
    let permissions = std::fs::metadata(self_path)
      .or_else(|_| input.metadata())
      .ok()?
      .permissions();
    output.set_permissions(permissions).ok()?;
    output.flush().ok()?;
    output.sync_all().ok()?;
    drop(output);
    match compress_file(&temp).ok()? {
      Outcome::Compressed { .. } | Outcome::AlreadyCompressed { .. } => {}
      _ => return None,
    }
    if CarrierIdentity::read(self_path)? != expected_identity {
      return None;
    }
    std::fs::rename(&temp, self_path).ok()?;
    Some(())
  })();
  if result.is_none() || temp.exists() {
    let _ = std::fs::remove_file(&temp);
  }
  result
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CarrierIdentity {
  device: u64,
  inode: u64,
}

#[cfg(target_os = "linux")]
impl CarrierIdentity {
  fn read(path: &Path) -> Option<Self> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::metadata(path).ok()?;
    Some(Self {
      device: metadata.dev(),
      inode: metadata.ino(),
    })
  }
}

/// Mark `path` (the renamed-away, still-loaded stub) for deletion when its last
/// handle closes — at process exit. Uses POSIX-semantics disposition so the name is
/// freed immediately and no reboot/admin is needed.
#[cfg(windows)]
fn windows_delete_on_close(path: &Path) {
  use std::os::windows::ffi::OsStrExt;

  use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
  use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FileDispositionInfoEx, SetFileInformationByHandle, DELETE,
    FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_POSIX_SEMANTICS, FILE_DISPOSITION_INFO_EX,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
  };

  let wide: Vec<u16> = path
    .as_os_str()
    .encode_wide()
    .chain(std::iter::once(0))
    .collect();
  let handle: HANDLE = unsafe {
    CreateFileW(
      wide.as_ptr(),
      DELETE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      std::ptr::null(),
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS,
      std::ptr::null_mut(),
    )
  };
  if handle == INVALID_HANDLE_VALUE || handle.is_null() {
    return;
  }
  let mut info = FILE_DISPOSITION_INFO_EX {
    Flags: FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS,
  };
  let deleted = unsafe {
    SetFileInformationByHandle(
      handle,
      FileDispositionInfoEx,
      (&mut info as *mut FILE_DISPOSITION_INFO_EX).cast(),
      std::mem::size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
    ) != 0
  };
  unsafe {
    CloseHandle(handle);
  }
  if !deleted {
    let _ = std::fs::remove_file(path);
  }
}

/// Per-uid cache subdir. The warm path trusts its own cache file (it `dlopen`s it
/// without re-decoding) — the exact trust model as Node's own compile cache, which
/// writes to the same OS temp dir. So we mirror Node's mitigation: namespace the
/// directory by uid so users don't share one in a world-writable `/tmp` (the
/// cache-poisoning surface). Node v26.3.1 `src/compile_cache.cc` `GetCacheKey`
/// appends `getuid()` for the same reason; `%TEMP%` is already per-user on Windows.
/// Ref: https://github.com/nodejs/node/blob/v26.3.1/src/compile_cache.cc
fn cache_subdir() -> String {
  #[cfg(unix)]
  {
    format!("napi-rs-native-{}", unsafe { libc::getuid() })
  }
  #[cfg(windows)]
  {
    String::from("napi-rs-native")
  }
}

fn create_cache_dir(dir: &Path) -> Option<()> {
  if let Some(parent) = dir.parent() {
    std::fs::create_dir_all(parent).ok()?;
  }
  #[cfg(unix)]
  {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(false).mode(0o700);
    match builder.create(dir) {
      Ok(()) => {}
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
        if !cache_entry_is_owned(dir) {
          return None;
        }
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).ok()?;
      }
      Err(_) => return None,
    }
  }
  #[cfg(not(unix))]
  std::fs::create_dir_all(dir).ok()?;
  cache_entry_is_trusted(dir).then_some(())
}

fn cache_entry_is_trusted(path: &Path) -> bool {
  let Ok(metadata) = std::fs::symlink_metadata(path) else {
    return false;
  };
  if metadata.file_type().is_symlink() {
    return false;
  }
  #[cfg(unix)]
  {
    use std::os::unix::fs::MetadataExt;
    metadata.uid() == unsafe { libc::getuid() } && metadata.mode() & 0o077 == 0
  }
  #[cfg(windows)]
  {
    metadata.is_dir() || metadata.is_file()
  }
  #[cfg(not(any(unix, windows)))]
  {
    metadata.is_dir() || metadata.is_file()
  }
}

#[cfg(unix)]
fn cache_entry_is_owned(path: &Path) -> bool {
  use std::os::unix::fs::MetadataExt;
  std::fs::symlink_metadata(path).is_ok_and(|metadata| {
    !metadata.file_type().is_symlink()
      && metadata.is_dir()
      && metadata.uid() == unsafe { libc::getuid() }
  })
}

fn private_new_file(path: &Path) -> Option<std::fs::File> {
  let mut options = std::fs::OpenOptions::new();
  options.write(true).create_new(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  options.open(path).ok()
}

/// Remove a per-process decoded file after the loader has mapped it.
pub fn cleanup_after_load(path: &Path) {
  if !matches!(
    std::env::var("NAPI_RS_NATIVE_CACHE").as_deref(),
    Ok("0") | Ok("false") | Ok("none")
  ) {
    return;
  }
  #[cfg(unix)]
  {
    let _ = std::fs::remove_file(path);
    if let Some(dir) = path.parent() {
      let _ = std::fs::remove_dir(dir);
    }
  }
  #[cfg(windows)]
  windows_delete_on_close(path);
}

/// Resolve the fallback cache directory from `NAPI_RS_NATIVE_CACHE`:
/// unset / `tmpdir` → OS temp; `node_modules` → nearest `node_modules/.cache`;
/// `workspace` → workspace-root `node_modules/.cache`; `0`/`false`/`none` → OS temp
/// (per-process file); any other value → that path. Only the FALLBACK uses this;
/// the OS path overwrites the payload in place and never touches the cache.
fn resolve_cache_dir(payload: &Path) -> Option<std::path::PathBuf> {
  let subdir = cache_subdir();
  match std::env::var("NAPI_RS_NATIVE_CACHE").as_deref() {
    Ok("0") | Ok("false") | Ok("none") => Some(std::env::temp_dir().join(&subdir)),
    Ok("node_modules") => Some(nearest_node_modules(payload)?.join(".cache").join(&subdir)),
    Ok("workspace") => Some(
      workspace_node_modules(payload)?
        .join(".cache")
        .join(&subdir),
    ),
    Ok(path) if !path.is_empty() && path != "tmpdir" => Some(Path::new(path).join(&subdir)),
    _ => Some(std::env::temp_dir().join(&subdir)),
  }
}

/// Nearest ancestor directory named `node_modules`.
fn nearest_node_modules(start: &Path) -> Option<std::path::PathBuf> {
  let mut dir = start.parent();
  while let Some(d) = dir {
    if d.file_name().is_some_and(|n| n == "node_modules") {
      return Some(d.to_path_buf());
    }
    dir = d.parent();
  }
  None
}

/// The workspace root's `node_modules`, found by a workspace manifest; falls back to
/// the topmost `node_modules` ancestor.
fn workspace_node_modules(start: &Path) -> Option<std::path::PathBuf> {
  const MARKERS: [&str; 5] = [
    "pnpm-workspace.yaml",
    "aube-workspace.yaml",
    "vlt-workspaces.json",
    "lerna.json",
    "rush.json",
  ];
  let mut topmost = None;
  let mut dir = start.parent();
  while let Some(d) = dir {
    if d.file_name().is_some_and(|n| n == "node_modules") {
      topmost = Some(d.to_path_buf());
    }
    if MARKERS.iter().any(|m| d.join(m).exists()) {
      return Some(d.join("node_modules"));
    }
    if std::fs::read_to_string(d.join("package.json")).is_ok_and(|s| s.contains("\"workspaces\"")) {
      return Some(d.join("node_modules"));
    }
    dir = d.parent();
  }
  topmost
}

pub const MAX_DECODED_SIZE: u64 = 2 * 1024 * 1024 * 1024;
const BULK_DECODE_LIMIT: u64 = 64 * 1024 * 1024;
const MAX_WINDOW_SIZE: u64 = 64 * 1024 * 1024;

fn decode_into(
  payload: &[u8],
  expected_hash: u64,
  output: &mut impl std::io::Write,
) -> Option<u64> {
  use std::io::Read;

  if zstd::zstd_safe::find_frame_compressed_size(payload).ok()? != payload.len() {
    return None;
  }
  let raw_len = zstd::zstd_safe::get_frame_content_size(payload).ok()?;
  if raw_len.is_some_and(|size| size == 0 || size > MAX_DECODED_SIZE) {
    return None;
  }
  let window_size = zstd_window_size(payload, raw_len)?;
  if window_size > MAX_WINDOW_SIZE {
    return None;
  }
  let window_log = (64
    - raw_len
      .unwrap_or(MAX_WINDOW_SIZE)
      .max(window_size)
      .saturating_sub(1)
      .leading_zeros())
  .max(10);
  let mut hash = 0xcbf2_9ce4_8422_2325u64;
  let mut written = 0u64;
  let mut prefix = [0u8; 4];

  if raw_len.is_some_and(|size| size <= BULK_DECODE_LIMIT && window_size >= size) {
    let mut decoder = zstd::bulk::Decompressor::new().ok()?;
    decoder
      .set_parameter(zstd::zstd_safe::DParameter::WindowLogMax(window_log))
      .ok()?;
    let raw_len = usize::try_from(raw_len?).ok()?;
    let decoded = decoder.decompress(payload, raw_len).ok()?;
    if decoded.len() != raw_len {
      return None;
    }
    for chunk in decoded.chunks(1024 * 1024) {
      write_decoded_chunk(
        chunk,
        raw_len as u64,
        output,
        &mut written,
        &mut hash,
        &mut prefix,
      )?;
    }
  } else {
    let mut decoder = zstd::stream::read::Decoder::with_buffer(payload)
      .ok()?
      .single_frame();
    decoder.window_log_max(window_log).ok()?;
    let mut buffer = [0; 256 * 1024];
    loop {
      let read = decoder.read(&mut buffer).ok()?;
      if read == 0 {
        break;
      }
      write_decoded_chunk(
        &buffer[..read],
        raw_len.unwrap_or(MAX_DECODED_SIZE),
        output,
        &mut written,
        &mut hash,
        &mut prefix,
      )?;
    }
  }

  if raw_len.is_some_and(|size| written != size)
    || !is_native_binary(&prefix)
    || hash != expected_hash
  {
    return None;
  }
  Some(written)
}

fn write_decoded_chunk(
  chunk: &[u8],
  expected_size: u64,
  output: &mut impl std::io::Write,
  written: &mut u64,
  hash: &mut u64,
  prefix: &mut [u8; 4],
) -> Option<()> {
  let start = *written;
  *written = written.checked_add(chunk.len() as u64)?;
  if *written > MAX_DECODED_SIZE || *written > expected_size {
    return None;
  }
  if start < prefix.len() as u64 {
    let copy_len = (prefix.len() as u64 - start).min(chunk.len() as u64) as usize;
    prefix[start as usize..start as usize + copy_len].copy_from_slice(&chunk[..copy_len]);
  }
  *hash = fnv1a64_update(*hash, chunk);
  output.write_all(chunk).ok()?;
  Some(())
}

fn fnv1a64_update(mut hash: u64, bytes: &[u8]) -> u64 {
  for &byte in bytes {
    hash ^= byte as u64;
    hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
  }
  hash
}

#[cfg(test)]
fn decode(payload: &[u8], expected_hash: u64) -> Option<Vec<u8>> {
  let mut output = Vec::new();
  decode_into(payload, expected_hash, &mut output)?;
  Some(output)
}

fn zstd_window_size(frame: &[u8], raw_len: Option<u64>) -> Option<u64> {
  if frame.len() < 6 || frame.get(..4)? != [0x28, 0xb5, 0x2f, 0xfd] {
    return None;
  }
  if frame[4] & 0x20 != 0 {
    return raw_len;
  }

  let descriptor = frame[5];
  let base = 1_u64.checked_shl(10 + u32::from(descriptor >> 3))?;
  Some(base + (base / 8) * u64::from(descriptor & 7))
}

fn unique_temp_path(dir: &Path, prefix: &str) -> Option<std::path::PathBuf> {
  use std::sync::atomic::{AtomicU64, Ordering};
  static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

  for _ in 0..100 {
    let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let path = dir.join(format!(".{prefix}-{}-{id}.tmp", std::process::id()));
    if !path.exists() {
      return Some(path);
    }
  }
  None
}

/// Detect-only, no mutation — for dry-run / capability reporting.
pub fn probe(path: &Path) -> Result<Support, Error> {
  backend::detect(path)
}

/// THE entry point: detect → gate → apply → verify → rollback-on-failure.
/// Idempotent. Never panics. Never corrupts the file.
pub fn compress_file(path: &Path) -> Result<Outcome, Error> {
  if !path.exists() {
    return Err(Error::NotFound(path.to_path_buf()));
  }
  match backend::detect(path)? {
    Support::Unsupported(reason) => Ok(Outcome::Unsupported { reason }),
    Support::AlreadyCompressed => Ok(Outcome::AlreadyCompressed {
      before: verify::on_disk_bytes(path)?,
    }),
    Support::Supported => safety::apply_guarded(path),
  }
}

mod safety;
pub mod section;
mod verify;

#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod backend;
#[cfg(not(target_os = "linux"))]
#[path = "unsupported.rs"]
mod backend;

#[cfg(test)]
mod tests {
  use super::*;

  fn scratch(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("napi-native-addon-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  // A minimal "loadable" payload: native magic so is_native_binary accepts it.
  fn fake_addon() -> Vec<u8> {
    let mut raw = vec![0x7f, 0x45, 0x4c, 0x46]; // ELF
    raw.extend_from_slice(&[7u8; 9000]);
    raw
  }

  #[test]
  fn detects_native_magics() {
    assert!(is_native_binary(&[0x7f, 0x45, 0x4c, 0x46, 0, 0])); // ELF
    assert!(is_native_binary(&[0xcf, 0xfa, 0xed, 0xfe])); // Mach-O 64 LE
    assert!(is_native_binary(&[0xfe, 0xed, 0xfa, 0xcf])); // Mach-O 64 BE
    assert!(is_native_binary(&[0xce, 0xfa, 0xed, 0xfe])); // Mach-O 32 LE
    assert!(is_native_binary(&[0xfe, 0xed, 0xfa, 0xce])); // Mach-O 32 BE
    assert!(is_native_binary(&[0xca, 0xfe, 0xba, 0xbe])); // Mach-O universal
    assert!(is_native_binary(&[0xbe, 0xba, 0xfe, 0xca])); // Mach-O universal swapped
    assert!(is_native_binary(&[0x4d, 0x5a, 0x90, 0x00])); // PE "MZ"
    assert!(!is_native_binary(b"NAPC"));
    assert!(!is_native_binary(&[0x00, 0x01]));
    assert!(!is_native_binary(&[0x7f, 0x45])); // too short
  }

  #[test]
  fn resolve_self_returns_none_without_a_section() {
    let dir = scratch("no-section");
    let path = dir.join("tiny.node");
    std::fs::write(&path, [0u8; 8]).unwrap(); // not a parseable object → no section
    assert!(
      resolve_self(&path).is_none(),
      "no __NAPI_PAYLOAD section → None"
    );
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn resolve_self_caches_an_addon_replaced_by_another_process() {
    let _guard = ENV_LOCK.lock().unwrap();
    let dir = scratch("replaced-carrier");
    let cache = dir.join("cache");
    std::env::set_var("NAPI_RS_NATIVE_CACHE", &cache);
    let path = dir.join("addon.node");
    let raw = fake_addon();
    std::fs::write(&path, &raw).unwrap();

    let loaded = resolve_self(&path).expect("cache the already-replaced addon");
    assert_eq!(std::fs::read(&loaded).unwrap(), raw);
    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn compress_file_errors_when_missing() {
    let p = std::path::Path::new("/no/such/addon.node");
    assert!(matches!(compress_file(p), Err(Error::NotFound(_))));
  }

  #[cfg(unix)]
  #[test]
  fn compress_file_reports_unsupported_on_a_non_compressing_fs() {
    // /dev/null exists but devfs/devtmpfs has no compression backend → Unsupported,
    // exercising compress_file's Unsupported match arm.
    let out = compress_file(std::path::Path::new("/dev/null"));
    assert!(
      matches!(out, Ok(Outcome::Unsupported { .. })),
      "devfs → Unsupported, got {out:?}"
    );
  }

  #[test]
  fn decode_roundtrips_zstd() {
    let raw = fake_addon();
    let payload = zstd::encode_all(&raw[..], 3).unwrap();
    assert_eq!(decode(&payload, fnv1a64(&raw)).unwrap(), raw);
  }

  #[test]
  fn decode_rejects_wrong_hash_and_trailing_data() {
    let raw = fake_addon();
    let payload = zstd::encode_all(&raw[..], 3).unwrap();
    assert!(decode(&payload, fnv1a64(&raw) ^ 1).is_none());

    let mut trailing = payload;
    trailing.extend_from_slice(b"trailing");
    assert!(decode(&trailing, fnv1a64(&raw)).is_none());
  }

  #[test]
  fn decode_rejects_an_output_that_cannot_be_written() {
    struct FailedWriter;
    impl std::io::Write for FailedWriter {
      fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
        Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
      }

      fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
      }
    }

    let raw = fake_addon();
    let payload = zstd::encode_all(&raw[..], 3).unwrap();
    assert!(decode_into(&payload, fnv1a64(&raw), &mut FailedWriter).is_none());
  }

  #[test]
  fn decode_streams_frames_with_a_smaller_history_window() {
    let mut raw = fake_addon();
    raw.resize(2 * 1024 * 1024, 0x5a);
    let mut compressor = zstd::bulk::Compressor::new(3).unwrap();
    compressor
      .set_parameter(zstd::zstd_safe::CParameter::WindowLog(10))
      .unwrap();
    compressor.include_contentsize(false).unwrap();
    let payload = compressor.compress(&raw).unwrap();
    assert!(zstd_window_size(&payload, Some(raw.len() as u64)).unwrap() < raw.len() as u64);
    assert_eq!(decode(&payload, fnv1a64(&raw)).unwrap(), raw);
  }

  #[test]
  fn decode_streams_unknown_size_frames() {
    let raw = fake_addon();
    let mut encoder = zstd::stream::Encoder::new(Vec::new(), 3).unwrap();
    encoder.include_contentsize(false).unwrap();
    use std::io::Write;
    encoder.write_all(&raw).unwrap();
    let payload = encoder.finish().unwrap();
    assert_eq!(
      zstd::zstd_safe::get_frame_content_size(&payload).unwrap(),
      None
    );
    assert_eq!(decode(&payload, fnv1a64(&raw)).unwrap(), raw);
  }

  #[test]
  fn zstd_window_parser_enforces_the_64_mib_limit() {
    let frame_prefix = [0x28, 0xb5, 0x2f, 0xfd, 0, 16 << 3];
    assert_eq!(zstd_window_size(&frame_prefix, None), Some(MAX_WINDOW_SIZE));

    let over_limit = [0x28, 0xb5, 0x2f, 0xfd, 0, (16 << 3) | 1];
    assert_eq!(
      zstd_window_size(&over_limit, None),
      Some(MAX_WINDOW_SIZE + 8 * 1024 * 1024)
    );
  }

  // NAPI_RS_NATIVE_CACHE is process-global; serialize the tests that touch it.
  static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

  // A self-loading stub: a minimal host-format object carrying a SMOL/__NAPI_PAYLOAD
  // section whose body is the producer's [magic][content_hash][zstd payload]. The
  // section builder + ABI are shared with the real producer via `section`, so the
  // tests exercise the exact wire format the stub reads at runtime.
  fn stub_with_section(raw: &[u8]) -> Vec<u8> {
    let payload = zstd::encode_all(raw, 3).unwrap();
    let body = section::build_section_payload(fnv1a64(raw), &payload);
    section::synthetic_object_with_section(&body)
  }

  // The synthetic-object builder carries the producer's section body, and
  // `resolve_self` reads the content hash straight back out of it — the runtime
  // contract between the producer's section and the stub's reader.
  #[test]
  fn section_round_trips_the_content_hash() {
    let raw = fake_addon();
    let dir = scratch("section-hash");
    let path = dir.join("addon.node");
    std::fs::write(&path, stub_with_section(&raw)).unwrap();

    let section = section::read_self_section(&path).expect("section");
    assert_eq!(section.content_hash, fnv1a64(&raw));
    assert_eq!(decode(&section.payload, section.content_hash).unwrap(), raw);

    // A file with no parseable section → None.
    std::fs::write(&path, fake_addon()).unwrap();
    assert!(section::read_self_section(&path).is_none());
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn resolve_self_replaces_carrier_on_btrfs() {
    let _guard = ENV_LOCK.lock().unwrap();
    let dir = scratch("resolve-replace");
    let cache = dir.join("cache");
    std::env::set_var("NAPI_RS_NATIVE_CACHE", &cache);
    let path = dir.join("addon.node");
    let raw = fake_addon();
    std::fs::write(&path, stub_with_section(&raw)).unwrap();

    // This exercises the replacement path only when the test directory is on Btrfs.
    if !matches!(probe(&path), Ok(Support::Supported)) {
      std::env::remove_var("NAPI_RS_NATIVE_CACHE");
      std::fs::remove_dir_all(&dir).ok();
      return;
    }
    let loaded = resolve_self(&path).expect("resolve_self replacement");
    // self_path now contains the decoded addon for later loads.
    assert_eq!(
      std::fs::read(&path).unwrap(),
      raw,
      "self_path is now the decoded addon"
    );
    assert!(
      matches!(
        compress_file(&path).unwrap(),
        Outcome::AlreadyCompressed { .. }
      ),
      "the replacement is already compressed"
    );
    // THIS process can't reload self_path (it's mid-dlopen), so resolve_self hands
    // back the cache, which is also loadable.
    assert!(
      loaded.starts_with(&cache),
      "current load via cache: {loaded:?}"
    );
    assert_eq!(
      std::fs::read(&loaded).unwrap(),
      raw,
      "cache holds the raw addon"
    );

    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
    std::fs::remove_dir_all(&dir).ok();
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn replace_self_keeps_a_newer_carrier() {
    let dir = scratch("newer-carrier");
    let path = dir.join("addon.node");
    let old = stub_with_section(&fake_addon());
    let newer = stub_with_section(b"new addon version");
    let cache = dir.join("decoded.node");
    std::fs::write(&path, &old).unwrap();
    std::fs::write(&cache, fake_addon()).unwrap();

    let old_identity = CarrierIdentity::read(&path).unwrap();
    let next = dir.join("next.node");
    std::fs::write(&next, &newer).unwrap();
    std::fs::rename(&next, &path).unwrap();

    assert!(replace_self(&path, &cache, old_identity).is_none());
    assert_eq!(std::fs::read(&path).unwrap(), newer);
    std::fs::remove_dir_all(dir).ok();
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn output_directory_lock_serializes_publishers() {
    use std::os::fd::AsRawFd;

    let dir = scratch("output-lock");
    let path = dir.join("addon.node");
    let first = lock_output_directory(&path).unwrap();
    let second = std::fs::File::open(&dir).unwrap();

    assert_eq!(
      unsafe { libc::flock(second.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
      -1
    );
    assert_eq!(
      std::io::Error::last_os_error().kind(),
      std::io::ErrorKind::WouldBlock
    );

    drop(first);
    assert_eq!(
      unsafe { libc::flock(second.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
      0
    );
    std::fs::remove_dir_all(dir).ok();
  }

  #[cfg(unix)]
  #[test]
  fn resolve_self_falls_back_to_cache_when_replacement_is_blocked() {
    // If the carrier cannot be replaced, loading still succeeds through the cache.
    // Root bypasses directory permissions, so skip that case.
    let _guard = ENV_LOCK.lock().unwrap();
    if unsafe { libc::geteuid() } == 0 {
      return;
    }
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch("resolve-ro-replace");
    let cache = dir.join("cache");
    std::env::set_var("NAPI_RS_NATIVE_CACHE", &cache);
    // The addon lives in its own subdir we can make read-only without blocking the
    // cache (which is elsewhere under `dir`).
    let nm = dir.join("nm");
    std::fs::create_dir_all(&nm).unwrap();
    let path = nm.join("addon.node");
    let raw = fake_addon();
    std::fs::write(&path, stub_with_section(&raw)).unwrap();

    // Read-only directory blocks replace_self, so the carrier stays intact.
    std::fs::set_permissions(&nm, std::fs::Permissions::from_mode(0o555)).unwrap();
    let loaded = resolve_self(&path);
    std::fs::set_permissions(&nm, std::fs::Permissions::from_mode(0o755)).ok();

    let loaded = loaded.expect("blocked replacement falls back to the cache, not None");
    assert!(
      loaded.starts_with(&cache),
      "loaded via the cache: {loaded:?}"
    );
    assert_eq!(
      std::fs::read(&loaded).unwrap(),
      raw,
      "the cache holds the decoded addon"
    );
    assert_eq!(
      std::fs::read(&path).unwrap(),
      stub_with_section(&raw),
      "self_path is left untouched when replacement is blocked"
    );

    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn resolve_self_returns_a_warm_cache_hit() {
    let _guard = ENV_LOCK.lock().unwrap();
    let dir = scratch("resolve-hit");
    let cache = dir.join("cache");
    std::env::set_var("NAPI_RS_NATIVE_CACHE", &cache);
    let path = dir.join("addon.node");
    let raw = fake_addon();
    std::fs::write(&path, stub_with_section(&raw)).unwrap();

    // Pre-seed the content-addressed cache file. resolve_self checks the cache
    // (named by the section's content hash) BEFORE probing the FS, so it returns
    // the hit without decoding or attempting filesystem replacement.
    let hit = cache_path(&path, fnv1a64(&raw)).unwrap();
    std::fs::create_dir_all(hit.parent().unwrap()).unwrap();
    std::fs::write(&hit, &raw).unwrap();

    assert_eq!(resolve_self(&path).as_ref(), Some(&hit), "warm cache hit");
    assert_ne!(
      resolve_self(&path).unwrap(),
      path,
      "no replacement on a hit"
    );

    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn cache_dir_defaults_to_tmp_and_honors_overrides() {
    let _guard = ENV_LOCK.lock().unwrap();
    let p = std::path::Path::new("/whatever/addon.node");

    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
    assert_eq!(
      resolve_cache_dir(p),
      Some(std::env::temp_dir().join(cache_subdir()))
    );
    std::env::set_var("NAPI_RS_NATIVE_CACHE", "tmpdir");
    assert_eq!(
      resolve_cache_dir(p),
      Some(std::env::temp_dir().join(cache_subdir()))
    );
    std::env::set_var("NAPI_RS_NATIVE_CACHE", "/custom/dir");
    assert_eq!(
      resolve_cache_dir(p),
      Some(std::path::PathBuf::from("/custom/dir").join(cache_subdir()))
    );
    // The /tmp subdir is per-uid, so users never share a cache there.
    assert!(cache_subdir().contains("napi-rs-native"));
    // 0 / false / none → a private per-user temp subdir.
    for off in ["0", "false", "none"] {
      std::env::set_var("NAPI_RS_NATIVE_CACHE", off);
      assert_eq!(
        resolve_cache_dir(p),
        Some(std::env::temp_dir().join(cache_subdir())),
        "{off}"
      );
    }
    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
  }

  #[test]
  fn cache_dir_resolves_node_modules_and_workspace_modes() {
    let _guard = ENV_LOCK.lock().unwrap();
    let root = scratch("cache-modes");
    let nm = root.join("node_modules");
    let pkg = nm.join("addon");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::write(root.join("pnpm-workspace.yaml"), "packages: []\n").unwrap();
    let file = pkg.join("addon.node");
    let sub = std::path::Path::new(".cache").join(cache_subdir());

    std::env::set_var("NAPI_RS_NATIVE_CACHE", "node_modules");
    assert_eq!(resolve_cache_dir(&file), Some(nm.join(&sub)));
    std::env::set_var("NAPI_RS_NATIVE_CACHE", "workspace");
    assert_eq!(resolve_cache_dir(&file), Some(nm.join(&sub)));
    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
    std::fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn cache_path_uses_a_per_process_name_when_caching_is_off() {
    let _guard = ENV_LOCK.lock().unwrap();
    let p = std::path::Path::new("/tmp/addon.node");
    std::env::set_var("NAPI_RS_NATIVE_CACHE", "0");
    let path = cache_path(p, 0xdead_beef).unwrap();
    let name = path.file_name().unwrap().to_string_lossy();
    assert!(
      name.contains(&std::process::id().to_string()),
      "no-cache uses a per-pid name: {name}"
    );
    assert!(
      name.contains("deadbeef"),
      "no-cache includes the addon hash"
    );
    std::env::set_var("NAPI_RS_NATIVE_CACHE", "tmpdir");
    let hashed = cache_path(p, 0xdead_beef).unwrap();
    assert!(
      hashed
        .file_name()
        .unwrap()
        .to_string_lossy()
        .contains("deadbeef"),
      "default names by content hash"
    );
    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
  }

  #[cfg(unix)]
  #[test]
  fn cache_directory_is_private_and_symlinks_are_rejected() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = ENV_LOCK.lock().unwrap();
    let dir = scratch("private-cache").join("cache");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    create_cache_dir(&dir).unwrap();
    assert_eq!(
      std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
      0o700
    );
    assert!(cache_entry_is_trusted(&dir));

    let link = dir.with_extension("link");
    std::os::unix::fs::symlink(&dir, &link).unwrap();
    assert!(!cache_entry_is_trusted(&link));
    std::fs::remove_dir_all(dir.parent().unwrap()).ok();
  }

  #[cfg(unix)]
  #[test]
  fn disabled_cache_file_is_removed_after_loading() {
    let _lock = ENV_LOCK.lock().unwrap();
    let dir = scratch("cache-cleanup");
    let path = dir.join("addon.node");
    std::fs::write(&path, b"addon").unwrap();
    std::env::set_var("NAPI_RS_NATIVE_CACHE", "0");
    cleanup_after_load(&path);
    assert!(!path.exists());
    std::env::remove_var("NAPI_RS_NATIVE_CACHE");
    std::fs::remove_dir_all(dir).ok();
  }

  #[test]
  fn nearest_and_workspace_node_modules() {
    let root = scratch("ws");
    let nm = root.join("node_modules");
    let pkg = nm
      .join(".pnpm")
      .join("dep@1")
      .join("node_modules")
      .join("addon");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::write(root.join("pnpm-workspace.yaml"), "packages: []\n").unwrap();
    let file = pkg.join("addon.node");
    let inner_nm = pkg.parent().unwrap().to_path_buf(); // .../.pnpm/dep@1/node_modules

    // nearest: the innermost node_modules ancestor.
    assert_eq!(nearest_node_modules(&file), Some(inner_nm));
    // workspace: the manifest root's node_modules.
    assert_eq!(workspace_node_modules(&file), Some(nm));
    std::fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn decode_is_none_on_corrupt_payload() {
    assert!(decode(b"not a zstd frame", 0).is_none());
  }

  #[test]
  fn resolve_self_keeps_the_original_when_decode_is_garbage() {
    let dir = scratch("resolve-bad");
    let path = dir.join("addon.node");
    // A valid section whose payload isn't a zstd frame → decode fails → None.
    let junk = b"definitely not a zstd frame";
    let body = section::build_section_payload(fnv1a64(junk), junk);
    let file = section::synthetic_object_with_section(&body);
    std::fs::write(&path, &file).unwrap();

    assert!(resolve_self(&path).is_none());
    assert_eq!(std::fs::read(&path).unwrap(), file, "original untouched");
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn resolve_self_rejects_a_non_native_payload() {
    let dir = scratch("not-native");
    let path = dir.join("addon.node");
    // The section payload decodes cleanly, but the bytes aren't a native binary.
    let junk = b"this is plain text, not ELF/Mach-O/PE";
    let payload = zstd::encode_all(&junk[..], 3).unwrap();
    let body = section::build_section_payload(fnv1a64(junk), &payload);
    let file = section::synthetic_object_with_section(&body);
    std::fs::write(&path, &file).unwrap();
    assert!(resolve_self(&path).is_none());
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn sweep_old_removes_stale_old_stubs_only() {
    let dir = scratch("sweep");
    let old = dir.join("addon.node.4321.old");
    let keep = dir.join("addon.node");
    let other = dir.join("notes.txt");
    std::fs::write(&old, b"x").unwrap();
    std::fs::write(&keep, b"y").unwrap();
    std::fs::write(&other, b"z").unwrap();
    sweep_old(&dir);
    assert!(!old.exists(), "stale .old removed");
    assert!(keep.exists() && other.exists(), "real files kept");
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn node_modules_helpers_handle_absence() {
    let _guard = ENV_LOCK.lock().unwrap();
    // No node_modules ancestor at all.
    assert_eq!(
      nearest_node_modules(std::path::Path::new("/tmp/no/nm/here.node")),
      None
    );
    // node_modules present but no workspace marker → topmost node_modules.
    let root = scratch("ws-none");
    let nm = root.join("node_modules").join("pkg");
    std::fs::create_dir_all(&nm).unwrap();
    assert_eq!(
      workspace_node_modules(&nm.join("a.node")),
      Some(root.join("node_modules"))
    );
    std::fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn workspace_node_modules_finds_a_marker_file() {
    let root = scratch("ws-marker");
    let nm = root.join("node_modules").join("pkg");
    std::fs::create_dir_all(&nm).unwrap();
    std::fs::write(root.join("lerna.json"), "{}\n").unwrap();
    assert_eq!(
      workspace_node_modules(&nm.join("a.node")),
      Some(root.join("node_modules"))
    );
    std::fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn workspace_node_modules_finds_package_json_workspaces() {
    let root = scratch("ws-pkg");
    let nm = root.join("node_modules").join("pkg");
    std::fs::create_dir_all(&nm).unwrap();
    std::fs::write(root.join("package.json"), "{\"workspaces\":[\"a\"]}\n").unwrap();
    assert_eq!(
      workspace_node_modules(&nm.join("a.node")),
      Some(root.join("node_modules"))
    );
    std::fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn error_formats_and_chains_its_source() {
    let io = Error::Io {
      context: "doing-x",
      source: std::io::Error::from(std::io::ErrorKind::Other),
    };
    assert!(format!("{io}").contains("doing-x"));
    assert!(std::error::Error::source(&io).is_some());
    let nf = Error::NotFound(std::path::PathBuf::from("/p"));
    assert!(format!("{nf}").contains("not found"));
    assert!(std::error::Error::source(&nf).is_none());
  }

  #[cfg(unix)]
  #[test]
  fn compress_file_skips_a_read_only_file() {
    // On Btrfs, a read-only file can't be opened rw → the orchestrator
    // fail-soft turns the EACCES into Skipped(PermissionDenied), not a hard error.
    // Root bypasses the mode bits, so skip there (CI containers run as root).
    if unsafe { libc::geteuid() } == 0 {
      return;
    }
    let dir = scratch("ro");
    let path = dir.join("addon.node");
    std::fs::write(&path, fake_addon()).unwrap();
    if !matches!(probe(&path), Ok(Support::Supported)) {
      std::fs::remove_dir_all(&dir).ok();
      return;
    }
    let mut perm = std::fs::metadata(&path).unwrap().permissions();
    perm.set_readonly(true);
    std::fs::set_permissions(&path, perm).unwrap();
    let outcome = compress_file(&path);
    // Restore write so the dir can be removed.
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).ok();
    assert!(
      matches!(
        outcome,
        Ok(Outcome::Skipped {
          reason: SkipReason::PermissionDenied
        })
      ),
      "read-only → Skipped(PermissionDenied), got {outcome:?}"
    );
    std::fs::remove_dir_all(&dir).ok();
  }
}
