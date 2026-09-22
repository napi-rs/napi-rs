// SPDX-License-Identifier: 0BSD
//
// ohos-selfsign.ts — lightweight OpenHarmony binary self-signing tool.
//
// 1:1 port of `selfsign.js` from https://github.com/hqzing/ohos-selfsign,
// which reimplements the `binary-sign-tool` self-sign algorithm shipped in
// the OpenHarmony SDK: it injects a 4 KiB `.codesign` section into an ELF64
// binary holding an fs-verity descriptor plus a SHA-256 signature.
//
// Usage (as a library):
//   signFileAtomic(path, force?)   — sign an ELF file in place, atomically
//   signElf(buffer, force?)        — sign an ELF buffer, returns signed bytes
//   stripCodesign(buffer)          — remove the `.codesign` section
//   checkSelfsign(buffer)          — read-only validation of a self-signature
//   selfsignMain(argv)             — standalone entry:
//     `selfsignMain(['--force', 'in.so'])`, `--strip`, `--check`

import { createHash } from 'node:crypto'
import {
  chmodSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

import { debugFactory } from './log.js'

const debug = debugFactory('ohos-selfsign')

const DESC_SIZE = 256
const PAGE_SIZE = 4096
const FLAG_SELF_SIGN = 0x10
const FS_VERITY_DESCRIPTOR_TYPE = 1
const HASH_OUT = 32 // SHA-256 output size in bytes

// ELF64 header field offsets
const E_SHOFF = 0x28
const E_SHENTSIZE = 0x3a
const E_SHNUM = 0x3c
const E_SHSTRNDX = 0x3e

const CODESIGN_NAME = Buffer.from('.codesign\0', 'latin1') // trailing NUL included, 10 bytes

// ─────────────────────── byte read/write helpers ───────────────────────
// Note: all offsets and 64-bit values use JS Numbers (safe integers up to
// 2^53), matching the type Node Buffer offset parameters require, and far
// beyond any real ELF file size.
function sha256(b: Buffer): Buffer {
  return createHash('sha256').update(b).digest()
}

function readU16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off)
}

function readU32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off)
}

function readU64(buf: Buffer, off: number): number {
  const lo = buf.readUInt32LE(off)
  const hi = buf.readUInt32LE(off + 4)
  return hi * 0x100000000 + lo
}

function writeU16(buf: Buffer, off: number, v: number): void {
  buf.writeUInt16LE(v, off)
}

function writeU32(buf: Buffer, off: number, v: number): void {
  buf.writeUInt32LE(v >>> 0, off)
}

function writeU64(buf: Buffer, off: number, v: number): void {
  const lo = v >>> 0
  const hi = Math.floor(v / 0x100000000)
  buf.writeUInt32LE(lo, off)
  buf.writeUInt32LE(hi, off + 4)
}

function alignUp(v: number, a: number): number {
  return Math.ceil(v / a) * a
}

// ─────────────────── ELF pre-clean / normalize (not required for signing) ───────────────────
export interface ElfHeader {
  e_shoff: number
  e_shentsize: number
  e_shnum: number
  e_shstrndx: number
}

export function parseElfHeader(elf: Buffer): ElfHeader {
  // Validate and parse the ELF64 header (read-only pre-check).
  // ELF64 allows section entries larger than 64 bytes (carrying extended
  // fields), so only entries smaller than 64 are rejected; the actual entry
  // size is returned and every SHT walk/bounds check below strides by it.
  if (
    elf.length < 64 ||
    elf[0] !== 0x7f ||
    elf[1] !== 0x45 ||
    elf[2] !== 0x4c ||
    elf[3] !== 0x46 ||
    elf[4] !== 2
  ) {
    throw new Error('not ELF64')
  }
  const e_shoff = readU64(elf, E_SHOFF)
  const e_shentsize = readU16(elf, E_SHENTSIZE)
  const e_shnum = readU16(elf, E_SHNUM)
  const e_shstrndx = readU16(elf, E_SHSTRNDX)
  if (
    e_shentsize < 64 ||
    e_shoff === 0 ||
    e_shnum === 0 ||
    e_shstrndx >= e_shnum
  ) {
    throw new Error('ELF has no usable section header table')
  }
  if (
    e_shoff > elf.length ||
    e_shnum > Math.floor((elf.length - e_shoff) / e_shentsize)
  ) {
    throw new Error('section header table out of bounds')
  }
  return { e_shoff, e_shentsize, e_shnum, e_shstrndx }
}

