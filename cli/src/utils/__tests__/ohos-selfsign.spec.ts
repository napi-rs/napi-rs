import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import test from 'ava'

import {
  hasCodesignSection,
  parseElfHeader,
  selfsignMain,
  signElf,
  signFileAtomic,
  stripCodesign,
} from '../ohos-selfsign.js'

// Builds a deterministic minimal ELF64 shared object: a `.text` section,
// a `.data` section of `dataSize` bytes and the section name string table.
// The golden hashes below were produced by signing this exact fixture with
// the upstream `selfsign.js` from https://github.com/hqzing/ohos-selfsign.
function makeElf64(dataSize = 16): Buffer {
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
  const total = shoff + nsec * 64

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
  elf.writeUInt16LE(64, 58) // e_shentsize
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
    const e = shoff + i * 64
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

test('signElf refuses to re-sign without force', (t) => {
  const signed = signElf(makeElf64())
  t.throws(() => signElf(signed), { message: /already has a \.codesign/ })
  t.true(hasCodesignSection(signElf(signed, true)))
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
    await chmod(path, 0o755)
    const signed = signElf(makeElf64())
    signFileAtomic(path)
    const { mode } = await stat(path)
    t.is(mode & 0o777, 0o755)
    t.deepEqual(await readFile(path), signed)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('selfsignMain signs, strips and reports exit codes', async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), 'napi-rs-ohos-selfsign-'))
  try {
    const path = join(dir, 'libfoo.so')
    await writeFile(path, makeElf64())
    t.is(selfsignMain([path]), 0)
    t.true(hasCodesignSection(await readFile(path)))
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
