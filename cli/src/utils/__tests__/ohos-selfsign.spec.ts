import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import test from 'ava'

import {
  checkSelfsign,
  hasCodesignSection,
  merkleRootHash,
  parseElfHeader,
  selfsignMain,
  signElf,
  signFileAtomic,
  stripCodesign,
} from '../ohos-selfsign.js'

// Builds a deterministic minimal ELF64 shared object: a `.text` section,
// a `.data` section of `dataSize` bytes and the section name string table.
// `shentsize` widens every section header entry (ELF64 permits entries
// larger than 64 bytes) and `trailing` appends that many bytes of junk
// after the section header table — both are legal upstream edge cases.
// The golden hashes below were produced by signing this exact fixture with
// the upstream `selfsign.js` from https://github.com/hqzing/ohos-selfsign.
function makeElf64(dataSize = 16, shentsize = 64, trailing = 0): Buffer {
  const text = Buffer.alloc(32).fill(0xcc)
  const data = Buffer.alloc(dataSize)
  for (let i = 0; i < dataSize; i++) data[i] = (i * 31 + 7) & 0xff
  const shstr = Buffer.from('\0.text\0.data\0.shstrtab\0', 'latin1')
  // name offsets inside shstr: .text=1, .data=7, .shstrtab=13
  const nsec = 4
  const textOff = 64
  const dataOff = textOff + text.length
  const shstrOff = dataOff + data.length
  const shoff = Math.ceil((shstrOff + shstr.length) / 8) * 8
  const total = shoff + nsec * shentsize + trailing

  const elf = Buffer.alloc(total)
  // ELF64 header
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0)
  elf.writeUInt16LE(2, 16) // e_type = ET_EXEC
  elf.writeUInt16LE(0x3e, 18) // e_machine = x86_64
  elf.writeUInt32LE(1, 20) // e_version
  elf.writeBigUInt64LE(0n, 24) // e_entry
  elf.writeBigUInt64LE(0n, 32) // e_phoff
  elf.writeBigUInt64LE(BigInt(shoff), 40) // e_shoff
  elf.writeUInt32LE(0, 48) // e_flags
  elf.writeUInt16LE(64, 52) // e_ehsize
  elf.writeUInt16LE(56, 54) // e_phentsize
  elf.writeUInt16LE(0, 56) // e_phnum
  elf.writeUInt16LE(shentsize, 58) // e_shentsize
  elf.writeUInt16LE(nsec, 60) // e_shnum
  elf.writeUInt16LE(3, 62) // e_shstrndx

  text.copy(elf, textOff)
  data.copy(elf, dataOff)
  shstr.copy(elf, shstrOff)

  const sh = (
    i: number,
    name: number,
    type: number,
    flags: number,
    off: number,
    size: number,
    align: number,
  ) => {
    const e = shoff + i * shentsize
    elf.writeUInt32LE(name, e)
    elf.writeUInt32LE(type, e + 4)
    elf.writeBigUInt64LE(BigInt(flags), e + 8)
    elf.writeBigUInt64LE(0n, e + 16) // sh_addr
    elf.writeBigUInt64LE(BigInt(off), e + 24)
    elf.writeBigUInt64LE(BigInt(size), e + 32)
    elf.writeBigUInt64LE(BigInt(align), e + 48)
  }
  // sh[0] stays SHT_NULL (all zeros)
  sh(1, 1, 1, 6, textOff, text.length, 16) // .text PROGBITS AX
  sh(2, 7, 1, 3, dataOff, data.length, 8) // .data PROGBITS WA
  sh(3, 13, 3, 0, shstrOff, shstr.length, 1) // .shstrtab STRTAB

  if (trailing > 0) {
    elf.fill(0xa5, shoff + nsec * shentsize) // recognizable trailing payload
  }
  return elf
}

const sha256hex = (b: Buffer) => createHash('sha256').update(b).digest('hex')

