//! Platform-agnostic measurement + loadability surface.

use std::io::Read;
use std::path::Path;

use crate::Error;

/// Allocated bytes where the platform exposes them; otherwise, the file length.
pub(crate) fn on_disk_bytes(path: &Path) -> Result<u64, Error> {
  #[cfg(unix)]
  {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(path).map_err(|source| Error::Io {
      context: "stat",
      source,
    })?;
    Ok(meta.blocks().saturating_mul(512))
  }
  #[cfg(not(unix))]
  {
    let meta = std::fs::metadata(path).map_err(|source| Error::Io {
      context: "stat",
      source,
    })?;
    Ok(meta.len())
  }
}

/// First 4 bytes — the native-binary magic (ELF `7f454c46`, Mach-O `cffaedfe`/…,
/// PE `4d5a`). Compared before/after apply to assert the file still loads, in
/// place of a content hash that transparent compression would render vacuous.
pub(crate) fn magic_prefix(path: &Path) -> Result<[u8; 4], Error> {
  let mut file = std::fs::File::open(path).map_err(|source| Error::Io {
    context: "open",
    source,
  })?;
  let mut buf = [0u8; 4];
  file.read(&mut buf).map_err(|source| Error::Io {
    context: "read",
    source,
  })?;
  Ok(buf)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn measures_allocation_and_reads_magic() {
    let dir = std::env::temp_dir().join(format!("napi-native-addon-verify-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("f");
    std::fs::write(&path, vec![0x7f; 9000]).unwrap();
    assert!(
      on_disk_bytes(&path).unwrap() > 0,
      "allocated bytes reported"
    );
    assert_eq!(magic_prefix(&path).unwrap(), [0x7f; 4]);
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn errors_on_a_missing_path() {
    let p = std::path::Path::new("/no/such/verify/x");
    assert!(on_disk_bytes(p).is_err());
    assert!(magic_prefix(p).is_err());
  }
}
