//! Linux backend — btrfs (Stage 1); bcachefs later. ext4/xfs/ZFS cannot be done.
//!
//! Detection is an allowlist: only btrfs carries the per-file `FS_COMPR_FL` we set,
//! so every other f_type (incl. overlay/NFS) reports Unsupported. Apply uses the
//! SYNCHRONOUS copy+flag path (create a sibling, write and defrag it, then
//! atomic-rename over the target). The rename also gives a fresh inode: the
//! copy-break that isolates any pnpm CAS hardlink siblings.
//!
//! Prefer zstd only when the filesystem advertises support. Fall back to zlib on
//! older kernels, and retry only when the kernel rejects zstd with EINVAL.

use std::os::fd::AsRawFd;
use std::path::Path;

use crate::{cstring, io, Error, Support, UnsupportedReason};

// Allowlist magic (statfs f_type). Only btrfs from the Stage-1 matrix.
const BTRFS_SUPER_MAGIC: i64 = 0x9123_683E;

// The ioctl request encodes `long`, but the kernel reads/writes an `int`.
//
// uapi/linux/fs.h: FS_IOC_{GET,SET}FLAGS use long; fs/file_attr.c's handlers
// use unsigned int __user *. The request size follows pointer width, while the
// value pointer is always a c_int.
#[cfg(target_pointer_width = "64")]
const FS_IOC_GETFLAGS: u32 = 0x8008_6601;
#[cfg(target_pointer_width = "32")]
const FS_IOC_GETFLAGS: u32 = 0x8004_6601;
#[cfg(target_pointer_width = "64")]
const FS_IOC_SETFLAGS: u32 = 0x4008_6602;
#[cfg(target_pointer_width = "32")]
const FS_IOC_SETFLAGS: u32 = 0x4004_6602;
// FS_IOC_FIEMAP = _IOWR('f', 11, struct fiemap). Used to read whether the data
// extents are ENCODED (compressed) — btrfs reports st_blocks as the LOGICAL size,
// so the on-disk win is invisible to stat/du and only FIEMAP/compsize reveals it.
const FS_IOC_FIEMAP: u32 = 0xC020_660B;
const FIEMAP_FLAG_SYNC: u32 = 0x0001;
const FIEMAP_EXTENT_ENCODED: u32 = 0x0008;
// uapi/linux/fs.h: FS_COMPR_FL is 0x4 (0x20 is FS_APPEND_FL — append-only, which
// makes writes and renames EPERM).
const FS_COMPR_FL: libc::c_int = 0x0000_0004;
const BTRFS_IOC_GET_FEATURES: u32 = 0x8018_9439;
const BTRFS_IOC_DEFRAG_RANGE: u32 = 0x4030_9410;
const BTRFS_FEATURE_INCOMPAT_COMPRESS_ZSTD: u64 = 1 << 4;
const BTRFS_COMPRESS_ZLIB: u32 = 1;
const BTRFS_COMPRESS_ZSTD: u32 = 3;

#[repr(C)]
#[derive(Default)]
struct BtrfsFeatureFlags {
  compat: u64,
  compat_ro: u64,
  incompat: u64,
}

#[repr(C)]
struct DefragRange {
  start: u64,
  len: u64,
  flags: u64,
  extent_thresh: u32,
  compress_type: u32,
  unused: [u32; 4],
}

const _: () = assert!(std::mem::size_of::<DefragRange>() == 48);

fn statfs_type(path: &Path) -> Result<i64, Error> {
  let cpath = cstring(path)?;
  let mut buf: libc::statfs = unsafe { std::mem::zeroed() };
  if unsafe { libc::statfs(cpath.as_ptr(), &mut buf) } != 0 {
    return Err(io("statfs"));
  }
  Ok(i64::from(buf.f_type as u32))
}

fn get_flags(fd: libc::c_int) -> Result<libc::c_int, Error> {
  let mut flags: libc::c_int = 0;
  if unsafe { libc::ioctl(fd, FS_IOC_GETFLAGS as _, &mut flags) } != 0 {
    return Err(io("FS_IOC_GETFLAGS"));
  }
  Ok(flags)
}

fn btrfs_incompat_flags(fd: libc::c_int) -> std::io::Result<u64> {
  let mut features = BtrfsFeatureFlags::default();
  if unsafe { libc::ioctl(fd, BTRFS_IOC_GET_FEATURES as _, &mut features) } == 0 {
    Ok(features.incompat)
  } else {
    Err(std::io::Error::last_os_error())
  }
}

