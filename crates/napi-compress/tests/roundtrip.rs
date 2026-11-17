//! Full-oracle round trip for the `napi-compress` producer (macOS).
//!
//! Uses the Cargo-built producer to compress a real Mach-O bundle into the self-loading
//! `.node`, and runs the verification oracle on the result:
//!   1. `codesign -v` passes (the injected section is signature-covered);
//!   2. the `__NAPI_PAYLOAD` section round-trips — magic + content hash + zstd payload
//!      decode back to the original addon byte-for-byte;
//!   3. `node` `process.dlopen` maps the file (no mmap/EACCES/strict-validation),
//!      proving the W^X (read-only) injected segment loads.
//!
//! macOS-only and skip-with-message when a prerequisite (the prebuilt stub, a C
//! compiler, or `node`) is missing — never connects to the network.

#![cfg(target_os = "macos")]
// Skip-with-message diagnostics print to stderr when a prerequisite is absent —
// the established integration-test pattern (see crates/napi-native-addon/tests/btrfs.rs).
#![allow(clippy::print_stderr)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> PathBuf {
  // crates/napi-compress/ → repo root.
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .ancestors()
    .nth(2)
    .expect("repo root")
    .to_path_buf()
}

/// A minimal real Mach-O bundle: one exported symbol so it is a loadable addon.
fn build_fixture_addon(dir: &Path) -> Option<PathBuf> {
  let src = dir.join("fixture.c");
  std::fs::write(&src, "int napi_register_module_v1(void){return 0;}\n").ok()?;
  let out = dir.join("fixture.node");
  let status = Command::new("cc")
    .args(["-bundle", "-undefined", "dynamic_lookup", "-o"])
    .arg(&out)
    .arg(&src)
    .status()
    .ok()?;
  status.success().then_some(out)
}

/// Pull the `SMOL/__NAPI_PAYLOAD` section out of `file` via `otool -l`, then return the
/// raw section bytes. `None` if the section isn't present.
fn extract_section(file: &Path) -> Option<Vec<u8>> {
  let out = Command::new("otool").arg("-l").arg(file).output().ok()?;
  let text = String::from_utf8(out.stdout).ok()?;
  // Find the __NAPI_PAYLOAD section block, then its `size` (hex) and `offset` (dec).
  let block = text.split("sectname __NAPI_PAYLOAD").nth(1)?;
  let mut size = None;
  let mut offset = None;
  for line in block.lines() {
    let t = line.trim();
    if let Some(v) = t.strip_prefix("size ") {
      size = usize::from_str_radix(v.trim().trim_start_matches("0x"), 16).ok();
    } else if let Some(v) = t.strip_prefix("offset ") {
      offset = v.trim().parse::<usize>().ok();
    }
    if size.is_some() && offset.is_some() {
      break;
    }
  }
  let (size, offset) = (size?, offset?);
  let bytes = std::fs::read(file).ok()?;
  bytes
    .get(offset..offset.checked_add(size)?)
    .map(<[u8]>::to_vec)
}

#[test]
fn producer_output_passes_the_full_oracle() {
  let root = repo_root();
  let stub = root.join(format!(
    "cli/stubs/{}-apple-darwin.node",
    std::env::consts::ARCH
  ));
  if !stub.exists() {
    eprintln!(
      "skip: prebuilt stub absent ({}) — run cli/build/stubs.mjs",
      stub.display()
    );
    return;
  }
  let producer = PathBuf::from(env!("CARGO_BIN_EXE_napi-compress"));

  let dir = std::env::temp_dir().join(format!("napi-compress-rt-{}", std::process::id()));
  std::fs::create_dir_all(&dir).expect("scratch dir");
  let Some(addon) = build_fixture_addon(&dir) else {
    eprintln!("skip: no C compiler to build the fixture addon");
    std::fs::remove_dir_all(&dir).ok();
    return;
  };
  let raw = std::fs::read(&addon).expect("read fixture");
  let out = dir.join("compressed.node");

  let status = Command::new(&producer)
    .arg(&stub)
    .arg(&addon)
    .arg(&out)
    .args(["--level", "19"])
    .status()
    .expect("run producer");
  assert!(status.success(), "producer must exit 0");
  assert!(out.exists(), "producer must write the output");

  // Oracle 1: codesign -v passes.
  let cs = Command::new("codesign")
    .arg("-v")
    .arg(&out)
    .status()
    .expect("codesign");
  assert!(cs.success(), "codesign -v must pass on the produced .node");

  // Oracle 2: the __NAPI_PAYLOAD section round-trips to the original addon.
  let section = extract_section(&out).expect("__NAPI_PAYLOAD section present");
  assert_eq!(&section[0..8], b"NAPCSECT", "section magic");
  let hash = u64::from_le_bytes(section[8..16].try_into().unwrap());
  assert_eq!(
    hash,
    napi_native_addon::fnv1a64(&raw),
    "content hash over the raw addon"
  );
  let decoded = zstd::decode_all(&section[16..]).expect("zstd decode");
  assert_eq!(decoded, raw, "decoded payload == original addon");

  // Oracle 3: node dlopen maps the file (W^X read-only segment loads). A missing
  // node only skips THIS assertion; the structural oracles above already ran.
  let probe = format!(
    "try{{process.dlopen({{exports:{{}}}},{:?})}}catch(e){{const m=e.message;if(!/Module did not self-register/.test(m)){{console.error(m);process.exit(1)}}}}",
    out.to_string_lossy()
  );
  if let Ok(node) = Command::new("node").args(["-e", &probe]).status() {
    assert!(
      node.success(),
      "node dlopen must map the file (no mmap/EACCES/strict-validation)"
    );
  } else {
    eprintln!("note: `node` not found — skipped the dlopen map check");
  }

  std::fs::remove_dir_all(&dir).ok();
}
