//! `napi-compress` — the host build-time producer behind `napi build --compress`.
//!
//! Compresses a native addon into a self-loading `.node` with a zstd payload.
//! macOS output is ad-hoc signed after payload injection.
//!
//! Usage: `napi-compress <stub.node> <raw.node> <out.node> [--level <1..=22>]`.
//! Prints a JSON receipt on success and an actionable error on failure.

// stdout is the receipt; stderr reports failures.
#![allow(clippy::print_stdout, clippy::print_stderr)]

mod inject;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Small payloads use a quick level; large addons trade build time for size.
const DEFAULT_LEVEL: i32 = 16;
const LARGE_INPUT_LEVEL: i32 = 22;
const LARGE_INPUT_THRESHOLD: usize = 8 * 1024 * 1024;
const MAX_LEVEL: i32 = 22;
const MIN_LEVEL: i32 = 1;

/// The ad-hoc binary identifier stamped when the input carries none. A stable,
/// reverse-DNS name keeps every compressed addon's CodeDirectory identifier
/// consistent without claiming a real signing identity.
const IDENTIFIER: &str = "dev.socket.napi.compressed-addon";

struct Args {
  stub: PathBuf,
  raw: PathBuf,
  out: PathBuf,
  level: Option<i32>,
}

fn main() -> ExitCode {
  let args = match parse_args() {
    Ok(args) => args,
    Err(message) => {
      eprintln!("{message}");
      return ExitCode::FAILURE;
    }
  };
  match run(&args) {
    Ok(receipt) => {
      println!("{receipt}");
      ExitCode::SUCCESS
    }
    Err(message) => {
      eprintln!("{message}");
      ExitCode::FAILURE
    }
  }
}

/// Positional `<stub> <raw> <out>` plus an optional `--level <n>`. No clap — the
/// producer is invoked by the CLI with a fixed, validated argument shape.
fn parse_args() -> Result<Args, String> {
  let mut positional: Vec<PathBuf> = Vec::new();
  let mut level = None;
  let mut argv = std::env::args().skip(1);
  while let Some(arg) = argv.next() {
    match arg.as_str() {
      "--level" => {
        let value = argv.next().ok_or_else(|| usage("--level needs a value"))?;
        let parsed: i32 = value
          .parse()
          .map_err(|_| usage(&format!("--level value {value:?} is not an integer")))?;
        level = Some(parsed.clamp(MIN_LEVEL, MAX_LEVEL));
      }
      other if other.starts_with("--") => {
        return Err(usage(&format!("unknown flag {other:?}")));
      }
      _ => positional.push(PathBuf::from(arg)),
    }
  }
  let [stub, raw, out] = <[PathBuf; 3]>::try_from(positional)
    .map_err(|got| usage(&format!("expected 3 positional paths, got {}", got.len())))?;
  Ok(Args {
    stub,
    raw,
    out,
    level,
  })
}

fn usage(detail: &str) -> String {
  format!(
    "napi-compress: bad arguments.\n  \
     What:  {detail}\n  \
     Where: napi-compress <stub.node> <raw.node> <out.node> [--level <{MIN_LEVEL}..={MAX_LEVEL}>]\n  \
     Fix:   pass the prebuilt stub, the built addon, and the output path."
  )
}

