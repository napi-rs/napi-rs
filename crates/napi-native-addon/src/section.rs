//! Read the stub's own `__NAPI_PAYLOAD` payload from a signable section of its own
//! binary image — the code-signing-safe replacement for the EOF trailer.
//!
//! The producer injects a named section (Mach-O `SMOL/__NAPI_PAYLOAD`, ELF `.NAPI_PAYLOAD`,
//! PE `.NAPI`) whose bytes are `[MAGIC][content_hash u64 LE][zstd payload]`.
//! A section is covered by the code signature and located via the binary's
//! section table, so the file stays `codesign -v`-clean and notarizable — unlike
//! appended trailer bytes, which fail strict validation.
//!
//! The parse is hand-rolled (no `object` crate — the crate is dependency-lean and
//! the stub is `panic=abort`), length-guarded throughout, and a faithful port of
//! the proven readers in socket-btm `bin-infra/smol_segment_reader.c`. Each target
//! only needs its own format, so the per-OS finder is `cfg`-gated.

use std::path::Path;

/// Head of the `__NAPI_PAYLOAD` section payload. Distinguishes our section from any
/// stray same-named section and fails closed on a malformed image.
const SECTION_MAGIC: &[u8; 8] = b"NAPCSECT";

/// The validated contents of the stub's own `__NAPI_PAYLOAD` section.
pub(crate) struct SectionData {
  /// FNV-1a of the RAW addon — names the cache file without decoding the payload.
  pub content_hash: u64,
  /// The zstd payload (the compressed raw addon).
  pub payload: Vec<u8>,
}

/// Read + validate the stub's own `__NAPI_PAYLOAD` section. `None` if the file has no
/// such section or it is malformed (caller treats it as "not a compressed stub").
pub(crate) fn read_self_section(self_path: &Path) -> Option<SectionData> {
  let bytes = std::fs::read(self_path).ok()?;
  parse_section_payload(find_section(&bytes)?)
}

/// Parse the `[MAGIC][content_hash u64 LE][zstd payload]` section body. Pure (no
/// I/O) so the wire format is unit-testable against [`build_section_payload`]
/// without a real Mach-O. `None` on a missing magic or a too-short body.
fn parse_section_payload(raw: &[u8]) -> Option<SectionData> {
  if raw.len() < 16 || &raw[0..8] != SECTION_MAGIC {
    return None;
  }
  Some(SectionData {
    content_hash: u64::from_le_bytes(raw[8..16].try_into().ok()?),
    payload: raw[16..].to_vec(),
  })
}

/// Assemble the `__NAPI_PAYLOAD` section body the producer injects: the magic, the raw
/// addon's content hash (for cache naming without decoding), then the zstd payload.
/// The single source of truth for the section ABI, shared with [`read_self_section`].
pub fn build_section_payload(content_hash: u64, zstd_payload: &[u8]) -> Vec<u8> {
  let mut out = Vec::with_capacity(16 + zstd_payload.len());
  out.extend_from_slice(SECTION_MAGIC);
  out.extend_from_slice(&content_hash.to_le_bytes());
  out.extend_from_slice(zstd_payload);
  out
}