test('signElf output is byte-identical to upstream selfsign.js (small file)', (t) => {
  const signed = signElf(makeElf64(16))
  t.true(hasCodesignSection(signed))
  t.is(
    sha256hex(signed),
    '7913969989b797580aeb3554b78343b1a456845f01c9aedd6f5b9dddeb787c77',
  )
})

test('signElf output is byte-identical to upstream selfsign.js (multi-level merkle)', (t) => {
  // >128 pages of data forces the merkle loop past one level
  const signed = signElf(makeElf64(600 * 1024))
  t.true(hasCodesignSection(signed))
  t.is(
    sha256hex(signed),
    'b936fed982e6b8d89b9e39c4cfd11258a0522152788ca76a7126f75a3e8d5e3a',
  )
})

test('signElf output is byte-identical to upstream (intermediate merkle levels)', (t) => {
  // >128*128 pages produces merkle intermediate levels, which upstream
  // stores in the .codesign section after the 296B payload
  const signed = signElf(makeElf64(65 * 1024 * 1024))
  t.true(hasCodesignSection(signed))
  t.is(
    sha256hex(signed),
    '9534aeb8c5e42c5fe78d691ef717aa291179286440ef12df16886f130eb7e7a2',
  )
})

test('signElf supports section entries larger than 64 bytes', (t) => {
  const signed = signElf(makeElf64(16, 72))
  t.true(hasCodesignSection(signed))
  t.is(
    sha256hex(signed),
    '81b6c9ae7cf071c6ad56e5a6ab7929c35ae46fc3081575503f37bf521e1b842e',
  )
})

test('signElf preserves trailing data after the section header table', (t) => {
  const signed = signElf(makeElf64(16, 64, 512))
  t.true(hasCodesignSection(signed))
  t.is(
    sha256hex(signed),
    '22dd5f1231f00ef9691fa5bfeaa843c0322879d775f37d834e159de423c2a7c7',
  )
  // the 0xa5 trailing block survives inside the signed output
  const idx = signed.indexOf(Buffer.alloc(512, 0xa5))
  t.true(idx > 0)
})

test('merkleRootHash exposes intermediate levels only for deep trees', (t) => {
  // 128 leaf hashes pack to exactly 4096B, so a <=128-page file has no
  // intermediate levels
  const { mid: shallow } = merkleRootHash(Buffer.alloc(128 * 4096, 0x11), 0, 0)
  t.is(shallow.length, 0)

  // 128*128+1 pages => the second level packs 129*32B > 4096B, so one
  // intermediate level of 129*32 = 4128B exists
  const deep = merkleRootHash(Buffer.alloc((128 * 128 + 1) * 4096, 0x22), 0, 0)
  t.is(deep.mid.length, 129 * 32)
})

test('checkSelfsign validates a signed artifact', (t) => {
  const signed = signElf(makeElf64(16))
  t.deepEqual(checkSelfsign(signed), { ok: true, reason: null })
})

test('checkSelfsign reports the upstream failure reasons', (t) => {
  t.is(checkSelfsign(Buffer.from('MZ....')).reason, 'not ELF64')
  t.is(checkSelfsign(makeElf64(16)).reason, 'no .codesign section')

  const signed = signElf(makeElf64(16))
  const tampered = Buffer.from(signed)
  tampered[100] ^= 0xff // flip a .text byte
  t.is(checkSelfsign(tampered).reason, 'merkle root mismatch')

  // corrupt the descriptor's signSize field: find the 296B payload by its
  // ElfSignInfo header (type=1, length=288), the descriptor starts 8B later
  // and signSize is the descriptor's second u32
  const payloadOff = signed.indexOf(Buffer.from([1, 0, 0, 0, 0x20, 0x01, 0, 0]))
  t.true(payloadOff > 0)
  const badDesc = Buffer.from(signed)
  badDesc.writeUInt32LE(24, payloadOff + 8 + 4)
  t.is(checkSelfsign(badDesc).reason, 'signSize mismatch')
})

