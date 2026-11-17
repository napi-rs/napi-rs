//! Shared orchestration that gates every backend identically. Written once here
//! so a backend only implements `detect` / `is_already_compressed` /
//! `apply_inplace` and inherits all the safety invariants.

use std::path::Path;

use crate::{backend, verify, Error, Outcome, SkipReason};

/// Reached only when the backend reported `Supported`. Fail-soft: a permission,
/// read-only, or busy failure is a `Skipped` Outcome, never a hard `Err`. And if a
/// (broken) backend ever leaves the file no longer loadable, roll back to the
/// pre-apply bytes so a corrupt addon is never stranded.
pub(crate) fn apply_guarded(path: &Path) -> Result<Outcome, Error> {
  // INV-idempotent.
  match backend::is_already_compressed(path) {
    Ok(true) => {
      return Ok(Outcome::AlreadyCompressed {
        before: verify::on_disk_bytes(path)?,
      });
    }
    Ok(false) => {}
    Err(err) => {
      if let Error::Io { source, .. } = &err {
        if let Some(reason) = classify_skip(source) {
          return Ok(Outcome::Skipped { reason });
        }
      }
      return Err(err);
    }
  }

  let before = verify::on_disk_bytes(path)?;

  // INV-loadable: snapshot the native-binary magic so we can confirm the file
  // still loads after compression (a post-compress *content* hash is vacuous —
  // the kernel decompresses on read, so it always matches).
  let magic_before = verify::magic_prefix(path)?;

  // Keep rollback data on disk so large addons do not require a second heap copy.
  let snapshot = match snapshot(path) {
    Ok(snapshot) => snapshot,
    Err(err) => {
      if let Error::Io { source, .. } = &err {
        if let Some(reason) = classify_skip(source) {
          return Ok(Outcome::Skipped { reason });
        }
      }
      return Err(err);
    }
  };

  // INV-fail-soft: EACCES/EPERM/EROFS -> Skipped(PermissionDenied); EBUSY/ETXTBSY
  // -> Skipped(Busy). A genuine, unclassifiable I/O error still propagates.
  if let Err(err) = backend::apply_inplace(path) {
    if let Error::Io { source, .. } = &err {
      if let Some(reason) = classify_skip(source) {
        drop(snapshot);
        return Ok(Outcome::Skipped { reason });
      }
    }
    drop(snapshot);
    return Err(err);
  }

  let loadable = verify::magic_prefix(path)? == magic_before;
  if !loadable {
    // The backend left something that won't load — restore the original.
    restore(path, snapshot.path());
    return Ok(classify_outcome(false, before, before, None));
  }

  // INV-verify: prefer the backend's authoritative signal (btrfs FIEMAP ENCODED —
  // st_blocks reports the logical size there, so a real win is invisible to it).
  // Where no filesystem-specific signal is available, use the allocated-byte drop.
  let after = verify::on_disk_bytes(path)?;
  Ok(classify_outcome(
    true,
    before,
    after,
    backend::compressed_on_disk(path)?,
  ))
}

struct Snapshot {
  path: std::path::PathBuf,
  created: bool,
}

impl Snapshot {
  fn path(&self) -> &Path {
    &self.path
  }
}

impl Drop for Snapshot {
  fn drop(&mut self) {
    if self.created {
      let _ = std::fs::remove_file(&self.path);
    }
  }
}

fn snapshot(path: &Path) -> Result<Snapshot, Error> {
  let dir = path.parent().ok_or_else(|| Error::Io {
    context: "snapshot directory",
    source: std::io::Error::from(std::io::ErrorKind::InvalidInput),
  })?;
  let temp = crate::unique_temp_path(dir, "napi-addon-snapshot").ok_or_else(|| Error::Io {
    context: "snapshot temp path",
    source: std::io::Error::from(std::io::ErrorKind::AlreadyExists),
  })?;
  let mut snapshot = Snapshot {
    path: temp,
    created: false,
  };
  let mut file = crate::private_new_file(snapshot.path()).ok_or_else(|| Error::Io {
    context: "create snapshot",
    source: std::io::Error::last_os_error(),
  })?;
  snapshot.created = true;
  let mut source = std::fs::File::open(path).map_err(|source| Error::Io {
    context: "open snapshot source",
    source,
  })?;
  std::io::copy(&mut source, &mut file).map_err(|source| Error::Io {
    context: "copy snapshot",
    source,
  })?;
  file
    .set_permissions(
      source
        .metadata()
        .map_err(|source| Error::Io {
          context: "stat snapshot source",
          source,
        })?
        .permissions(),
    )
    .map_err(|source| Error::Io {
      context: "preserve snapshot permissions",
      source,
    })?;
  file.sync_all().map_err(|source| Error::Io {
    context: "sync snapshot",
    source,
  })?;
  Ok(snapshot)
}