export function findSectionByName(
  elf: Buffer,
  e_shoff: number,
  e_shentsize: number,
  e_shnum: number,
  e_shstrndx: number,
  name: Buffer,
): number {
  // Look up a section by name in the SHT (read-only pre-check); entries are
  // strided by the actual e_shentsize.
  // Returns the section entry offset, or -1 when not found.
  const name_len = name.length
  const shstr_e = e_shoff + e_shstrndx * e_shentsize
  const shstr_off = readU64(elf, shstr_e + 24)
  const shstr_sz = readU64(elf, shstr_e + 32)
  if (shstr_off > elf.length || shstr_sz > elf.length - shstr_off) {
    return -1
  }
  for (let i = 0; i < e_shnum; i++) {
    const e = e_shoff + i * e_shentsize
    const name_off = readU32(elf, e)
    if (name_off + name_len <= shstr_sz) {
      const start = shstr_off + name_off
      if (elf.subarray(start, start + name_len).equals(name)) {
        return e
      }
    }
  }
  return -1
}

export function hasCodesignSection(elf: Buffer): boolean {
  try {
    const { e_shoff, e_shentsize, e_shnum, e_shstrndx } = parseElfHeader(elf)
    return (
      findSectionByName(
        elf,
        e_shoff,
        e_shentsize,
        e_shnum,
        e_shstrndx,
        CODESIGN_NAME,
      ) >= 0
    )
  } catch {
    return false
  }
}

function newShstrndx(old_shstrndx: number, cs_idx: number): number {
  return cs_idx < old_shstrndx ? old_shstrndx - 1 : old_shstrndx
}

export function stripCodesign(buf: Buffer): {
  removed: boolean
  out: Buffer
} {
  // Strip the .codesign section.
  const elf = Buffer.from(buf)
  const { e_shoff, e_shentsize, e_shnum, e_shstrndx } = parseElfHeader(elf)

  const cs_entry_off = findSectionByName(
    elf,
    e_shoff,
    e_shentsize,
    e_shnum,
    e_shstrndx,
    CODESIGN_NAME,
  )
  if (cs_entry_off < 0) {
    return { removed: false, out: elf }
  }
  const cs_idx = (cs_entry_off - e_shoff) / e_shentsize

  const shstr_e = e_shoff + e_shstrndx * e_shentsize
  const shstr_off = readU64(elf, shstr_e + 24)
  const shstr_sz = readU64(elf, shstr_e + 32)
  if (shstr_off > elf.length || shstr_sz > elf.length - shstr_off) {
    throw new Error('shstrtab out of bounds')
  }

  // 2. new shstrtab = old shstrtab with ".codesign\0" removed
  const cs_name_off = readU32(elf, cs_entry_off)
  const cs_name_len = CODESIGN_NAME.length // 10, NUL included
  const newShstr = Buffer.from(elf.subarray(shstr_off, shstr_off + shstr_sz))
  let newShstrSz = newShstr.length
  if (cs_name_off + cs_name_len <= newShstr.length) {
    newShstr.copyWithin(cs_name_off, cs_name_off + cs_name_len)
    newShstrSz = newShstr.length - cs_name_len
  }
  const newShstrTrimmed = newShstr.subarray(0, newShstrSz)

  // 3. new SHT = old SHT without the cs_idx entry (entries are not
  //    compacted to 64B; the original e_shentsize is preserved)
  const newShnum = e_shnum - 1
  const newSht = Buffer.alloc(newShnum * e_shentsize)
  let dst = 0
  for (let i = 0; i < e_shnum; i++) {
    if (i === cs_idx) continue
    const e = e_shoff + i * e_shentsize
    elf.copy(newSht, dst, e, e + e_shentsize)
    dst += e_shentsize
  }

  // 4. truncate at the .codesign section file offset, then append
  //    new shstrtab / 8-byte-aligned new SHT in order
  const cs_sec_off = readU64(elf, cs_entry_off + 24)
  const keep_len = Math.min(cs_sec_off, elf.length)
  const new_shstr_off = keep_len
  const new_sht_off = alignUp(new_shstr_off + newShstrSz, 8)
  const new_total = new_sht_off + newShnum * e_shentsize

  const out = Buffer.alloc(new_total)
  elf.copy(out, 0, 0, keep_len)
  newShstrTrimmed.copy(out, new_shstr_off)
  newSht.copy(out, new_sht_off)

  // 5. rewrite the shstrtab entry
  const shstr_entry_off_in_new = newShstrndx(e_shstrndx, cs_idx) * e_shentsize
  writeU64(out, new_sht_off + shstr_entry_off_in_new + 24, new_shstr_off)
  writeU64(out, new_sht_off + shstr_entry_off_in_new + 32, newShstrSz)

  // 6. shift every sh_name > cs_name_off back by cs_name_len
  for (let i = 0; i < newShnum; i++) {
    const e = new_sht_off + i * e_shentsize
    const noff = readU32(out, e)
    if (noff > cs_name_off) writeU32(out, e, noff - cs_name_len)
  }

  // 7. update the header
  writeU64(out, E_SHOFF, new_sht_off)
  writeU16(out, E_SHNUM, newShnum)
  if (cs_idx < e_shstrndx) writeU16(out, E_SHSTRNDX, e_shstrndx - 1)

  return { removed: true, out }
}

