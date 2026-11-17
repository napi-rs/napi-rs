//! Mach-O segment-insertion surgery + ad-hoc re-sign.
//!
//! Splices a READ-only `SMOL/__NAPI_PAYLOAD` `LC_SEGMENT_64` immediately before the
//! `__LINKEDIT` segment command (into the header slack), shifts `__LINKEDIT` and
//! every linkedit-pointing file offset down by the page-rounded section size, then
//! strips the stale `LC_CODE_SIGNATURE`. The result is re-signed ad-hoc so the new
//! section is covered by the signature.
//!
//! Every structural offset is walked at runtime from the load commands — the stub
//! is rebuilt by `cli/build/stubs.mjs` and `-headerpad` guarantees only *slack*,
//! not fixed offsets. The byte layout is proven against a binject(LIEF)-produced
//! reference (segment `filesize` = unpadded body length, `vmsize` = page-rounded;
//! section `size` = body length, `offset` = `fileoff` = the old `__LINKEDIT`
//! fileoff; W^X `initprot` = `maxprot` = `VM_PROT_READ`).

const MH_MAGIC_64: u32 = 0xfeed_facf;
const LC_SEGMENT_64: u32 = 0x19;
const LC_SYMTAB: u32 = 0x02;
const LC_DYSYMTAB: u32 = 0x0b;
const LC_DYLD_INFO: u32 = 0x22;
const LC_DYLD_INFO_ONLY: u32 = 0x8000_0022;
const LC_FUNCTION_STARTS: u32 = 0x26;
const LC_DATA_IN_CODE: u32 = 0x29;
const LC_CODE_SIGNATURE: u32 = 0x1d;
const LC_DYLD_CHAINED_FIXUPS: u32 = 0x8000_0034;
const LC_DYLD_EXPORTS_TRIE: u32 = 0x8000_0033;

const CPU_TYPE_ARM64: u32 = 0x0100_000c;

const MACH_HEADER_64_SIZE: usize = 32;
/// `cmd,cmdsize,segname[16],vmaddr,vmsize,fileoff,filesize,maxprot,initprot,nsects,flags`.
const SEGMENT_COMMAND_64_SIZE: usize = 72;
/// `sectname[16],segname[16],addr,size,offset,align,reloff,nreloc,flags,reserved1..3`.
const SECTION_64_SIZE: usize = 80;
const NEW_LC_SIZE: usize = SEGMENT_COMMAND_64_SIZE + SECTION_64_SIZE; // 152

/// `VM_PROT_READ` only. An injected segment MUST be read-only: RWX (0x07) makes
/// dyld refuse to mmap the bundle on dlopen (EACCES) even with a valid signature.
const VM_PROT_READ: u32 = 0x01;

fn u32_le(bytes: &[u8], off: usize) -> Result<u32, String> {
  bytes
    .get(off..off + 4)
    .and_then(|s| s.try_into().ok())
    .map(u32::from_le_bytes)
    .ok_or_else(|| format!("truncated u32 at offset {off}"))
}

fn u64_le(bytes: &[u8], off: usize) -> Result<u64, String> {
  bytes
    .get(off..off + 8)
    .and_then(|s| s.try_into().ok())
    .map(u64::from_le_bytes)
    .ok_or_else(|| format!("truncated u64 at offset {off}"))
}

