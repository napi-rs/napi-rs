import { realpathSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'os'
import { join } from 'node:path'

import test from 'ava'

import {
  wasiLibcHasNewFutexAbi,
  parseTriple,
  getSystemDefaultTarget,
  rustBundledWasiLibc,
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

// A fake `rustc` must be an executable file, and `execFileSync` cannot run a
// Windows `.cmd` shim without a shell. The behaviour under test does not
// depend on the platform, so cover it on POSIX only.
const posixOnly = process.platform === 'win32' ? test.serial.skip : test.serial

/**
 * Installs a `rustc` that reports its own working directory as the sysroot,
 * so a test can tell which directory the probe ran in.
 */
async function withFakeRustc(
  envVar: 'RUSTC' | 'CARGO_BUILD_RUSTC',
  body: (dir: string) => Promise<void> | void,
) {
  const dir = await mkdtemp(join(os.tmpdir(), 'napi-rs-fake-rustc-'))
  const rustc = join(dir, 'rustc')
  // `$PWD` comes from the inherited environment, so ask the kernel for the
  // real working directory. `-P` also resolves the `/var` symlink on macOS.
  await writeFile(rustc, '#!/bin/sh\necho "$(pwd -P)/sysroot"\n')
  await chmod(rustc, 0o755)
  const previous = process.env[envVar]
  process.env[envVar] = rustc
  try {
    await body(dir)
  } finally {
    if (previous === undefined) {
      delete process.env[envVar]
    } else {
      process.env[envVar] = previous
    }
  }
}

posixOnly('probes the Rust sysroot from the build cwd', async (t) => {
  await withFakeRustc('RUSTC', async (dir) => {
    const caller = join(dir, 'caller')
    const project = join(dir, 'project')
    await mkdir(caller)
    await mkdir(project)

    // `rustc` is a rustup shim, so the directory it runs in picks the
    // toolchain. Cargo is spawned with the build cwd; the probe must match it.
    t.is(
      rustBundledWasiLibc('wasm32-wasip1-threads', project),
      join(
        realpathSync(project),
        'sysroot',
        'lib',
        'rustlib',
        'wasm32-wasip1-threads',
        'lib',
        'self-contained',
        'libc.a',
      ),
    )
    t.not(
      rustBundledWasiLibc('wasm32-wasip1-threads', caller),
      rustBundledWasiLibc('wasm32-wasip1-threads', project),
    )
  })
})

posixOnly('falls back to CARGO_BUILD_RUSTC when RUSTC is unset', async (t) => {
  const previousRustc = process.env.RUSTC
  delete process.env.RUSTC
  try {
    await withFakeRustc('CARGO_BUILD_RUSTC', (dir) => {
      t.true(
        rustBundledWasiLibc('wasm32-wasip1-threads', dir)?.startsWith(
          realpathSync(dir),
        ),
      )
    })
  } finally {
    if (previousRustc !== undefined) {
      process.env.RUSTC = previousRustc
    }
  }
})

posixOnly('returns null when the compiler cannot be run', (t) => {
  const previous = process.env.RUSTC
  process.env.RUSTC = join(os.tmpdir(), 'napi-rs-no-such-rustc')
  try {
    t.is(rustBundledWasiLibc('wasm32-wasip1-threads'), null)
  } finally {
    if (previous === undefined) {
      delete process.env.RUSTC
    } else {
      process.env.RUSTC = previous
    }
  }
})