test('hasCodesignSection detects signed and unsigned ELFs', (t) => {
  const elf = makeElf64()
  t.false(hasCodesignSection(elf))
  t.true(hasCodesignSection(signElf(elf)))
  t.false(hasCodesignSection(Buffer.from('not an elf')))
})

test('stripCodesign removes the .codesign section', (t) => {
  const elf = makeElf64()
  const unsigned = stripCodesign(elf)
  t.false(unsigned.removed)

  const signed = signElf(elf)
  const stripped = stripCodesign(signed)
  t.true(stripped.removed)
  t.false(hasCodesignSection(stripped.out))
  // the stripped ELF still has a valid section header table
  t.notThrows(() => parseElfHeader(stripped.out))
})

test('stripCodesign is byte-identical to upstream (shentsize 72 + trailing data)', (t) => {
  const signed = signElf(makeElf64(16, 72, 512))
  const stripped = stripCodesign(signed)
  t.true(stripped.removed)
  t.is(
    sha256hex(stripped.out),
    '0161662254321d607bdc487f20ca2c72692dea52bcfa2462a63a4acbe2602421',
  )
})

test('signElf refuses to re-sign without force', (t) => {
  const signed = signElf(makeElf64())
  t.throws(() => signElf(signed), { message: /already has a \.codesign/ })
  const reSigned = signElf(signed, true)
  t.true(hasCodesignSection(reSigned))
  t.true(checkSelfsign(reSigned).ok)
})

test('signElf rejects non-ELF64 input', (t) => {
  t.throws(() => signElf(Buffer.from('MZ....')), { message: 'not ELF64' })
  // ELF32 is rejected too
  const elf32 = makeElf64()
  elf32[4] = 1
  t.throws(() => signElf(elf32), { message: 'not ELF64' })
})

test('signFileAtomic signs in place and preserves the file mode', async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), 'napi-rs-ohos-selfsign-'))
  try {
    const path = join(dir, 'libfoo.so')
    await writeFile(path, makeElf64())
    // 0o755 takes effect on POSIX; on Windows chmod only maps the
    // read-only bit, so assert the mode survives signing rather than
    // asserting the absolute value.
    await chmod(path, 0o755)
    const { mode: modeBefore } = await stat(path)
    const signed = signElf(makeElf64())
    signFileAtomic(path)
    const { mode } = await stat(path)
    t.is(mode & 0o777, modeBefore & 0o777)
    t.deepEqual(await readFile(path), signed)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('signFileAtomic force mode re-signs an already signed file', async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), 'napi-rs-ohos-selfsign-'))
  try {
    const path = join(dir, 'libfoo.so')
    await writeFile(path, makeElf64())
    signFileAtomic(path)
    t.true(checkSelfsign(await readFile(path)).ok)
    // a second pass without force throws; force re-signs cleanly
    t.throws(() => signFileAtomic(path), {
      message: /already has a \.codesign/,
    })
    signFileAtomic(path, true)
    t.true(checkSelfsign(await readFile(path)).ok)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('selfsignMain signs, strips, checks and reports exit codes', async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), 'napi-rs-ohos-selfsign-'))
  try {
    const path = join(dir, 'libfoo.so')
    await writeFile(path, makeElf64())
    // --check on an unsigned file fails
    t.is(selfsignMain(['--check', path]), 1)
    t.is(selfsignMain([path]), 0)
    t.true(hasCodesignSection(await readFile(path)))
    // --check on the signed file passes
    t.is(selfsignMain(['--check', path]), 0)
    // --check combined with --force/--strip/an output path is a usage error
    t.is(selfsignMain(['--check', '--force', path]), 1)
    // re-signing without --force errors with exit code 2
    t.is(selfsignMain([path]), 2)
    t.is(selfsignMain(['--force', path]), 0)
    t.is(selfsignMain(['--strip', path]), 0)
    t.false(hasCodesignSection(await readFile(path)))
    // usage error
    t.is(selfsignMain([]), 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
