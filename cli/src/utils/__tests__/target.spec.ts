import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'os'
import { join } from 'node:path'

import test from 'ava'

import {
  wasiLibcHasNewFutexAbi,
  parseTriple,
  getSystemDefaultTarget,
  wasiSdkMajorVersion,
  AVAILABLE_TARGETS,
} from '../target.js'

async function withWasiSdkDir(
  setup: (wasiSdkPath: string) => Promise<void>,
  assertion: (wasiSdkPath: string) => void,
) {
  const wasiSdkPath = await mkdtemp(join(os.tmpdir(), 'napi-rs-wasi-sdk-'))
  try {
    await setup(wasiSdkPath)
    assertion(wasiSdkPath)
  } finally {
    await rm(wasiSdkPath, { recursive: true, force: true })
  }
}

async function writeVersionFile(wasiSdkPath: string, content: string) {
  await writeFile(join(wasiSdkPath, 'VERSION'), content)
}

async function writeVersionHeader(wasiSdkPath: string, content: string) {
  const headerDir = join(
    wasiSdkPath,
    'share',
    'wasi-sysroot',
    'include',
    'wasm32-wasip1-threads',
    'wasi',
  )
  await mkdir(headerDir, { recursive: true })
  await writeFile(join(headerDir, 'version.h'), content)
}

test('should parse triple correctly', (t) => {
  t.snapshot(AVAILABLE_TARGETS.map(parseTriple))
})

test('should get system default target correctly', (t) => {
  const target = getSystemDefaultTarget()

  t.is(target.platform, os.platform())
})

test('should read the wasi-sdk major version from VERSION', async (t) => {
  await withWasiSdkDir(
    (wasiSdkPath) => writeVersionFile(wasiSdkPath, '34.0\n'),
    (wasiSdkPath) => t.is(wasiSdkMajorVersion(wasiSdkPath), 34),
  )
})

test('should ignore the build suffix in VERSION', async (t) => {
  await withWasiSdkDir(
    (wasiSdkPath) => writeVersionFile(wasiSdkPath, '33.0+m\n'),
    (wasiSdkPath) => t.is(wasiSdkMajorVersion(wasiSdkPath), 33),
  )
})

test('should read a pre wasi-sdk 30 VERSION', async (t) => {
  await withWasiSdkDir(
    (wasiSdkPath) => writeVersionFile(wasiSdkPath, '27.0\n'),
    (wasiSdkPath) => t.is(wasiSdkMajorVersion(wasiSdkPath), 27),
  )
})

test('should fall back to the wasi/version.h header', async (t) => {
  await withWasiSdkDir(
    (wasiSdkPath) =>
      writeVersionHeader(
        wasiSdkPath,
        '#define __wasi_sdk_major__ 30\n#define __wasi_sdk_minor__ 0\n',
      ),
    (wasiSdkPath) => t.is(wasiSdkMajorVersion(wasiSdkPath), 30),
  )
})

test('should prefer VERSION over the wasi/version.h header', async (t) => {
  await withWasiSdkDir(
    async (wasiSdkPath) => {
      await writeVersionFile(wasiSdkPath, '34.0\n')
      await writeVersionHeader(wasiSdkPath, '#define __wasi_sdk_major__ 33\n')
    },
    (wasiSdkPath) => t.is(wasiSdkMajorVersion(wasiSdkPath), 34),
  )
})

test('should return null when no version signal exists', async (t) => {
  await withWasiSdkDir(
    () => Promise.resolve(),
    (wasiSdkPath) => t.is(wasiSdkMajorVersion(wasiSdkPath), null),
  )
})

test('should return null instead of throwing on a malformed VERSION', async (t) => {
  await withWasiSdkDir(
    (wasiSdkPath) => writeVersionFile(wasiSdkPath, 'not a version at all\n'),
    (wasiSdkPath) => {
      t.notThrows(() => wasiSdkMajorVersion(wasiSdkPath))
      t.is(wasiSdkMajorVersion(wasiSdkPath), null)
    },
  )
})

test('should return null when the wasi-sdk path does not exist', (t) => {
  t.is(wasiSdkMajorVersion(join(os.tmpdir(), 'napi-rs-missing-wasi-sdk')), null)
})

test('should detect the new futex ABI from a wasi-libc archive', async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), 'napi-rs-wasi-libc-'))
  try {
    // wasi-libc moved the futex helpers into `futex.c` when it dropped the
    // unused `int op` parameter. `__wait.c` survives either way, so only the
    // presence of `futex.c` separates the two ABIs.
    const newAbi = join(dir, 'libc-new.a')
    const legacyAbi = join(dir, 'libc-legacy.a')
    await writeFile(newAbi, '!<arch>\n__wait.c.obj\nfutex.c.obj\n')
    await writeFile(
      legacyAbi,
      '!<arch>\n__wait.c.obj\n__wasilibc_busywait.c.obj\n',
    )

    t.true(wasiLibcHasNewFutexAbi(newAbi))
    t.false(wasiLibcHasNewFutexAbi(legacyAbi))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('should return null when the wasi-libc archive is unavailable', (t) => {
  t.is(wasiLibcHasNewFutexAbi(null), null)
  t.is(
    wasiLibcHasNewFutexAbi(join(os.tmpdir(), 'napi-rs-missing-libc.a')),
    null,
  )
})