/// Build a minimal host-format object file (Mach-O / ELF / PE) carrying one
/// `__NAPI_PAYLOAD` section whose bytes are exactly `body`, so the OS-gated parser and
/// `resolve_self` can be exercised without an external injector. The real-binary
/// round-trip is covered by the producer-phase `.node` test. Test-only, but lives
/// at module scope so `lib.rs`'s tests can reuse it.
#[cfg(test)]
pub(crate) fn synthetic_object_with_section(body: &[u8]) -> Vec<u8> {
  #[cfg(target_os = "macos")]
  {
    // header(32) + one LC_SEGMENT_64 (72 segment + 80 section = 152) = 184, then
    // the section body appended at offset 184.
    let mut m = vec![0u8; 184];
    m[0..4].copy_from_slice(&0xfeed_facfu32.to_le_bytes()); // MH_MAGIC_64
    m[16..20].copy_from_slice(&1u32.to_le_bytes()); // ncmds
    m[32..36].copy_from_slice(&0x19u32.to_le_bytes()); // LC_SEGMENT_64
    m[36..40].copy_from_slice(&152u32.to_le_bytes()); // cmdsize
    m[40..44].copy_from_slice(b"SMOL"); // segname
    m[96..100].copy_from_slice(&1u32.to_le_bytes()); // nsects (off 32 + 64)
    let s = 104; // sections start at off 32 + 72
    m[s..s + 16].copy_from_slice(b"__NAPI_PAYLOAD\0\0"); // sectname
    m[s + 16..s + 20].copy_from_slice(b"SMOL"); // section's segname
    m[s + 40..s + 48].copy_from_slice(&(body.len() as u64).to_le_bytes()); // size
    m[s + 48..s + 52].copy_from_slice(&184u32.to_le_bytes()); // offset
    m.extend_from_slice(body);
    m
  }
  #[cfg(target_os = "linux")]
  {
    // ELF64 LE: header(64) + section body @64 + 2 section headers (SHT_NULL +
    // .NAPI) + a .shstrtab. Lay out: [ehdr][body][shstrtab][shdrs].
    let body_off = 64usize;
    let shstr = b"\0.NAPI_PAYLOAD\0.shstrtab\0";
    let shstr_off = body_off + body.len();
    let shoff = shstr_off + shstr.len();
    let shentsize = 64usize;
    let shnum = 3usize; // NULL, .NAPI_PAYLOAD, .shstrtab
    let shstrndx = 2usize;
    let total = shoff + shnum * shentsize;
    let mut e = vec![0u8; total];
    e[0..4].copy_from_slice(b"\x7fELF");
    e[4] = 2; // 64-bit
    e[5] = 1; // little-endian
    e[6] = 1; // version
    e[40..48].copy_from_slice(&(shoff as u64).to_le_bytes()); // e_shoff
    e[58..60].copy_from_slice(&(shentsize as u16).to_le_bytes()); // e_shentsize
    e[60..62].copy_from_slice(&(shnum as u16).to_le_bytes()); // e_shnum
    e[62..64].copy_from_slice(&(shstrndx as u16).to_le_bytes()); // e_shstrndx
    e[body_off..body_off + body.len()].copy_from_slice(body);
    e[shstr_off..shstr_off + shstr.len()].copy_from_slice(shstr);
    // shdr[1] = .NAPI_PAYLOAD: sh_name=1, sh_offset=body_off, sh_size=body.
    let sh1 = shoff + shentsize;
    e[sh1..sh1 + 4].copy_from_slice(&1u32.to_le_bytes()); // sh_name
    e[sh1 + 24..sh1 + 32].copy_from_slice(&(body_off as u64).to_le_bytes()); // sh_offset
    e[sh1 + 32..sh1 + 40].copy_from_slice(&(body.len() as u64).to_le_bytes()); // sh_size
                                                                               // shdr[2] = .shstrtab: sh_name points past the payload name.
    let sh2 = shoff + 2 * shentsize;
    e[sh2..sh2 + 4].copy_from_slice(&(b"\0.NAPI_PAYLOAD\0".len() as u32).to_le_bytes());
    e[sh2 + 24..sh2 + 32].copy_from_slice(&(shstr_off as u64).to_le_bytes()); // sh_offset
    e[sh2 + 32..sh2 + 40].copy_from_slice(&(shstr.len() as u64).to_le_bytes()); // sh_size
    e
  }
  #[cfg(target_os = "windows")]
  {
    // Minimal PE: DOS stub (e_lfanew @0x3c) → PE\0\0 + COFF header (1 section, no
    // optional header) → one section header naming .NAPI → the body.
    let pe_off = 0x40usize;
    let coff = pe_off + 4;
    let sect_hdr = coff + 20; // opt_hdr_size = 0
    let body_off = sect_hdr + 40;
    let total = body_off + body.len();
    let mut p = vec![0u8; total];
    p[0..2].copy_from_slice(b"MZ");
    p[0x3c..0x40].copy_from_slice(&(pe_off as u32).to_le_bytes()); // e_lfanew
    p[pe_off..pe_off + 4].copy_from_slice(b"PE\0\0");
    p[coff + 2..coff + 4].copy_from_slice(&1u16.to_le_bytes()); // NumberOfSections
    p[coff + 16..coff + 18].copy_from_slice(&0u16.to_le_bytes()); // SizeOfOptionalHeader
    p[sect_hdr..sect_hdr + 5].copy_from_slice(b".NAPI");
    p[sect_hdr + 8..sect_hdr + 12].copy_from_slice(&(body.len() as u32).to_le_bytes()); // VirtualSize
    p[sect_hdr + 16..sect_hdr + 20].copy_from_slice(&(body.len() as u32).to_le_bytes()); // SizeOfRawData
    p[sect_hdr + 20..sect_hdr + 24].copy_from_slice(&(body_off as u32).to_le_bytes()); // PointerToRawData
    p[body_off..body_off + body.len()].copy_from_slice(body);
    p
  }
  #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
  {
    let _ = body;
    Vec::new()
  }
}