/// Compress, inject, sign, and atomically write the output.
fn run(args: &Args) -> Result<String, String> {
  let raw_size = std::fs::metadata(&args.raw)
    .map_err(|e| {
      fail(
        "cannot inspect the built addon",
        &args.raw.display().to_string(),
        &e.to_string(),
        "pass the path to the compiled .node.",
      )
    })?
    .len();
  validate_addon_size(&args.raw, raw_size)?;

  let stub = std::fs::read(&args.stub).map_err(|e| {
    fail(
      "cannot read the prebuilt stub",
      &args.stub.display().to_string(),
      &e.to_string(),
      "reinstall @napi-rs/cli or rebuild the stubs (cli/build/stubs.mjs).",
    )
  })?;
  let raw = std::fs::read(&args.raw).map_err(|e| {
    fail(
      "cannot read the built addon",
      &args.raw.display().to_string(),
      &e.to_string(),
      "pass the path to the compiled .node.",
    )
  })?;
  validate_addon_size(&args.raw, raw.len() as u64)?;

  let has_relative_dependencies = if raw.starts_with(b"\x7fELF") {
    elf_uses_origin_search_path(&raw)?
  } else if is_macho(&raw) {
    macho_uses_relative_search_path(&raw)?
  } else if raw.starts_with(b"MZ") {
    pe_has_sibling_dependencies(&args.raw, &raw)?
  } else {
    false
  };
  if has_relative_dependencies {
    return Err(fail(
      "cannot compress an addon with sibling native libraries",
      &args.raw.display().to_string(),
      "the addon has a relative native-library dependency",
      "remove the sibling-library search path or link those libraries statically.",
    ));
  }

  let content_hash = napi_native_addon::fnv1a64(&raw);
  let level = compression_level(raw.len(), args.level);
  let payload = compress_payload(&raw, level).map_err(|e| {
    fail(
      "zstd compression failed",
      &args.raw.display().to_string(),
      &e.to_string(),
      "lower --level or check the input is readable.",
    )
  })?;
  let section_body = napi_native_addon::section::build_section_payload(content_hash, &payload);

  let injected = inject::inject_payload(&stub, &section_body).map_err(|e| {
    fail(
      "Mach-O section injection failed",
      &args.stub.display().to_string(),
      &e,
      "the stub must have header slack (built with -headerpad,0x1000) and a __LINKEDIT segment.",
    )
  })?;
  let signed = inject::resign(&injected, IDENTIFIER).map_err(|e| {
    fail(
      "ad-hoc re-sign failed",
      &args.out.display().to_string(),
      &e,
      "the injected Mach-O must be well-formed; re-run after a clean stub rebuild.",
    )
  })?;

  write_atomic(&args.out, &signed).map_err(|e| {
    fail(
      "cannot write the output",
      &args.out.display().to_string(),
      &e.to_string(),
      "check the output directory is writable.",
    )
  })?;

  Ok(format!(
    "{{\"rawSize\":{},\"compSize\":{},\"totalSize\":{},\"contentHash\":\"{content_hash:016x}\",\"level\":{level}}}",
    raw.len(),
    payload.len(),
    signed.len()
  ))
}

fn validate_addon_size(path: &Path, size: u64) -> Result<(), String> {
  if size > napi_native_addon::MAX_DECODED_SIZE {
    return Err(fail(
      "addon exceeds the runtime size limit",
      &path.display().to_string(),
      &format!(
        "{size} bytes; maximum is {} bytes",
        napi_native_addon::MAX_DECODED_SIZE
      ),
      "reduce the addon below 2 GiB.",
    ));
  }
  Ok(())
}

fn elf_uses_origin_search_path(bytes: &[u8]) -> Result<bool, String> {
  let elf = goblin::elf::Elf::parse(bytes)
    .map_err(|error| format!("cannot inspect ELF runtime paths: {error}"))?;
  Ok(has_origin_search_path(&elf.rpaths, &elf.runpaths))
}

fn is_macho(bytes: &[u8]) -> bool {
  matches!(
    bytes.get(..4),
    Some([0xcf, 0xfa, 0xed, 0xfe])
      | Some([0xfe, 0xed, 0xfa, 0xcf])
      | Some([0xce, 0xfa, 0xed, 0xfe])
      | Some([0xfe, 0xed, 0xfa, 0xce])
      | Some([0xca, 0xfe, 0xba, 0xbe])
      | Some([0xbe, 0xba, 0xfe, 0xca])
  )
}