fn compress_with_fallback(
  features: std::io::Result<u64>,
  mut compress: impl FnMut(u32) -> std::io::Result<()>,
) -> std::io::Result<()> {
  let incompat = features.unwrap_or(0);
  if incompat & BTRFS_FEATURE_INCOMPAT_COMPRESS_ZSTD != 0 {
    match compress(BTRFS_COMPRESS_ZSTD) {
      Ok(()) => return Ok(()),
      Err(error) if error.raw_os_error() == Some(libc::EINVAL) => {}
      Err(error) => return Err(error),
    }
  }
  compress(BTRFS_COMPRESS_ZLIB)
}

fn compress_range(fd: libc::c_int, codec: u32) -> std::io::Result<()> {
  let range = DefragRange {
    start: 0,
    len: u64::MAX,
    flags: 3,
    extent_thresh: 1,
    compress_type: codec,
    unused: [0; 4],
  };
  if unsafe { libc::ioctl(fd, BTRFS_IOC_DEFRAG_RANGE as _, &range) } == 0 {
    Ok(())
  } else {
    Err(std::io::Error::last_os_error())
  }
}

pub(crate) fn detect(path: &Path) -> Result<Support, Error> {
  if statfs_type(path)? == BTRFS_SUPER_MAGIC {
    Ok(Support::Supported)
  } else {
    Ok(Support::Unsupported(UnsupportedReason::Filesystem))
  }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct FiemapExtent {
  fe_logical: u64,
  fe_physical: u64,
  fe_length: u64,
  fe_reserved64: [u64; 2],
  fe_flags: u32,
  fe_reserved: [u32; 3],
}

#[repr(C)]
struct FiemapHeader {
  fm_start: u64,
  fm_length: u64,
  fm_flags: u32,
  fm_mapped_extents: u32,
  fm_extent_count: u32,
  fm_reserved: u32,
}

const _: () = assert!(std::mem::size_of::<FiemapHeader>() == 32);
const _: () = assert!(std::mem::size_of::<FiemapExtent>() == 56);

/// True if any data extent carries FIEMAP_EXTENT_ENCODED (i.e. is compressed on
/// disk). This is the only reliable btrfs win signal — st_blocks reflects the
/// logical size. FIEMAP_FLAG_SYNC flushes pending writes before mapping.
fn compressed_via_fiemap(path: &Path) -> Result<bool, Error> {
  const COUNT: usize = 64;
  let file = std::fs::File::open(path).map_err(|source| Error::Io {
    context: "open for fiemap",
    source,
  })?;
  let mut buf =
    vec![0u8; std::mem::size_of::<FiemapHeader>() + COUNT * std::mem::size_of::<FiemapExtent>()];
  // SAFETY: buf is sized for the header + COUNT extents; the kernel fills it.
  unsafe {
    let header = buf.as_mut_ptr().cast::<FiemapHeader>();
    (*header).fm_start = 0;
    (*header).fm_length = u64::MAX;
    (*header).fm_flags = FIEMAP_FLAG_SYNC;
    (*header).fm_extent_count = COUNT as u32;
    (*header).fm_mapped_extents = 0;
    (*header).fm_reserved = 0;
    if libc::ioctl(file.as_raw_fd(), FS_IOC_FIEMAP as _, buf.as_mut_ptr()) != 0 {
      return Err(io("FS_IOC_FIEMAP"));
    }
    let mapped = (*header).fm_mapped_extents as usize;
    let extents = std::slice::from_raw_parts(
      buf
        .as_ptr()
        .add(std::mem::size_of::<FiemapHeader>())
        .cast::<FiemapExtent>(),
      mapped.min(COUNT),
    );
    Ok(
      extents
        .iter()
        .any(|e| e.fe_flags & FIEMAP_EXTENT_ENCODED != 0),
    )
  }
}

/// btrfs win measurement is authoritative via FIEMAP, not st_blocks.
pub(crate) fn compressed_on_disk(path: &Path) -> Result<Option<bool>, Error> {
  Ok(Some(compressed_via_fiemap(path)?))
}

pub(crate) fn is_already_compressed(path: &Path) -> Result<bool, Error> {
  let file = std::fs::File::open(path).map_err(|source| Error::Io {
    context: "open",
    source,
  })?;
  Ok(get_flags(file.as_raw_fd())? & FS_COMPR_FL != 0)
}

pub(crate) fn apply_inplace(path: &Path) -> Result<(), Error> {
  use std::os::unix::fs::MetadataExt;

  let source_metadata = std::fs::metadata(path).map_err(|source| Error::Io {
    context: "stat source",
    source,
  })?;
  if source_metadata.mode() & 0o222 == 0 {
    return Err(Error::Io {
      context: "source is read-only",
      source: std::io::Error::from(std::io::ErrorKind::PermissionDenied),
    });
  }
  let source_file = std::fs::File::open(path).map_err(|source| Error::Io {
    context: "open source",
    source,
  })?;
  let dir = path.parent().ok_or_else(|| Error::Io {
    context: "no parent dir",
    source: std::io::Error::from(std::io::ErrorKind::InvalidInput),
  })?;
  let name = path
    .file_name()
    .map_or("addon", |n| n.to_str().unwrap_or("addon"));
  let mut temp = None;
  for _ in 0..100 {
    let Some(candidate) = crate::unique_temp_path(dir, &format!("{name}.napi-addon")) else {
      break;
    };
    if let Some(file) = crate::private_new_file(&candidate) {
      temp = Some((candidate, file));
      break;
    }
  }
  let (tmp, mut file) = temp.ok_or_else(|| Error::Io {
    context: "create temp",
    source: std::io::Error::from(std::io::ErrorKind::AlreadyExists),
  })?;

  let result = (|| {
    let fd = file.as_raw_fd();
    let flags = get_flags(fd)? | FS_COMPR_FL;
    if unsafe { libc::ioctl(fd, FS_IOC_SETFLAGS as _, &flags) } != 0 {
      return Err(io("FS_IOC_SETFLAGS"));
    }
    let mut source_file = &source_file;
    std::io::copy(&mut source_file, &mut file).map_err(|source| Error::Io {
      context: "copy source",
      source,
    })?;
    compress_with_fallback(btrfs_incompat_flags(fd), |codec| compress_range(fd, codec)).map_err(
      |source| Error::Io {
        context: "compress btrfs extents",
        source,
      },
    )?;
    file
      .set_permissions(source_metadata.permissions())
      .map_err(|source| Error::Io {
        context: "preserve source permissions",
        source,
      })?;
    file.sync_all().map_err(|source| Error::Io {
      context: "fsync temp",
      source,
    })?;
    Ok(())
  })();

  match result {
    Ok(()) => std::fs::rename(&tmp, path).map_err(|source| {
      let _ = std::fs::remove_file(&tmp);
      Error::Io {
        context: "rename",
        source,
      }
    }),
    Err(err) => {
      let _ = std::fs::remove_file(&tmp);
      Err(err)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn uses_enabled_zstd_before_zlib() {
    let mut attempted = Vec::new();
    compress_with_fallback(Ok(BTRFS_FEATURE_INCOMPAT_COMPRESS_ZSTD), |codec| {
      attempted.push(codec);
      Ok(())
    })
    .unwrap();
    assert_eq!(attempted, [BTRFS_COMPRESS_ZSTD]);
  }

  #[test]
  fn uses_zlib_when_zstd_is_not_enabled_or_feature_query_fails() {
    for features in [Ok(0), Err(std::io::Error::from_raw_os_error(libc::EACCES))] {
      let mut attempted = Vec::new();
      compress_with_fallback(features, |codec| {
        attempted.push(codec);
        Ok(())
      })
      .unwrap();
      assert_eq!(attempted, [BTRFS_COMPRESS_ZLIB]);
    }
  }

  #[test]
  fn retries_zlib_only_when_zstd_returns_einval() {
    let mut attempted = Vec::new();
    compress_with_fallback(Ok(BTRFS_FEATURE_INCOMPAT_COMPRESS_ZSTD), |codec| {
      attempted.push(codec);
      if codec == BTRFS_COMPRESS_ZSTD {
        Err(std::io::Error::from_raw_os_error(libc::EINVAL))
      } else {
        Ok(())
      }
    })
    .unwrap();
    assert_eq!(attempted, [BTRFS_COMPRESS_ZSTD, BTRFS_COMPRESS_ZLIB]);
  }

  #[test]
  fn propagates_non_einval_zstd_errors_without_retrying() {
    let mut attempted = Vec::new();
    let error = compress_with_fallback(Ok(BTRFS_FEATURE_INCOMPAT_COMPRESS_ZSTD), |codec| {
      attempted.push(codec);
      Err(std::io::Error::from_raw_os_error(libc::EIO))
    })
    .unwrap_err();
    assert_eq!(attempted, [BTRFS_COMPRESS_ZSTD]);
    assert_eq!(error.raw_os_error(), Some(libc::EIO));
  }

  #[test]
  fn propagates_zlib_errors() {
    let error =
      compress_with_fallback(Ok(0), |_| Err(std::io::Error::from_raw_os_error(libc::EIO)))
        .unwrap_err();
    assert_eq!(error.raw_os_error(), Some(libc::EIO));
  }
}
