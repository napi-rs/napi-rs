import { realpathSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'os'
import { join } from 'node:path'

import test from 'ava'

import {
  wasiLibcHasNewFutexAbi,
  cargoTargetTriple,
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

test('cargoTargetTriple should mirror the split cargo-zigbuild applies', (t) => {
  // cargo-zigbuild splits `--target` at the first dot: Cargo builds the part
  // before it and the suffix becomes zig's libc/ABI version pin. That split
  // happens for every target, not only glibc ones.
  for (const [target, cargo] of [
    ['x86_64-unknown-linux-gnu.2.27', 'x86_64-unknown-linux-gnu'],
    ['aarch64-unknown-linux-gnu.2.17', 'aarch64-unknown-linux-gnu'],
    ['armv7-unknown-linux-gnueabihf.2.31', 'armv7-unknown-linux-gnueabihf'],
    ['aarch64-apple-darwin.14.0', 'aarch64-apple-darwin'],
    ['x86_64-unknown-linux-musl.1.2', 'x86_64-unknown-linux-musl'],
    ['x86_64-unknown-linux-gnu.custom', 'x86_64-unknown-linux-gnu'],
    ['x86_64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu'],
  ]) {
    t.is(cargoTargetTriple(target), cargo, target)
  }
})

test('cargoTargetTriple should resolve a custom target spec to its file stem', (t) => {
  // Cargo names the artifact directory after the stem of a `--target *.json`
  // spec file, not after the file name or path.
  t.is(cargoTargetTriple('my-custom-target.json'), 'my-custom-target')
  t.is(
    cargoTargetTriple('targets/mips64-unknown-linux-gnuabin32.json'),
    'mips64-unknown-linux-gnuabin32',
  )
  // A stem that itself contains dots keeps them: the spec file's name is
  // still the artifact directory name.
  t.is(cargoTargetTriple('my.target.json'), 'my.target')
  // Windows-style separators resolve to the stem too.
  t.is(cargoTargetTriple('targets\\my-target.json'), 'my-target')
})

test('should parse a glibc-versioned zigbuild target verbatim', (t) => {
  const target = parseTriple('x86_64-unknown-linux-gnu.2.27')

  // `triple` keeps the requested spelling: `cargo zigbuild --target` needs
  // the suffix to pin the minimum glibc version. The suffix is opaque to
  // `parseTriple`; `Builder` re-derives platform/arch/abi from
  // `cargoTargetTriple()` when the build actually goes through zigbuild.
  t.is(target.triple, 'x86_64-unknown-linux-gnu.2.27')
  t.is(target.abi, 'gnu.2.27')
  t.is(cargoTargetTriple(target.triple), 'x86_64-unknown-linux-gnu')
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