/// A null-padded fixed-width name slot equals `want` (e.g. Mach-O's 16-byte
/// `sectname`/`segname`): the leading bytes match and the remainder is NUL.
#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn name_eq(slot: &[u8], want: &[u8]) -> bool {
  slot.len() >= want.len()
    && &slot[..want.len()] == want
    && slot[want.len()..].iter().all(|&b| b == 0)
}

// ---------------------------------------------------------------------------
// macOS — 64-bit little-endian Mach-O (every darwin napi target is x86_64/arm64,
// both LE). Walk load commands → SMOL segment → __NAPI_PAYLOAD section.
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
fn find_section(bytes: &[u8]) -> Option<&[u8]> {
  const MH_MAGIC_64: u32 = 0xfeed_facf;
  const LC_SEGMENT_64: u32 = 0x19;

  if u32::from_le_bytes(bytes.get(0..4)?.try_into().ok()?) != MH_MAGIC_64 {
    return None;
  }
  let ncmds = u32::from_le_bytes(bytes.get(16..20)?.try_into().ok()?);
  // mach_header_64 is 32 bytes; load commands follow.
  let mut off = 32usize;
  for _ in 0..ncmds {
    let cmd = u32::from_le_bytes(bytes.get(off..off + 4)?.try_into().ok()?);
    let cmdsize = u32::from_le_bytes(bytes.get(off + 4..off + 8)?.try_into().ok()?) as usize;
    if cmdsize < 8 {
      return None;
    }
    if cmd == LC_SEGMENT_64 && name_eq(bytes.get(off + 8..off + 24)?, b"SMOL") {
      // segment_command_64: cmd,cmdsize,segname[16],vmaddr,vmsize,fileoff,
      // filesize,maxprot,initprot,nsects,flags — nsects at off+64, sections at off+72.
      let nsects = u32::from_le_bytes(bytes.get(off + 64..off + 68)?.try_into().ok()?);
      let mut soff = off + 72;
      for _ in 0..nsects {
        // section_64: sectname[16],segname[16],addr(8),size(8),offset(4),...(80 total).
        if name_eq(bytes.get(soff..soff + 16)?, b"__NAPI_PAYLOAD") {
          let size = u64::from_le_bytes(bytes.get(soff + 40..soff + 48)?.try_into().ok()?) as usize;
          let offset =
            u32::from_le_bytes(bytes.get(soff + 48..soff + 52)?.try_into().ok()?) as usize;
          return bytes.get(offset..offset.checked_add(size)?);
        }
        soff = soff.checked_add(80)?;
      }
    }
    off = off.checked_add(cmdsize)?;
  }
  None
}