fn put_u32(bytes: &mut [u8], off: usize, value: u32) {
  bytes[off..off + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_u64(bytes: &mut [u8], off: usize, value: u64) {
  bytes[off..off + 8].copy_from_slice(&value.to_le_bytes());
}

fn round_up(value: u64, align: u64) -> u64 {
  if align == 0 {
    return value;
  }
  value.div_ceil(align) * align
}

/// One linkedit-pointing field to bump: the absolute byte offset of a `u32`
/// file-offset field within the (post-splice) command stream.
struct OffsetField {
  at: usize,
}

/// The structural anchors found by walking the load commands once.
struct Layout {
  page_size: u64,
  /// Byte offset of the `__LINKEDIT` segment command (splice point).
  linkedit_lc_off: usize,
  linkedit_fileoff: u64,
  linkedit_vmaddr: u64,
  /// `LC_CODE_SIGNATURE`, if present: (command byte offset, sig dataoff, sig datasize).
  code_sig: Option<CodeSig>,
  /// First `__TEXT` section file offset — the slack boundary the new LC must fit
  /// under (everything before it is header + load commands).
  first_section_offset: u64,
  end_of_lc: usize,
  /// Linkedit-pointing `u32` file-offset fields, by their byte offset in the
  /// ORIGINAL command stream (caller re-bases by +NEW_LC after the splice).
  linkedit_pointers: Vec<OffsetField>,
}

struct CodeSig {
  lc_off: usize,
  dataoff: u64,
}

/// Walk the mach_header_64 + load commands once, recording every anchor the
/// surgery touches. Refuses anything but a single-arch 64-bit LE Mach-O.
fn read_layout(bytes: &[u8]) -> Result<Layout, String> {
  if u32_le(bytes, 0)? != MH_MAGIC_64 {
    return Err("not a 64-bit little-endian Mach-O (bad magic)".to_string());
  }
  let cputype = u32_le(bytes, 4)?;
  let page_size: u64 = if cputype == CPU_TYPE_ARM64 {
    0x4000
  } else {
    0x1000
  };
  let ncmds = u32_le(bytes, 16)?;

  let mut linkedit_lc_off: Option<usize> = None;
  let mut linkedit_fileoff = 0u64;
  let mut linkedit_vmaddr = 0u64;
  let mut code_sig: Option<CodeSig> = None;
  let mut first_section_offset = u64::MAX;
  let mut linkedit_pointers: Vec<OffsetField> = Vec::new();

  let mut off = MACH_HEADER_64_SIZE;
  for _ in 0..ncmds {
    let cmd = u32_le(bytes, off)?;
    let cmdsize = u32_le(bytes, off + 4)? as usize;
    if cmdsize < 8 || off + cmdsize > bytes.len() {
      return Err(format!(
        "malformed load command at {off} (cmdsize {cmdsize})"
      ));
    }
    match cmd {
      LC_SEGMENT_64 => {
        let segname = &bytes[off + 8..off + 24];
        let fileoff = u64_le(bytes, off + 40)?;
        let nsects = u32_le(bytes, off + 64)?;
        if name_eq(segname, b"__LINKEDIT") {
          linkedit_lc_off = Some(off);
          linkedit_fileoff = fileoff;
          linkedit_vmaddr = u64_le(bytes, off + 24)?;
        }
        // Track the smallest section file offset across every segment — the
        // header-slack ceiling (load commands must not overrun the first
        // mapped section's bytes).
        let mut soff = off + SEGMENT_COMMAND_64_SIZE;
        for _ in 0..nsects {
          let sect_off = u32_le(bytes, soff + 48)? as u64;
          // offset == 0 marks a zero-fill section (__bss/__thread_bss); skip it.
          if sect_off != 0 && sect_off < first_section_offset {
            first_section_offset = sect_off;
          }
          soff += SECTION_64_SIZE;
        }
      }
      LC_DYLD_INFO | LC_DYLD_INFO_ONLY => {
        // rebase_off@8, bind_off@16, weak_bind_off@24, lazy_bind_off@32, export_off@40.
        for field in [8, 16, 24, 32, 40] {
          linkedit_pointers.push(OffsetField { at: off + field });
        }
      }
      LC_SYMTAB => {
        // symoff@8, stroff@16.
        linkedit_pointers.push(OffsetField { at: off + 8 });
        linkedit_pointers.push(OffsetField { at: off + 16 });
      }
      LC_DYSYMTAB => {
        // tocoff@32, modtaboff@40, extrefsymoff@48, indirectsymoff@56,
        // extreloff@64, locreloff@72 — all linkedit-relative file offsets.
        for field in [32, 40, 48, 56, 64, 72] {
          linkedit_pointers.push(OffsetField { at: off + field });
        }
      }
      LC_FUNCTION_STARTS | LC_DATA_IN_CODE | LC_DYLD_CHAINED_FIXUPS | LC_DYLD_EXPORTS_TRIE => {
        // linkedit_data_command: dataoff@8.
        linkedit_pointers.push(OffsetField { at: off + 8 });
      }
      LC_CODE_SIGNATURE => {
        // linkedit_data_command: dataoff is a u32 file offset at +8 (NOT a u64).
        code_sig = Some(CodeSig {
          lc_off: off,
          dataoff: u32_le(bytes, off + 8)? as u64,
        });
      }
      _ => {}
    }
    off += cmdsize;
  }

  let linkedit_lc_off =
    linkedit_lc_off.ok_or_else(|| "no __LINKEDIT segment to anchor the new section".to_string())?;
  if first_section_offset == u64::MAX {
    return Err("no mapped section to bound the header slack".to_string());
  }
  Ok(Layout {
    page_size,
    linkedit_lc_off,
    linkedit_fileoff,
    linkedit_vmaddr,
    code_sig,
    first_section_offset,
    end_of_lc: off,
    linkedit_pointers,
  })
}

/// A NUL-padded fixed-width name slot equals `want`.
fn name_eq(slot: &[u8], want: &[u8]) -> bool {
  slot.len() >= want.len()
    && &slot[..want.len()] == want
    && slot[want.len()..].iter().all(|&b| b == 0)
}

/// Build the 152-byte `LC_SEGMENT_64` + one `section_64` for `SMOL/__NAPI_PAYLOAD`.
fn build_segment_lc(body_len: u64, delta: u64, fileoff: u64, vmaddr: u64) -> Vec<u8> {
  let mut lc = vec![0u8; NEW_LC_SIZE];
  // segment_command_64
  put_u32(&mut lc, 0, LC_SEGMENT_64);
  put_u32(&mut lc, 4, NEW_LC_SIZE as u32);
  lc[8..12].copy_from_slice(b"SMOL"); // segname (NUL-padded)
  put_u64(&mut lc, 24, vmaddr); // vmaddr
  put_u64(&mut lc, 32, delta); // vmsize (page-rounded)
  put_u64(&mut lc, 40, fileoff); // fileoff
  put_u64(&mut lc, 48, body_len); // filesize (unpadded body)
  put_u32(&mut lc, 56, VM_PROT_READ); // maxprot
  put_u32(&mut lc, 60, VM_PROT_READ); // initprot (W^X)
  put_u32(&mut lc, 64, 1); // nsects
  put_u32(&mut lc, 68, 0); // flags
                           // section_64 at +72
  let s = SEGMENT_COMMAND_64_SIZE;
  lc[s..s + 16].copy_from_slice(b"__NAPI_PAYLOAD\0\0"); // sectname
  lc[s + 16..s + 20].copy_from_slice(b"SMOL"); // segname
  put_u64(&mut lc, s + 32, vmaddr); // addr
  put_u64(&mut lc, s + 40, body_len); // size (unpadded body)
  put_u32(&mut lc, s + 48, fileoff as u32); // offset
  put_u32(&mut lc, s + 52, 2); // align 2^2 = 4
                               // reloff/nreloc/flags/reserved1..3 stay 0
  lc
}

/// Inject the `__NAPI_PAYLOAD` section carrying `section_body` into the prebuilt stub,
/// dispatching on the stub's object format. Mach-O is re-signed by the caller; ELF
/// and PE need no signature (their loaders don't enforce one on `dlopen`).
pub fn inject_payload(stub: &[u8], section_body: &[u8]) -> Result<Vec<u8>, String> {
  match stub.first().copied() {
    Some(0xcf) if stub.get(0..4) == Some(&MH_MAGIC_64.to_le_bytes()) => {
      inject_macho(stub, section_body)
    }
    Some(0x7f) if stub.get(0..4) == Some(b"\x7fELF") => inject_elf(stub, section_body),
    Some(0x4d) if stub.get(0..2) == Some(b"MZ") => inject_pe(stub, section_body),
    _ => Err("unrecognized stub format: not a 64-bit LE Mach-O, ELF, or PE".to_string()),
  }
}

/// Mach-O: splice a READ-only `SMOL/__NAPI_PAYLOAD` `LC_SEGMENT_64`. Returns the modified
/// bytes (still unsigned — caller re-signs).
fn inject_macho(stub: &[u8], section_body: &[u8]) -> Result<Vec<u8>, String> {
  let layout = read_layout(stub)?;

  // 1. Slack guard: the new 152-byte LC must fit between END_OF_LC and the first
  //    mapped section. The stub is linked with -headerpad,0x1000 to guarantee it.
  let slack = layout.first_section_offset as usize - layout.end_of_lc;
  if slack < NEW_LC_SIZE {
    return Err(format!(
      "header slack {slack} < {NEW_LC_SIZE} bytes for the new segment command; \
       rebuild the stub with -headerpad,0x1000"
    ));
  }

  let body_len = section_body.len() as u64;
  let delta = round_up(body_len, layout.page_size);
  let new_fileoff = layout.linkedit_fileoff;
  let new_vmaddr = layout.linkedit_vmaddr;
  let linkedit_start = layout.linkedit_fileoff as usize;
  // Exclude the old signature bytes — they trail __LINKEDIT and the signer
  // regenerates them. Without a signature, __LINKEDIT runs to EOF.
  let linkedit_end = match &layout.code_sig {
    Some(sig) => sig.dataoff as usize,
    None => stub.len(),
  };
  if linkedit_end < linkedit_start {
    return Err("code signature precedes __LINKEDIT (corrupt layout)".to_string());
  }

  // 2. Assemble the new file so NOTHING before __LINKEDIT moves its file offset.
  //    The new 152-byte LC is written into the header slack: the load-command
  //    bytes [linkedit_lc_off, END_OF_LC) shift forward by 152, consuming 152 of
  //    the headerpad gap; the first mapped section and every byte up to
  //    __LINKEDIT keep their original file offset. __LINKEDIT's body then slides
  //    down by DELTA only (the page-rounded section content occupies the old
  //    __LINKEDIT file region).
  //
  //    [0, linkedit_lc_off)              header + LCs before __LINKEDIT's LC
  //    new_lc (152)                      the SMOL/__NAPI_PAYLOAD segment command
  //    [linkedit_lc_off, END_OF_LC)      __LINKEDIT's LC + the LCs after it
  //    [END_OF_LC+152, linkedit_start)   remaining headerpad + all mapped bytes
  //    section_body + zero-pad to DELTA  the injected section content
  //    [linkedit_start, linkedit_end)    __LINKEDIT body (sans old signature)
  let new_lc = build_segment_lc(body_len, delta, new_fileoff, new_vmaddr);
  let mut out: Vec<u8> = Vec::with_capacity(stub.len() + delta as usize);
  out.extend_from_slice(&stub[..layout.linkedit_lc_off]);
  out.extend_from_slice(&new_lc);
  out.extend_from_slice(&stub[layout.linkedit_lc_off..layout.end_of_lc]);
  // Headerpad after the (now-larger) command stream, shrunk by the 152 bytes the
  // new LC consumed, so the first mapped section stays at its original offset.
  out.extend_from_slice(&stub[layout.end_of_lc + NEW_LC_SIZE..linkedit_start]);
  out.extend_from_slice(section_body);
  out.resize(out.len() + (delta - body_len) as usize, 0);
  out.extend_from_slice(&stub[linkedit_start..linkedit_end]);

  // 3. Header: ncmds += 1, sizeofcmds += NEW_LC. (The strip below nets these back
  //    down by the code-signature command.)
  let ncmds = u32_le(&out, 16)?;
  put_u32(&mut out, 16, ncmds + 1);
  let sizeofcmds = u32_le(&out, 20)?;
  put_u32(&mut out, 20, sizeofcmds + NEW_LC_SIZE as u32);

  // 4. Shift __LINKEDIT's own fileoff + vmaddr by DELTA (its LC now sits at
  //    linkedit_lc_off + NEW_LC, after the new segment command). When the old
  //    signature was excluded, shrink filesize/vmsize to the bytes that remain on
  //    disk (up to where the signature began) — else the segment claims more than
  //    the file holds and the signer's parser rejects it; the signer re-extends.
  let le_lc = layout.linkedit_lc_off + NEW_LC_SIZE;
  let le_fileoff = u64_le(&out, le_lc + 40)?;
  put_u64(&mut out, le_lc + 40, le_fileoff + delta);
  let le_vmaddr = u64_le(&out, le_lc + 24)?;
  put_u64(&mut out, le_lc + 24, le_vmaddr + delta);
  if let Some(sig) = &layout.code_sig {
    let remaining = sig.dataoff - layout.linkedit_fileoff;
    put_u64(&mut out, le_lc + 48, remaining); // filesize
    put_u64(&mut out, le_lc + 32, round_up(remaining, layout.page_size)); // vmsize
  }

  // 5. Bump every linkedit-pointing file offset by DELTA. A field whose command
  //    sits at/after __LINKEDIT's LC had its byte position shifted +NEW_LC when the
  //    new LC was written before __LINKEDIT; a field before it keeps its position.
  //    Skip zeros (an absent table).
  for field in &layout.linkedit_pointers {
    let at = if field.at >= layout.linkedit_lc_off {
      field.at + NEW_LC_SIZE
    } else {
      field.at
    };
    let current = u32_le(&out, at)?;
    if current != 0 {
      put_u32(&mut out, at, current + delta as u32);
    }
  }

  // 6. Strip LC_CODE_SIGNATURE in place (it is the LAST command, so zeroing its
  //    bytes + decrementing the header counts removes it WITHOUT shifting any file
  //    offset — a splice here would move __LINKEDIT and re-break step 5). Its
  //    trailing __LINKEDIT bytes were already excluded in step 2; the signer
  //    re-adds a correct command into the freed command-stream slack.
  if let Some(sig) = &layout.code_sig {
    let sig_lc = sig.lc_off + NEW_LC_SIZE;
    let sig_cmdsize = u32_le(&out, sig_lc + 4)? as usize;
    let ncmds = u32_le(&out, 16)?;
    put_u32(&mut out, 16, ncmds - 1);
    let sizeofcmds = u32_le(&out, 20)?;
    put_u32(&mut out, 20, sizeofcmds - sig_cmdsize as u32);
    for b in out.iter_mut().skip(sig_lc).take(sig_cmdsize) {
      *b = 0;
    }
  }

  Ok(out)
}

fn u16_le(bytes: &[u8], off: usize) -> Result<u16, String> {
  bytes
    .get(off..off + 2)
    .and_then(|s| s.try_into().ok())
    .map(u16::from_le_bytes)
    .ok_or_else(|| format!("truncated u16 at offset {off}"))
}

fn put_u16(bytes: &mut [u8], off: usize, value: u16) {
  bytes[off..off + 2].copy_from_slice(&value.to_le_bytes());
}

fn align_up(value: usize, align: usize) -> usize {
  if align == 0 {
    return value;
  }
  value.div_ceil(align) * align
}

/// ELF: add a non-alloc `SHT_PROGBITS` section named `.NAPI_PAYLOAD`. The loader maps
/// from PROGRAM headers and ignores the section table, so this is pure append + a
/// repointed `e_shoff` — nothing the loader maps moves. New section data, a grown
/// `.shstrtab` (old strings + the name), and a fresh section-header table are all
/// appended at EOF; the `.shstrtab` header is repointed and one entry added.
/// No signing — no ELF loader enforces a code signature on `dlopen`.
fn inject_elf(stub: &[u8], body: &[u8]) -> Result<Vec<u8>, String> {
  if stub.get(4).copied() != Some(2) {
    return Err("only 64-bit ELF is supported (32-bit producer is a follow-up)".to_string());
  }
  if stub.get(5).copied() != Some(1) {
    return Err("only little-endian ELF is supported".to_string());
  }
  let shentsize = u16_le(stub, 58)? as usize;
  if shentsize != 64 {
    return Err(format!(
      "unexpected ELF64 e_shentsize {shentsize} (want 64)"
    ));
  }
  let shoff = u64_le(stub, 40)? as usize;
  let shnum = u16_le(stub, 60)? as usize;
  let shstrndx = u16_le(stub, 62)? as usize;
  if shnum == 0 || shstrndx >= shnum {
    return Err("ELF has no usable section header table".to_string());
  }
  let old_sht = stub
    .get(shoff..shoff + shnum * 64)
    .ok_or("section header table out of range")?
    .to_vec();
  // The existing .shstrtab (named by e_shstrndx).
  let str_hdr = shoff + shstrndx * 64;
  let strtab_off = u64_le(stub, str_hdr + 24)? as usize;
  let strtab_size = u64_le(stub, str_hdr + 32)? as usize;
  let old_strtab = stub
    .get(strtab_off..strtab_off + strtab_size)
    .ok_or(".shstrtab out of range")?
    .to_vec();

  let mut out = stub.to_vec();
  // Section data.
  let data_off = align_up(out.len(), 8);
  out.resize(data_off, 0);
  out.extend_from_slice(body);
  // Grown .shstrtab = old strings + ".NAPI_PAYLOAD\0"; the new name sits at the old size.
  let name_off = strtab_size;
  let shstr_off = align_up(out.len(), 8);
  out.resize(shstr_off, 0);
  out.extend_from_slice(&old_strtab);
  out.extend_from_slice(b".NAPI_PAYLOAD\0");
  let new_strtab_size = strtab_size + b".NAPI_PAYLOAD\0".len();
  // Fresh section-header table: the old entries (with .shstrtab repointed) + one new.
  let new_shoff = align_up(out.len(), 8);
  out.resize(new_shoff, 0);
  out.extend_from_slice(&old_sht);
  put_u64(&mut out, new_shoff + shstrndx * 64 + 24, shstr_off as u64); // .shstrtab sh_offset
  put_u64(
    &mut out,
    new_shoff + shstrndx * 64 + 32,
    new_strtab_size as u64,
  ); // sh_size
  let mut entry = vec![0u8; 64];
  put_u32(&mut entry, 0, name_off as u32); // sh_name
  put_u32(&mut entry, 4, 1); // sh_type = SHT_PROGBITS
  put_u64(&mut entry, 24, data_off as u64); // sh_offset
  put_u64(&mut entry, 32, body.len() as u64); // sh_size
  put_u64(&mut entry, 48, 1); // sh_addralign
  out.extend_from_slice(&entry);
  // Repoint the header at the new table; one more section.
  put_u64(&mut out, 40, new_shoff as u64);
  put_u16(&mut out, 60, (shnum + 1) as u16);
  Ok(out)
}

/// PE: add a `.NAPI` section — a 40-byte header into the header slack + raw data
/// at EOF. No signing (napi PE addons are unsigned; the loader enforces none on
/// load). Reader uses VirtualSize for the true (unpadded) length.
fn inject_pe(stub: &[u8], body: &[u8]) -> Result<Vec<u8>, String> {
  let pe_off = u32_le(stub, 0x3c)? as usize;
  if stub.get(pe_off..pe_off + 4) != Some(b"PE\0\0") {
    return Err("not a PE (bad NT signature)".to_string());
  }
  let coff = pe_off + 4;
  let num_sections = u16_le(stub, coff + 2)? as usize;
  let opt_size = u16_le(stub, coff + 16)? as usize;
  let opt_off = coff + 20;
  // SectionAlignment@32, FileAlignment@36, SizeOfImage@56, SizeOfHeaders@60 — same
  // offsets in PE32 and PE32+ (they sit past the ImageBase divergence).
  let section_align = u32_le(stub, opt_off + 32)? as usize;
  let file_align = u32_le(stub, opt_off + 36)? as usize;
  if section_align == 0 || file_align == 0 {
    return Err("zero PE Section/FileAlignment".to_string());
  }
  let size_of_headers = u32_le(stub, opt_off + 60)? as usize;
  let sect_table = opt_off + opt_size;
  let new_hdr = sect_table + num_sections * 40;
  if new_hdr + 40 > size_of_headers {
    return Err(
      "no PE header slack for a new section header (needs SizeOfHeaders room)".to_string(),
    );
  }
  // Next free RVA, after the highest existing section.
  let mut max_va_end = 0usize;
  for i in 0..num_sections {
    let sh = sect_table + i * 40;
    let va = u32_le(stub, sh + 12)? as usize;
    let vsize = u32_le(stub, sh + 8)? as usize;
    max_va_end = max_va_end.max(va + vsize);
  }
  let new_va = align_up(max_va_end, section_align);
  let raw_size = align_up(body.len(), file_align);

  let mut out = stub.to_vec();
  let raw_ptr = align_up(out.len(), file_align);
  out.resize(raw_ptr, 0);
  out.extend_from_slice(body);
  out.resize(raw_ptr + raw_size, 0); // pad raw data to FileAlignment

  out[new_hdr..new_hdr + 8].copy_from_slice(b".NAPI\0\0\0"); // 8-byte PE name
  put_u32(&mut out, new_hdr + 8, body.len() as u32); // VirtualSize (true length)
  put_u32(&mut out, new_hdr + 12, new_va as u32); // VirtualAddress
  put_u32(&mut out, new_hdr + 16, raw_size as u32); // SizeOfRawData
  put_u32(&mut out, new_hdr + 20, raw_ptr as u32); // PointerToRawData
  put_u32(&mut out, new_hdr + 36, 0x4000_0040); // IMAGE_SCN_CNT_INITIALIZED_DATA | MEM_READ
  put_u16(&mut out, coff + 2, (num_sections + 1) as u16); // NumberOfSections
  let size_of_image = align_up(new_va + body.len(), section_align);
  put_u32(&mut out, opt_off + 56, size_of_image as u32); // SizeOfImage
  Ok(out)
}

/// Ad-hoc re-sign the injected Mach-O so the new section is signature-covered.
/// `identifier` is stamped only when the binary carries none. ELF/PE pass through —
/// their loaders enforce no signature, so the injected bytes load as-is.
#[cfg(target_os = "macos")]
pub fn resign(injected: &[u8], identifier: &str) -> Result<Vec<u8>, String> {
  if injected.get(0..4) != Some(&MH_MAGIC_64.to_le_bytes()) {
    return Ok(injected.to_vec());
  }
  resign_macho(injected, identifier)
}

#[cfg(target_os = "macos")]
fn resign_macho(injected: &[u8], identifier: &str) -> Result<Vec<u8>, String> {
  use apple_codesign::{MachOSigner, SettingsScope, SigningSettings};

  let mut settings = SigningSettings::default();
  settings
    .import_settings_from_macho(injected)
    .map_err(|e| format!("import_settings_from_macho: {e}"))?;
  if settings.binary_identifier(SettingsScope::Main).is_none() {
    settings.set_binary_identifier(SettingsScope::Main, identifier);
  }
  // No signing key set → ad-hoc signature (exactly what `codesign -s -` produces).
  let signer = MachOSigner::new(injected).map_err(|e| format!("MachOSigner::new: {e}"))?;
  let mut out: Vec<u8> = Vec::with_capacity(injected.len() + 0x4000);
  signer
    .write_signed_binary(&settings, &mut out)
    .map_err(|e| format!("write_signed_binary: {e}"))?;
  Ok(out)
}

/// Non-macOS hosts: ELF/PE need no signature, so the injected bytes load as-is. A
/// Mach-O here means a darwin target is being cross-built on a non-mac host, which
/// needs an ad-hoc signature this host can't produce (apple-codesign is gated to a
/// macOS host) — fail rather than emit an unsigned `.node`.
#[cfg(not(target_os = "macos"))]
pub fn resign(injected: &[u8], identifier: &str) -> Result<Vec<u8>, String> {
  let _ = identifier;
  if injected.get(0..4) == Some(&MH_MAGIC_64.to_le_bytes()) {
    return Err(
      "cross-building a darwin target needs an ad-hoc Mach-O signature, which this \
       non-macOS host cannot produce; build darwin addons on a macOS host"
        .to_string(),
    );
  }
  Ok(injected.to_vec())
}

#[cfg(test)]
mod tests {
  use super::*;

  // A minimal valid ELF64 LE: header + ".shstrtab" + a 2-entry section table
  // (NULL, .shstrtab) — enough for inject_elf to grow.
  fn minimal_elf64() -> Vec<u8> {
    let shstr: &[u8] = b"\0.shstrtab\0"; // ".shstrtab" at name offset 1
    let shoff = 80usize;
    let mut e = vec![0u8; shoff + 2 * 64];
    e[0..4].copy_from_slice(b"\x7fELF");
    e[4] = 2; // 64-bit
    e[5] = 1; // little-endian
    e[6] = 1; // version
    put_u64(&mut e, 40, shoff as u64); // e_shoff
    put_u16(&mut e, 58, 64); // e_shentsize
    put_u16(&mut e, 60, 2); // e_shnum
    put_u16(&mut e, 62, 1); // e_shstrndx
    e[64..64 + shstr.len()].copy_from_slice(shstr);
    let sh1 = shoff + 64; // section header [1] = .shstrtab
    put_u32(&mut e, sh1, 1); // sh_name -> ".shstrtab"
    put_u32(&mut e, sh1 + 4, 3); // sh_type = SHT_STRTAB
    put_u64(&mut e, sh1 + 24, 64); // sh_offset
    put_u64(&mut e, sh1 + 32, shstr.len() as u64); // sh_size
    e
  }

  fn elf_find_section(f: &[u8], want: &str) -> Option<Vec<u8>> {
    let shoff = u64_le(f, 40).ok()? as usize;
    let shentsize = u16_le(f, 58).ok()? as usize;
    let shnum = u16_le(f, 60).ok()? as usize;
    let shstrndx = u16_le(f, 62).ok()? as usize;
    let strh = shoff + shstrndx * shentsize;
    let so = u64_le(f, strh + 24).ok()? as usize;
    let ss = u64_le(f, strh + 32).ok()? as usize;
    let strtab = f.get(so..so + ss)?;
    for i in 0..shnum {
      let sh = shoff + i * shentsize;
      let nm = u32_le(f, sh).ok()? as usize;
      let end = strtab.get(nm..)?.iter().position(|&b| b == 0)? + nm;
      if &strtab[nm..end] == want.as_bytes() {
        let off = u64_le(f, sh + 24).ok()? as usize;
        let sz = u64_le(f, sh + 32).ok()? as usize;
        return Some(f.get(off..off + sz)?.to_vec());
      }
    }
    None
  }

  // A minimal PE32+ with one section and header slack for a second header.
  fn minimal_pe() -> Vec<u8> {
    let pe = 0x40usize;
    let coff = pe + 4;
    let opt_off = coff + 20;
    let opt_size = 0x70usize;
    let sect_table = opt_off + opt_size;
    let size_of_headers = 0x200usize;
    let mut p = vec![0u8; size_of_headers];
    p[0..2].copy_from_slice(b"MZ");
    put_u32(&mut p, 0x3c, pe as u32);
    p[pe..pe + 4].copy_from_slice(b"PE\0\0");
    put_u16(&mut p, coff + 2, 1); // NumberOfSections
    put_u16(&mut p, coff + 16, opt_size as u16); // SizeOfOptionalHeader
    put_u16(&mut p, opt_off, 0x20b); // PE32+ magic
    put_u32(&mut p, opt_off + 32, 0x1000); // SectionAlignment
    put_u32(&mut p, opt_off + 36, 0x200); // FileAlignment
    put_u32(&mut p, opt_off + 56, 0x1000); // SizeOfImage
    put_u32(&mut p, opt_off + 60, size_of_headers as u32); // SizeOfHeaders
    p[sect_table..sect_table + 5].copy_from_slice(b".text");
    put_u32(&mut p, sect_table + 8, 0x10); // VirtualSize
    put_u32(&mut p, sect_table + 12, 0x1000); // VirtualAddress
    put_u32(&mut p, sect_table + 16, 0x200); // SizeOfRawData
    put_u32(&mut p, sect_table + 20, 0x200); // PointerToRawData
    p
  }

  fn minimal_macho64() -> Vec<u8> {
    let text_lc = 32;
    let linkedit_lc = text_lc + 152;
    let mut image = vec![0u8; 0x1200];
    put_u32(&mut image, 0, MH_MAGIC_64);
    put_u32(&mut image, 4, 0x0100_0007); // x86_64
    put_u32(&mut image, 16, 2); // ncmds
    put_u32(&mut image, 20, (152 + 72) as u32); // sizeofcmds

    put_u32(&mut image, text_lc, LC_SEGMENT_64);
    put_u32(&mut image, text_lc + 4, 152);
    image[text_lc + 8..text_lc + 14].copy_from_slice(b"__TEXT");
    put_u64(&mut image, text_lc + 32, 0x1000); // vmsize
    put_u64(&mut image, text_lc + 48, 0x1000); // filesize
    put_u32(&mut image, text_lc + 64, 1); // nsects
    let text_section = text_lc + 72;
    image[text_section..text_section + 6].copy_from_slice(b"__text");
    image[text_section + 16..text_section + 22].copy_from_slice(b"__TEXT");
    put_u64(&mut image, text_section + 40, 16);
    put_u32(&mut image, text_section + 48, 0x1000);

    put_u32(&mut image, linkedit_lc, LC_SEGMENT_64);
    put_u32(&mut image, linkedit_lc + 4, 72);
    image[linkedit_lc + 8..linkedit_lc + 18].copy_from_slice(b"__LINKEDIT");
    put_u64(&mut image, linkedit_lc + 24, 0x20_0000); // vmaddr
    put_u64(&mut image, linkedit_lc + 32, 0x1000); // vmsize
    put_u64(&mut image, linkedit_lc + 40, 0x1000); // fileoff
    put_u64(&mut image, linkedit_lc + 48, 0x200); // filesize
    image
  }

  fn pe_find_section(f: &[u8], want: &str) -> Option<Vec<u8>> {
    let pe = u32_le(f, 0x3c).ok()? as usize;
    let coff = pe + 4;
    let nsec = u16_le(f, coff + 2).ok()? as usize;
    let optsz = u16_le(f, coff + 16).ok()? as usize;
    let st = coff + 20 + optsz;
    for i in 0..nsec {
      let sh = st + i * 40;
      let name = f.get(sh..sh + 8)?;
      if name_eq(name, want.as_bytes()) {
        let vs = u32_le(f, sh + 8).ok()? as usize;
        let rs = u32_le(f, sh + 16).ok()? as usize;
        let rp = u32_le(f, sh + 20).ok()? as usize;
        return Some(f.get(rp..rp + vs.min(rs))?.to_vec());
      }
    }
    None
  }

  #[test]
  fn elf_injection_round_trips_and_preserves_existing_sections() {
    let body = b"NAPCSECT-elf-section-body-bytes".to_vec();
    let out = inject_elf(&minimal_elf64(), &body).expect("inject");
    assert_eq!(elf_find_section(&out, ".NAPI_PAYLOAD"), Some(body));
    assert!(
      elf_find_section(&out, ".shstrtab").is_some(),
      "old section intact"
    );
  }

  #[test]
  fn macho_injection_adds_payload_and_shifts_linkedit() {
    let body = b"NAPCSECT-macho-section-body";
    let out = inject_macho(&minimal_macho64(), body).expect("inject");
    let payload_lc = 32 + 152;
    assert_eq!(u32_le(&out, 16).unwrap(), 3);
    assert_eq!(u32_le(&out, payload_lc).unwrap(), LC_SEGMENT_64);
    assert_eq!(&out[payload_lc + 8..payload_lc + 12], b"SMOL");
    let section = payload_lc + SEGMENT_COMMAND_64_SIZE;
    assert_eq!(&out[section..section + 16], b"__NAPI_PAYLOAD\0\0");
    let payload_offset = u32_le(&out, section + 48).unwrap() as usize;
    let payload_size = u64_le(&out, section + 40).unwrap() as usize;
    assert_eq!(&out[payload_offset..payload_offset + payload_size], body);

    let linkedit_lc = payload_lc + NEW_LC_SIZE;
    assert_eq!(u64_le(&out, linkedit_lc + 40).unwrap(), 0x2000);
    assert_eq!(&out[0x2000..0x2200], &minimal_macho64()[0x1000..0x1200]);
  }

  #[test]
  fn pe_injection_round_trips_via_virtual_size() {
    let body = b"NAPCSECT-pe-section-body".to_vec();
    let out = inject_pe(&minimal_pe(), &body).expect("inject");
    // SizeOfRawData is FileAlignment-padded; the reader uses VirtualSize, so the
    // retrieved bytes are exactly the body — no trailing zero-fill.
    assert_eq!(pe_find_section(&out, ".NAPI"), Some(body));
  }

  #[test]
  fn dispatch_rejects_unknown_format() {
    assert!(inject_payload(b"not an object file", b"x").is_err());
  }
}