// ─────────────────── algorithm core required for signing ───────────────────
export function injectCodesignSection(elf: Buffer): {
  out: Buffer
  cs_off: number
} {
  // Inject a 4 KiB placeholder .codesign section.
  const { e_shoff, e_shentsize, e_shnum, e_shstrndx } = parseElfHeader(elf)

  const shstr_e = e_shoff + e_shstrndx * e_shentsize
  const shstr_off = readU64(elf, shstr_e + 24)
  const shstr_sz = readU64(elf, shstr_e + 32)
  if (shstr_off > elf.length || shstr_sz > elf.length - shstr_off) {
    throw new Error('shstrtab out of bounds')
  }

  // 1. cur_end: max of the SHT end, every section's off+sz
  //    (SHT_NOBITS=8 occupies no file space), and the file length itself
  //    (extra data may trail the section header table)
  let cur_end = e_shoff + e_shnum * e_shentsize
  for (let i = 0; i < e_shnum; i++) {
    const e = e_shoff + i * e_shentsize
    const sh_type = readU32(elf, e + 4)
    const off = readU64(elf, e + 24)
    const sz = sh_type === 8 ? 0 : readU64(elf, e + 32)
    if (off + sz > cur_end) cur_end = off + sz
  }
  if (elf.length > cur_end) cur_end = elf.length
  const cs_off = alignUp(cur_end, PAGE_SIZE)

  // 2. new shstrtab = old + ".codesign\0"
  const newShstr = Buffer.concat([
    elf.subarray(shstr_off, shstr_off + shstr_sz),
    CODESIGN_NAME,
  ])
  const new_shstr_sz = newShstr.length
  const cs_shname = shstr_sz // offset of .codesign inside the new shstrtab

  // 3. new layout
  const new_shstr_off = cs_off + PAGE_SIZE
  const new_sht_off = alignUp(new_shstr_off + new_shstr_sz, 8)
  const new_shnum = e_shnum + 1
  const new_total = new_sht_off + new_shnum * e_shentsize

  const buf = Buffer.alloc(new_total)
  // 4. copy original content: only up to cs_off
  const copy_len = Math.min(elf.length, new_total, cs_off)
  elf.copy(buf, 0, 0, copy_len)

  newShstr.copy(buf, new_shstr_off)
  elf.copy(buf, new_sht_off, e_shoff, e_shoff + e_shnum * e_shentsize)

  // .codesign section entry (first 64B are the standard fields; any
  // extension beyond 64B stays zero)
  const cs_e = new_sht_off + e_shnum * e_shentsize
  writeU32(buf, cs_e + 0, cs_shname) // sh_name
  writeU32(buf, cs_e + 4, 1) // sh_type = SHT_PROGBITS
  writeU64(buf, cs_e + 24, cs_off) // sh_offset
  writeU64(buf, cs_e + 32, PAGE_SIZE) // sh_size
  writeU64(buf, cs_e + 48, PAGE_SIZE) // sh_addralign

  // update shstrtab entry offset/size
  const shstr_e_new = new_sht_off + e_shstrndx * e_shentsize
  writeU64(buf, shstr_e_new + 24, new_shstr_off)
  writeU64(buf, shstr_e_new + 32, new_shstr_sz)

  // update header: e_shoff / e_shnum; e_shstrndx unchanged
  writeU64(buf, E_SHOFF, new_sht_off)
  writeU16(buf, E_SHNUM, new_shnum)

  return { out: buf, cs_off }
}