// ---------------------------------------------------------------------------
// Linux — ELF (32/64, LE). Walk the section-header table + .shstrtab for a
// PROGBITS section named `.NAPI_PAYLOAD`. Ported from smol_find_node_ver_section_elf.
// ---------------------------------------------------------------------------
#[cfg(target_os = "linux")]
fn find_section(bytes: &[u8]) -> Option<&[u8]> {
  if bytes.get(0..4)? != b"\x7fELF" {
    return None;
  }
  let is_64 = *bytes.get(4)? == 2;
  let le = *bytes.get(5)? == 1;
  let r16 = |o: usize| -> Option<u16> {
    let b = bytes.get(o..o + 2)?.try_into().ok()?;
    Some(if le {
      u16::from_le_bytes(b)
    } else {
      u16::from_be_bytes(b)
    })
  };
  let r32 = |o: usize| -> Option<u32> {
    let b = bytes.get(o..o + 4)?.try_into().ok()?;
    Some(if le {
      u32::from_le_bytes(b)
    } else {
      u32::from_be_bytes(b)
    })
  };
  let r64 = |o: usize| -> Option<u64> {
    let b = bytes.get(o..o + 8)?.try_into().ok()?;
    Some(if le {
      u64::from_le_bytes(b)
    } else {
      u64::from_be_bytes(b)
    })
  };

  let (e_shoff, e_shentsize, e_shnum, e_shstrndx) = if is_64 {
    (
      r64(40)? as usize,
      r16(58)? as usize,
      r16(60)? as usize,
      r16(62)? as usize,
    )
  } else {
    (
      r32(32)? as usize,
      r16(46)? as usize,
      r16(48)? as usize,
      r16(50)? as usize,
    )
  };
  if e_shnum == 0 || e_shstrndx >= e_shnum {
    return None;
  }

  // .shstrtab section header → its file offset + size.
  let str_hdr = e_shoff.checked_add(e_shstrndx.checked_mul(e_shentsize)?)?;
  let (strtab_off, strtab_size) = if is_64 {
    (r64(str_hdr + 24)? as usize, r64(str_hdr + 32)? as usize)
  } else {
    (r32(str_hdr + 16)? as usize, r32(str_hdr + 20)? as usize)
  };
  let strtab = bytes.get(strtab_off..strtab_off.checked_add(strtab_size)?)?;

  for i in 0..e_shnum {
    let sh = e_shoff.checked_add(i.checked_mul(e_shentsize)?)?;
    let name_off = r32(sh)? as usize;
    let name = strtab.get(name_off..)?;
    let end = name.iter().position(|&b| b == 0).unwrap_or(name.len());
    if &name[..end] == b".NAPI_PAYLOAD" {
      let (off, size) = if is_64 {
        (r64(sh + 24)? as usize, r64(sh + 32)? as usize)
      } else {
        (r32(sh + 16)? as usize, r32(sh + 20)? as usize)
      };
      return bytes.get(off..off.checked_add(size)?);
    }
  }
  None
}