fn macho_uses_relative_search_path(bytes: &[u8]) -> Result<bool, String> {
  use goblin::mach::{Mach, MachO, SingleArch};

  fn has_relative_path(macho: &MachO<'_>) -> bool {
    macho_uses_relative_paths(macho.libs.get(1..).unwrap_or_default(), &macho.rpaths)
  }

  let mach =
    Mach::parse(bytes).map_err(|error| format!("cannot inspect Mach-O runtime paths: {error}"))?;
  match mach {
    Mach::Binary(macho) => Ok(has_relative_path(&macho)),
    Mach::Fat(architectures) => {
      for arch in &architectures {
        let arch = arch.map_err(|error| format!("cannot inspect Mach-O architectures: {error}"))?;
        if let SingleArch::MachO(macho) = arch {
          if has_relative_path(&macho) {
            return Ok(true);
          }
        }
      }
      Ok(false)
    }
  }
}

fn macho_uses_relative_paths(libraries: &[&str], rpaths: &[&str]) -> bool {
  let loader_relative = libraries
    .iter()
    .any(|library| library.starts_with("@loader_path/"));
  let relative_rpath = rpaths
    .iter()
    .any(|rpath| !rpath.starts_with('/') && !rpath.starts_with("@executable_path"));
  let uses_rpath = libraries
    .iter()
    .any(|library| library.starts_with("@rpath/"));
  loader_relative || (uses_rpath && relative_rpath)
}

fn pe_has_sibling_dependencies(raw_path: &Path, bytes: &[u8]) -> Result<bool, String> {
  let pe =
    goblin::pe::PE::parse(bytes).map_err(|error| format!("cannot inspect PE imports: {error}"))?;
  Ok(pe_imports_sibling(raw_path, &pe.libraries))
}

