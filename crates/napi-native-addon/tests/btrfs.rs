//! Real-filesystem test for the btrfs backend. Skips unless NAPI_NATIVE_ADDON_BTRFS_DIR
//! points at a mounted btrfs (the Docker harness sets it); never runs on a dev
//! macOS box or ordinary CI. Exercises the PUBLIC surface: probe / compress_file /
//! napi-native-addon. The on-disk shrink is asserted only on a kernel that actually
//! compresses (some container kernels carry btrfs without working compression).
#![allow(clippy::print_stderr)] // CI diagnostics under --nocapture; not product code

use std::fs;
use std::path::PathBuf;

use napi_native_addon::{
  compress_file, fnv1a64, probe, resolve_self, section::build_section_payload, Outcome, Support,
};

fn fake_addon() -> Vec<u8> {
  let mut raw = vec![0x7f, 0x45, 0x4c, 0x46];
  let pattern = b"napi-rs napi-native-addon compressible addon body pattern ";
  while raw.len() < 2 * 1024 * 1024 {
    raw.extend_from_slice(pattern);
  }
  raw.truncate(2 * 1024 * 1024);
  raw
}

fn unique_addon() -> Vec<u8> {
  let mut raw = fake_addon();
  let nonce = format!(
    "{}-{}",
    std::process::id(),
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_nanos()
  );
  let start = raw.len() - nonce.len();
  raw[start..].copy_from_slice(nonce.as_bytes());
  raw
}

fn stub_with_section(raw: &[u8]) -> Vec<u8> {
  let payload = zstd::encode_all(raw, 3).unwrap();
  let body = build_section_payload(fnv1a64(raw), &payload);

  // ELF64 LE: [ehdr(64)][body][shstrtab][shdrs]. Three section headers
  // (SHT_NULL, .NAPI_PAYLOAD, .shstrtab); .shstrtab is index 2.
  let body_off = 64usize;
  let shstr = b"\0.NAPI_PAYLOAD\0.shstrtab\0";
  let shstr_off = body_off + body.len();
  let shoff = shstr_off + shstr.len();
  let shentsize = 64usize;
  let shnum = 3usize;
  let shstrndx = 2usize;
  let total = shoff + shnum * shentsize;
  let mut e = vec![0u8; total];
  e[0..4].copy_from_slice(b"\x7fELF");
  e[4] = 2;
  e[5] = 1;
  e[6] = 1;
  e[40..48].copy_from_slice(&(shoff as u64).to_le_bytes());
  e[58..60].copy_from_slice(&(shentsize as u16).to_le_bytes());
  e[60..62].copy_from_slice(&(shnum as u16).to_le_bytes());
  e[62..64].copy_from_slice(&(shstrndx as u16).to_le_bytes());
  e[body_off..body_off + body.len()].copy_from_slice(&body);
  e[shstr_off..shstr_off + shstr.len()].copy_from_slice(shstr);
  let sh1 = shoff + shentsize;
  e[sh1..sh1 + 4].copy_from_slice(&1u32.to_le_bytes());
  e[sh1 + 24..sh1 + 32].copy_from_slice(&(body_off as u64).to_le_bytes());
  e[sh1 + 32..sh1 + 40].copy_from_slice(&(body.len() as u64).to_le_bytes());
  let sh2 = shoff + 2 * shentsize;
  e[sh2..sh2 + 4].copy_from_slice(&(b"\0.NAPI_PAYLOAD\0".len() as u32).to_le_bytes());
  e[sh2 + 24..sh2 + 32].copy_from_slice(&(shstr_off as u64).to_le_bytes());
  e[sh2 + 32..sh2 + 40].copy_from_slice(&(shstr.len() as u64).to_le_bytes());
  e
}

fn btrfs_dir() -> Option<PathBuf> {
  std::env::var_os("NAPI_NATIVE_ADDON_BTRFS_DIR").map(PathBuf::from)
}

#[test]
fn compress_file_applies_flag_round_trips_and_stays_loadable() {
  let Some(dir) = btrfs_dir() else {
    eprintln!("skip: NAPI_NATIVE_ADDON_BTRFS_DIR unset");
    return;
  };
  let path = dir.join("raw.node");
  let _ = fs::remove_file(&path);
  let raw = fake_addon();
  fs::write(&path, &raw).unwrap();

  assert_eq!(probe(&path).unwrap(), Support::Supported, "btrfs detected");

  // Btrfs reports logical size through st_blocks, so the backend uses FIEMAP.
  match compress_file(&path).unwrap() {
    Outcome::Compressed { before, after } => {
      eprintln!(
        "FIEMAP-confirmed compressed (st_blocks {before} -> {after}, logical via st_blocks)"
      );
    }
    other => panic!("expected Compressed (FIEMAP ENCODED), got {other:?}"),
  }

  // Transparent: reading back yields the identical bytes (still loadable).
  assert_eq!(fs::read(&path).unwrap(), raw);

  // Flag round-trip on real btrfs: apply_inplace set FS_COMPR_FL and
  // is_already_compressed reads it back, so a second call short-circuits.
  assert!(
    matches!(
      compress_file(&path).unwrap(),
      Outcome::AlreadyCompressed { .. }
    ),
    "second call must detect the compress flag set by the first"
  );
}

#[test]
fn read_only_filesystem_is_skipped_not_errored() {
  let Some(dir) = std::env::var_os("NAPI_NATIVE_ADDON_BTRFS_RO_DIR").map(PathBuf::from) else {
    eprintln!("skip: NAPI_NATIVE_ADDON_BTRFS_RO_DIR unset");
    return;
  };
  let path = dir.join("ro.node");
  // Detection still reports Supported (it IS btrfs), but the write can't happen on
  // a read-only mount — fail-soft turns that into Skipped, never an Err.
  match compress_file(&path).unwrap() {
    Outcome::Skipped { reason } => eprintln!("read-only -> Skipped({reason:?})"),
    other => panic!("expected Skipped on a read-only fs, got {other:?}"),
  }
}

#[test]
fn resolve_self_replaces_the_carrier_on_btrfs() {
  let Some(dir) = btrfs_dir() else {
    eprintln!("skip: NAPI_NATIVE_ADDON_BTRFS_DIR unset");
    return;
  };

  let path = dir.join("addon.node");
  let _ = fs::remove_file(&path);
  let raw = unique_addon();
  let composite = stub_with_section(&raw);
  fs::write(&path, &composite).unwrap();

  // On btrfs (Supported), resolve_self replaces self_path with the raw
  // addon (so future processes dlopen it directly, no stub) and hands
  // this process a loadable cache copy (it can't reload the in-flight self_path).
  let loaded = resolve_self(&path).expect("resolve_self on btrfs");
  assert_eq!(
    fs::read(&path).unwrap(),
    raw,
    "self_path is now the raw addon"
  );
  // FS-compress flag round-tripped: the file is compressed on disk, so a direct
  // compress_file sees it already compressed.
  assert!(
    matches!(
      compress_file(&path).unwrap(),
      Outcome::AlreadyCompressed { .. }
    ),
    "replacement addon must carry the Btrfs compression flag"
  );
  // The returned path is the loadable cache copy, not self_path.
  assert_ne!(loaded, path, "current process loads from the cache");
  assert_eq!(fs::read(&loaded).unwrap(), raw, "cache holds the raw addon");
}