// ---------------------------------------------------------------------------
// Windows — PE. Walk the COFF section table for `.NAPI` (8-byte name slot).
// Ported from smol_find_pressed_data_offset_pe.
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
fn find_section(bytes: &[u8]) -> Option<&[u8]> {
  if bytes.get(0..2)? != b"MZ" {
    return None;
  }
  let pe_off = u32::from_le_bytes(bytes.get(0x3c..0x40)?.try_into().ok()?) as usize;
  if bytes.get(pe_off..pe_off + 4)? != b"PE\0\0" {
    return None;
  }
  // COFF header at pe_off+4: NumberOfSections u16 @+2, SizeOfOptionalHeader u16 @+16.
  let num_sections = u16::from_le_bytes(bytes.get(pe_off + 6..pe_off + 8)?.try_into().ok()?);
  let opt_hdr_size =
    u16::from_le_bytes(bytes.get(pe_off + 20..pe_off + 22)?.try_into().ok()?) as usize;
  let mut sh = pe_off.checked_add(24)?.checked_add(opt_hdr_size)?;
  // Each section header is 40 bytes: Name[8], VirtualSize@8(4), SizeOfRawData@16(4),
  // PointerToRawData@20(4). Use VirtualSize for the true content length — the raw
  // data on disk is padded up to FileAlignment, so SizeOfRawData would trail the
  // payload with zero-fill. Cap at SizeOfRawData so we never read past the file data.
  for _ in 0..num_sections {
    let name = bytes.get(sh..sh + 8)?;
    if name_eq(name, b".NAPI") {
      let virtual_size = u32::from_le_bytes(bytes.get(sh + 8..sh + 12)?.try_into().ok()?) as usize;
      let raw_size = u32::from_le_bytes(bytes.get(sh + 16..sh + 20)?.try_into().ok()?) as usize;
      let raw_ptr = u32::from_le_bytes(bytes.get(sh + 20..sh + 24)?.try_into().ok()?) as usize;
      let len = virtual_size.min(raw_size);
      return bytes.get(raw_ptr..raw_ptr.checked_add(len)?);
    }
    sh = sh.checked_add(40)?;
  }
  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn name_eq_matches_null_padded_slot() {
    assert!(name_eq(b"__NAPI_PAYLOAD\0\0\0\0\0\0\0", b"__NAPI_PAYLOAD"));
    assert!(name_eq(b"SMOL\0\0\0\0\0\0\0\0\0\0\0\0", b"SMOL"));
    assert!(!name_eq(b"__NAPI_PAYLOADX\0\0\0\0\0\0", b"__NAPI_PAYLOAD"));
    assert!(!name_eq(b"__OTHER\0\0\0\0\0\0\0\0", b"__NAPI_PAYLOAD"));
  }

  #[test]
  fn rejects_non_object_file() {
    assert!(find_section(b"not a binary at all").is_none());
    assert!(find_section(&[]).is_none());
  }

  #[test]
  fn build_and_parse_section_payload_round_trip() {
    let body = build_section_payload(0xfeed_face_dead_beef, b"the-zstd-bytes");
    let got = parse_section_payload(&body).expect("parses");
    assert_eq!(got.content_hash, 0xfeed_face_dead_beef);
    assert_eq!(got.payload, b"the-zstd-bytes");
    // Empty payload is still a valid (header-only) body.
    assert!(parse_section_payload(&build_section_payload(0, b"")).is_some());
  }

  #[test]
  fn parse_section_payload_rejects_bad_input() {
    assert!(parse_section_payload(b"short").is_none());
    assert!(parse_section_payload(b"WRONGMAG\0\0\0\0\0\0\0\0").is_none());
  }

  // Build a minimal host-format object (Mach-O / ELF / PE) carrying one __NAPI_PAYLOAD
  // section, so the parser arithmetic (load-command / section-header offsets) is
  // validated against a known layout without an external injector. The real-binary
  // round-trip is covered by the producer-phase `.node` test.
  #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
  #[test]
  fn reads_payload_from_a_synthetic_object() {
    let body = build_section_payload(0x0123_4567_89ab_cdef, b"the-zstd-payload-bytes");
    let obj = synthetic_object_with_section(&body);

    let dir = std::env::temp_dir().join(format!("napi-native-addon-sect-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("stub.node");
    std::fs::write(&p, &obj).unwrap();
    let got = read_self_section(&p).expect("section found");
    assert_eq!(got.content_hash, 0x0123_4567_89ab_cdef);
    assert_eq!(got.payload, b"the-zstd-payload-bytes");
    std::fs::remove_dir_all(&dir).ok();
  }
}