fn pe_imports_sibling(raw_path: &Path, libraries: &[&str]) -> bool {
  let parent = raw_path
    .parent()
    .filter(|path| !path.as_os_str().is_empty());
  let parent = parent.unwrap_or_else(|| Path::new("."));
  let siblings = std::fs::read_dir(parent)
    .ok()
    .map(|entries| {
      entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  libraries.iter().any(|library| {
    let absolute = library.starts_with('/')
      || library.starts_with('\\')
      || (library.as_bytes().get(1) == Some(&b':')
        && library
          .as_bytes()
          .get(2)
          .is_some_and(|byte| *byte == b'/' || *byte == b'\\'));
    if absolute {
      return false;
    }
    if library.contains('/') || library.contains('\\') {
      return true;
    }
    let wanted = library.to_ascii_lowercase();
    siblings
      .iter()
      .any(|name| name.eq_ignore_ascii_case(&wanted))
  })
}

fn has_origin_search_path(rpaths: &[&str], runpaths: &[&str]) -> bool {
  rpaths
    .iter()
    .chain(runpaths)
    .any(|path| path.contains("$ORIGIN") || path.contains("${ORIGIN}"))
}

fn compression_level(raw_len: usize, requested: Option<i32>) -> i32 {
  requested.unwrap_or(if raw_len >= LARGE_INPUT_THRESHOLD {
    LARGE_INPUT_LEVEL
  } else {
    DEFAULT_LEVEL
  })
}

fn compress_payload(raw: &[u8], level: i32) -> std::io::Result<Vec<u8>> {
  let mut compressor = zstd::bulk::Compressor::new(level)?;
  if raw.len() >= LARGE_INPUT_THRESHOLD {
    let window_log = (usize::BITS - raw.len().saturating_sub(1).leading_zeros()).clamp(10, 26);
    compressor
      .set_parameter(zstd::zstd_safe::CParameter::EnableLongDistanceMatching(
        true,
      ))
      .and_then(|()| compressor.set_parameter(zstd::zstd_safe::CParameter::WindowLog(window_log)))
      .and_then(|()| compressor.set_parameter(zstd::zstd_safe::CParameter::HashLog(20)))
      .and_then(|()| compressor.set_parameter(zstd::zstd_safe::CParameter::SearchLog(8)))?;
  }
  compressor.compress(raw)
}

/// A four-ingredient error: What / Where / Saw / Fix.
fn fail(what: &str, where_: &str, saw: &str, fix: &str) -> String {
  format!(
    "napi-compress: {what}.\n  \
     Where: {where_}\n  \
     Saw:   {saw}\n  \
     Fix:   {fix}"
  )
}

/// Write to a sibling temp then rename over `out`, so a crash never leaves a
/// half-written (and thus unsigned/unloadable) `.node` at the final path.
fn write_atomic(out: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
  #[cfg(target_os = "linux")]
  let _output_lock = napi_native_addon::lock_output_directory(out).ok();

  let dir = out.parent().unwrap_or_else(|| std::path::Path::new("."));
  let name = out
    .file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .unwrap_or_else(|| "out.node".to_string());
  let tmp = dir.join(format!(".{name}.napi-compress-{}.tmp", std::process::id()));
  std::fs::write(&tmp, data)?;
  std::fs::rename(&tmp, out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_level_scales_with_addon_size() {
    assert_eq!(
      compression_level(LARGE_INPUT_THRESHOLD - 1, None),
      DEFAULT_LEVEL
    );
    assert_eq!(
      compression_level(LARGE_INPUT_THRESHOLD, None),
      LARGE_INPUT_LEVEL
    );
  }

  #[test]
  fn explicit_level_overrides_size_default() {
    assert_eq!(compression_level(LARGE_INPUT_THRESHOLD, Some(17)), 17);
  }

  #[test]
  fn rejects_addons_above_the_runtime_size_limit() {
    assert!(
      validate_addon_size(Path::new("addon.node"), napi_native_addon::MAX_DECODED_SIZE).is_ok()
    );
    assert!(validate_addon_size(
      Path::new("addon.node"),
      napi_native_addon::MAX_DECODED_SIZE + 1
    )
    .is_err());
  }

  #[test]
  fn large_payload_round_trips_with_bounded_compression_parameters() {
    let raw = vec![0x5a; LARGE_INPUT_THRESHOLD];
    let compressed = compress_payload(&raw, LARGE_INPUT_LEVEL).unwrap();
    let decoded = zstd::bulk::decompress(&compressed, raw.len()).unwrap();
    assert_eq!(decoded, raw);
  }

  #[test]
  fn detects_sibling_library_search_paths() {
    assert!(has_origin_search_path(&[], &["$ORIGIN/lib"]));
    assert!(has_origin_search_path(&["${ORIGIN}/lib"], &[]));
    assert!(!has_origin_search_path(&["/usr/lib"], &["/opt/lib"]));
  }

  #[test]
  fn detects_relative_macho_dependencies() {
    assert!(macho_uses_relative_paths(
      &["@loader_path/libaddon.dylib"],
      &[]
    ));
    assert!(macho_uses_relative_paths(
      &["@rpath/libaddon.dylib"],
      &["@loader_path/../lib"]
    ));
    assert!(!macho_uses_relative_paths(
      &["@rpath/libSystem.dylib"],
      &["/usr/lib"]
    ));
    assert!(!macho_uses_relative_paths(
      &["@rpath/libaddon.dylib"],
      &["@executable_path/../Frameworks"]
    ));
  }

  #[test]
  fn detects_pe_imports_of_sibling_dlls() {
    let dir = std::env::temp_dir().join(format!("napi-compress-pe-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("sibling.dll"), b"").unwrap();
    let raw_path = dir.join("addon.node");
    assert!(pe_imports_sibling(&raw_path, &["sibling.dll"]));
    assert!(!pe_imports_sibling(&raw_path, &["kernel32.dll"]));
    assert!(pe_imports_sibling(&raw_path, &["sub/sibling.dll"]));
    std::fs::remove_dir_all(dir).ok();
  }
}