/// Map the post-apply facts to an Outcome. Pure (no I/O) so every branch is unit
/// testable: not loadable → Skipped(NotLoadable); else the backend's compression
/// signal (or, absent one, an allocated-bytes drop) decides Compressed vs NoGain.
fn classify_outcome(loadable: bool, before: u64, after: u64, signal: Option<bool>) -> Outcome {
  if !loadable {
    return Outcome::Skipped {
      reason: SkipReason::NotLoadable,
    };
  }
  if signal.unwrap_or(after < before) {
    Outcome::Compressed { before, after }
  } else {
    Outcome::NoGain { before, after }
  }
}

/// Map a backend I/O failure to a non-fatal `Skipped` reason, or `None` to let it
/// propagate as a hard error. Uses both `ErrorKind` (cross-platform, esp. Windows)
/// and the POSIX errno (stable across Linux/macOS), so it needs no newer-than-1.0
/// `ErrorKind` variants.
fn classify_skip(err: &std::io::Error) -> Option<SkipReason> {
  if err.kind() == std::io::ErrorKind::PermissionDenied {
    return Some(SkipReason::PermissionDenied);
  }
  match err.raw_os_error() {
    Some(1) | Some(13) | Some(30) => Some(SkipReason::PermissionDenied), // EPERM/EACCES/EROFS
    Some(16) | Some(26) => Some(SkipReason::Busy),                       // EBUSY/ETXTBSY
    Some(27) => Some(SkipReason::TooLarge),                              // EFBIG
    _ => None,
  }
}

/// Best-effort atomic restore of the pre-apply bytes (sibling temp + rename).
fn restore(path: &Path, snapshot: &Path) {
  let _ = std::fs::rename(snapshot, path);
}

#[cfg(test)]
mod tests {
  use super::*;

  fn err(kind: std::io::ErrorKind) -> std::io::Error {
    std::io::Error::from(kind)
  }

  #[test]
  fn permission_errors_become_skipped() {
    assert_eq!(
      classify_skip(&err(std::io::ErrorKind::PermissionDenied)),
      Some(SkipReason::PermissionDenied)
    );
    for errno in [1, 13, 30] {
      assert_eq!(
        classify_skip(&std::io::Error::from_raw_os_error(errno)),
        Some(SkipReason::PermissionDenied),
        "errno {errno}"
      );
    }
  }

  #[test]
  fn busy_errors_become_skipped() {
    for errno in [16, 26] {
      assert_eq!(
        classify_skip(&std::io::Error::from_raw_os_error(errno)),
        Some(SkipReason::Busy),
        "errno {errno}"
      );
    }
  }

  #[test]
  fn efbig_becomes_too_large() {
    assert_eq!(
      classify_skip(&std::io::Error::from_raw_os_error(27)), // EFBIG
      Some(SkipReason::TooLarge)
    );
  }

  #[test]
  fn classify_outcome_covers_every_branch() {
    use crate::Outcome;
    assert!(matches!(
      classify_outcome(false, 100, 50, None),
      Outcome::Skipped {
        reason: SkipReason::NotLoadable
      }
    ));
    // Allocated-bytes fallback (no backend signal).
    assert!(matches!(
      classify_outcome(true, 100, 40, None),
      Outcome::Compressed {
        before: 100,
        after: 40
      }
    ));
    assert!(matches!(
      classify_outcome(true, 100, 100, None),
      Outcome::NoGain { .. }
    ));
    // Backend signal overrides the size comparison both ways.
    assert!(matches!(
      classify_outcome(true, 100, 100, Some(true)),
      Outcome::Compressed { .. }
    ));
    assert!(matches!(
      classify_outcome(true, 100, 40, Some(false)),
      Outcome::NoGain { .. }
    ));
  }

  #[test]
  fn restore_renames_the_snapshot_back() {
    let dir =
      std::env::temp_dir().join(format!("napi-native-addon-restore-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("f");
    std::fs::write(&path, b"corrupted-by-a-broken-backend").unwrap();
    let snapshot = dir.join("snapshot");
    std::fs::write(&snapshot, b"the original loadable bytes").unwrap();
    restore(&path, &snapshot);
    assert_eq!(
      std::fs::read(&path).unwrap(),
      b"the original loadable bytes"
    );
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn unrelated_errors_propagate() {
    assert_eq!(classify_skip(&err(std::io::ErrorKind::NotFound)), None);
    assert_eq!(classify_skip(&std::io::Error::from_raw_os_error(2)), None); // ENOENT
  }
}