export function merkleRootHash(
  data: Buffer,
  cs_off: number,
  cs_len: number,
): { root: Buffer; mid: Buffer } {
  // fs-verity Merkle tree root hash + intermediate-level hashes.
  // `mid` holds every level between the leaf level and the level containing
  // the root, concatenated bottom-up as raw 32B hashes (absent when the leaf
  // level fits in 4096B); it is written after the payload inside .codesign.
  if (data.length === 0) {
    return { root: sha256(Buffer.alloc(PAGE_SIZE)), mid: Buffer.alloc(0) }
  }

  const npages = Math.ceil(data.length / PAGE_SIZE)
  const cs_page_begin = Math.floor(cs_off / PAGE_SIZE)
  const cs_page_end = Math.ceil((cs_off + cs_len) / PAGE_SIZE)

  const hashes: Buffer[] = []
  for (let i = 0; i < npages; i++) {
    if (cs_len > 0 && cs_page_begin <= i && i < cs_page_end) {
      hashes.push(Buffer.alloc(HASH_OUT)) // pages under the section: zero leaf hash
      continue
    }
    let page = data.subarray(i * PAGE_SIZE, (i + 1) * PAGE_SIZE)
    if (page.length < PAGE_SIZE) {
      page = Buffer.concat([page, Buffer.alloc(PAGE_SIZE - page.length)])
    }
    hashes.push(sha256(page))
  }

  if (npages === 1) {
    return { root: Buffer.from(hashes[0]), mid: Buffer.alloc(0) }
  }

  let cur = Buffer.concat(hashes)
  const mid: Buffer[] = [] // intermediate levels below the root level, bottom-up
  while (cur.length > PAGE_SIZE) {
    const nxt: Buffer[] = []
    for (let i = 0; i < cur.length; i += PAGE_SIZE) {
      let page = cur.subarray(i, i + PAGE_SIZE)
      if (page.length < PAGE_SIZE) {
        page = Buffer.concat([page, Buffer.alloc(PAGE_SIZE - page.length)])
      }
      nxt.push(sha256(page))
    }
    cur = Buffer.concat(nxt)
    if (cur.length > PAGE_SIZE) {
      mid.push(cur) // the level containing the root (packed <= 4096) is not intermediate
    }
  }
  const page = Buffer.concat([cur, Buffer.alloc(PAGE_SIZE - cur.length)])
  return { root: sha256(page), mid: Buffer.concat(mid) }
}

export function buildDescriptor(
  sign_size: number,
  file_size: number,
  root: Buffer,
  flags: number,
): Buffer {
  // Build the 256-byte fs-verity descriptor
  const d = Buffer.alloc(DESC_SIZE)
  d[0] = 1 // version
  d[1] = 1 // hashAlgorithm = SHA-256
  d[2] = 12 // log2BlockSize = 2^12 = 4096
  d[3] = 0 // saltSize
  writeU32(d, 4, sign_size)
  writeU64(d, 8, file_size)
  root.copy(d, 16) // rootHash left-aligned into 64B, last 32B stay zero
  writeU32(d, 112, flags)
  d[255] = 3 // csVersion
  return d
}

export function signElf(elf: Buffer, force = false): Buffer {
  // Main signing flow
  if (
    elf.length < 64 ||
    elf[0] !== 0x7f ||
    elf[1] !== 0x45 ||
    elf[2] !== 0x4c ||
    elf[3] !== 0x46 ||
    elf[4] !== 2
  ) {
    throw new Error('not ELF64')
  }

  let buf: Buffer = Buffer.from(elf)
  if (hasCodesignSection(buf)) {
    if (!force) {
      throw new Error(
        'already has a .codesign section; strip first or use --force',
      )
    }
    buf = stripCodesign(buf).out
  }

  // 1. inject a 4 KiB placeholder .codesign section
  const { out: tmp0, cs_off } = injectCodesignSection(buf)
  const file_size = tmp0.length

  // 2. merkle root hash; mid holds the intermediate-level hashes
  const { root, mid } = merkleRootHash(tmp0, cs_off, PAGE_SIZE)

  // 3/4. descriptor(signSize=0) used for the digest
  const desc_for_digest = buildDescriptor(0, file_size, root, FLAG_SELF_SIGN)
  // 5. signature = SHA256(descriptor)
  const signature = sha256(desc_for_digest)
  // 6. descriptor(signSize=32) stored on disk
  const desc_on_disk = buildDescriptor(32, file_size, root, FLAG_SELF_SIGN)

  // 7. ElfSignInfo: 8B header + 256B descriptor + 32B signature = 296B
  const payload = Buffer.alloc(4 + 4 + DESC_SIZE + HASH_OUT)
  writeU32(payload, 0, FS_VERITY_DESCRIPTOR_TYPE) // type
  writeU32(payload, 4, DESC_SIZE + HASH_OUT) // length = 288
  desc_on_disk.copy(payload, 8)
  signature.copy(payload, 8 + DESC_SIZE)

  // 8. write into the section in place: the intermediate-level hashes follow
  //    the payload; capacity is 4096-296=3800B, so a longer `mid` keeps only
  //    its first 3800B (the leaf-level side)
  payload.copy(tmp0, cs_off)
  mid.copy(tmp0, cs_off + payload.length, 0, PAGE_SIZE - payload.length)
  return tmp0
}

// ─────────────────── read-only validation (--check) ───────────────────
export function checkSelfsign(elf: Buffer): {
  ok: boolean
  reason: string | null
} {
  // Read-only validation of an existing self-signature (--check).
  // Checks (all must pass; the first mismatch is reported):
  //   1. parseable ELF64 (all parseElfHeader checks), a .codesign section
  //      whose ElfSignInfo header has type=1 / length=288
  //   2. descriptor fixed fields: version=1, hashAlgorithm=1,
  //      log2BlockSize=12, csVersion=3
  //   3. signSize=32 and fileSize=actual file size
  //   4. stored merkle root hash == root recomputed over the whole file
  //   5. stored signature == SHA256(descriptor with signSize zeroed)
  // The merkle intermediate levels (the area after the 296B payload) are
  // intentionally not verified: the pages covered by .codesign are already
  // zeroed at the leaf level, so tampering with them cannot change the root
  // and this check still passes (expected behavior).
  // Returns { ok, reason }; reason is the cause string when ok is false.

  // 1a. ELF64 pre-check (parse failure includes unusable SHT)
  let hdr: ElfHeader
  try {
    hdr = parseElfHeader(elf)
  } catch {
    return { ok: false, reason: 'not ELF64' }
  }

  // 1b. locate the .codesign section; it must hold at least the 296B payload
  const cs_entry_off = findSectionByName(
    elf,
    hdr.e_shoff,
    hdr.e_shentsize,
    hdr.e_shnum,
    hdr.e_shstrndx,
    CODESIGN_NAME,
  )
  if (cs_entry_off < 0) {
    return { ok: false, reason: 'no .codesign section' }
  }
  const cs_off = readU64(elf, cs_entry_off + 24)
  const cs_size = readU64(elf, cs_entry_off + 32)
  const payload_len = 8 + DESC_SIZE + HASH_OUT
  if (cs_size < payload_len || cs_off + payload_len > elf.length) {
    return { ok: false, reason: 'bad ElfSignInfo header' }
  }

  // 1c. ElfSignInfo header: type=1, length=288
  if (
    readU32(elf, cs_off) !== FS_VERITY_DESCRIPTOR_TYPE ||
    readU32(elf, cs_off + 4) !== DESC_SIZE + HASH_OUT
  ) {
    return { ok: false, reason: 'bad ElfSignInfo header' }
  }

  const desc = elf.subarray(cs_off + 8, cs_off + 8 + DESC_SIZE)
  const sig = elf.subarray(cs_off + 8 + DESC_SIZE, cs_off + payload_len)

  // 2. descriptor fixed fields: version/hashAlgorithm/log2BlockSize/csVersion
  if (desc[0] !== 1 || desc[1] !== 1 || desc[2] !== 12 || desc[255] !== 3) {
    return { ok: false, reason: 'unsupported descriptor fields' }
  }

  // 3. signSize=32 and fileSize=actual file size
  if (readU32(desc, 4) !== HASH_OUT) {
    return { ok: false, reason: 'signSize mismatch' }
  }
  if (readU64(desc, 8) !== elf.length) {
    return { ok: false, reason: 'fileSize mismatch' }
  }

  // 4. merkle root hash: recompute the root over the whole file
  //    (intermediate levels ignored)
  const { root } = merkleRootHash(elf, cs_off, PAGE_SIZE)
  if (!desc.subarray(16, 16 + HASH_OUT).equals(root)) {
    return { ok: false, reason: 'merkle root mismatch' }
  }

  // 5. signature == SHA256(descriptor with signSize zeroed)
  const desc0 = Buffer.from(desc)
  desc0.fill(0, 4, 8)
  if (!sig.equals(sha256(desc0))) {
    return { ok: false, reason: 'signature mismatch' }
  }

  return { ok: true, reason: null }
}

// ─────────────────── file I/O layer ───────────────────
export function signFileAtomic(path: string, force = false): void {
  const raw = readFileSync(path)
  const signed = signElf(raw, force)

  let mode: number | null = null
  try {
    mode = statSync(path).mode & 0o7777
  } catch {
    // ignore
  }

  const tmp_path = `${path}.ohos-signing.${process.pid}.tmp`
  try {
    unlinkSync(tmp_path)
  } catch {
    /* ignore */
  }
  writeFileSync(tmp_path, signed)
  if (mode !== null) chmodSync(tmp_path, mode)
  renameSync(tmp_path, path)
}

export function selfsignMain(argv: string[]): number {
  let force = false
  let strip_only = false
  let check_only = false
  const positional: string[] = []
  for (const a of argv) {
    if (a === '--force' || a === '-f') force = true
    else if (a === '--strip') strip_only = true
    else if (a === '--check') check_only = true
    else positional.push(a)
  }
  // --check combined with an output path/--force/--strip is a usage error
  if (
    positional.length < 1 ||
    positional.length > 2 ||
    (check_only && (force || strip_only || positional.length === 2))
  ) {
    debug.error(
      'usage: selfsign <input_elf> [output_elf] [--force] [--strip] [--check]\n' +
        '  (output defaults to input, in-place)',
    )
    return 1
  }
  const in_path = positional[0]
  const out_path = positional.length === 2 ? positional[1] : in_path

  try {
    if (check_only) {
      // --check: read-only validation, writes nothing
      const raw = readFileSync(in_path)
      const { ok, reason } = checkSelfsign(raw)
      if (ok) {
        debug.info(`check ok: ${in_path}`)
        return 0
      }
      debug.error(`check failed: ${in_path} (${reason})`)
      return 1
    }

    if (strip_only) {
      const raw = readFileSync(in_path)
      const { removed, out } = stripCodesign(Buffer.from(raw))
      if (!removed) {
        debug.info(`no .codesign section to strip: ${in_path}`)
        return 0
      }
      writeFileSync(out_path, out)
      debug.info(`strip ok: ${in_path} → ${out_path} (${out.length} bytes)`)
      return 0
    }

    if (in_path === out_path) {
      signFileAtomic(in_path, force)
      debug.info(
        `selfsign ok: ${in_path} (in-place, ${force ? 'force' : 'append-only'})`,
      )
    } else {
      const raw = readFileSync(in_path)
      const signed = signElf(raw, force)
      writeFileSync(out_path, signed)
      debug.info(
        `selfsign ok: ${in_path} → ${out_path} (${signed.length} bytes)`,
      )
    }
  } catch (e) {
    debug.error(e)
    return 2
  }
  return 0
}
