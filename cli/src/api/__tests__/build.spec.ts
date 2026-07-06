import { existsSync } from 'node:fs'
import { exec } from 'node:child_process'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { join as posixJoin, sep as posixSep } from 'node:path/posix'
import { sep as win32Sep } from 'node:path/win32'
import { fileURLToPath } from 'node:url'

import ava, { type TestFn } from 'ava'

import {
  buildProject,
  generateTypeDef,
  validateCrossCompileFlags,
  validateNapiCrossSupport,
  writeJsBinding,
} from '../build.js'
import { getSystemDefaultTarget } from '../../utils/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

const test = ava as TestFn<{
  tmpDir: string
  projectDir: string
  typeDefDir: string
}>

test.beforeEach(async (t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = posixJoin(
    tmpdir(),
    'napi-rs-test',
    `build-spec-${timestamp}-${random}`,
  )
  const projectDir = posixJoin(tmpDir, 'project')
  const typeDefDir = posixJoin(projectDir, 'target', 'type-def')

  await mkdir(typeDefDir, { recursive: true })

  t.context = { tmpDir, projectDir, typeDefDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('build pipeline generates bindings and artifacts', async (t) => {
  const { projectDir, typeDefDir } = t.context
  const crateName = 'build_integration'
  const binaryName = 'build-integration'
  const packageName = 'build-integration'
  const version = '0.1.0'
  const target = getSystemDefaultTarget()

  const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
    win32Sep,
    posixSep,
  )

  await mkdir(join(projectDir, 'src'), { recursive: true })

  const cargoToml = `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}" }
napi-derive = { path = "${napiDerivePath}" }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`

  await writeFile(join(projectDir, 'Cargo.toml'), cargoToml)
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: [target.triple],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(projectDir, 'build.rs'),
    'fn main() {\n    napi_build::setup();\n}\n',
  )
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  )

  const buildCmd = `cargo build --target ${target.triple}`

  await new Promise<void>((resolve, reject) => {
    const child = exec(buildCmd, {
      cwd: projectDir,
      env: { ...process.env, NAPI_TYPE_DEF_TMP_FOLDER: typeDefDir },
    })
    child.stderr?.on('data', (data) => {
      console.error(data.toString())
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`cargo build exited with code ${code ?? 'null'}`))
      }
    })
    child.on('error', reject)
  })

  const files = await readdir(typeDefDir)
  t.true(files.length > 0, 'type definition files should be generated')

  const { exports, dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
  })

  t.true(exports.includes('sum'), 'generateTypeDef should expose napi exports')

  const jsBinding = await writeJsBinding({
    platform: true,
    idents: exports,
    binaryName,
    packageName,
    version,
    outputDir: projectDir,
  })

  t.truthy(jsBinding)
  t.is(jsBinding?.path, join(projectDir, 'index.js'))

  const libName = crateName.replace(/-/g, '_')
  const srcName =
    target.platform === 'darwin'
      ? `lib${libName}.dylib`
      : target.platform === 'win32'
        ? `${libName}.dll`
        : `lib${libName}.so`
  const profile = 'debug'
  const srcPath = join(projectDir, 'target', target.triple, profile, srcName)
  t.true(existsSync(srcPath), 'compiled artifact should exist')

  const destName = `${binaryName}.${target.platformArchABI}.${srcName.endsWith('.wasm') ? 'wasm' : 'node'}`
  const destPath = join(projectDir, destName)
  await copyFile(srcPath, destPath)
  t.true(existsSync(destPath), 'artifact should be copied to output directory')

  const nodeStat = await stat(destPath)
  t.true(nodeStat.size > 0)

  t.regex(dts, /export declare function sum\(a: number, b: number\): number/)

  const jsPath = join(projectDir, 'index.js')
  t.true(existsSync(jsPath))
  const jsContent = await readFile(jsPath, 'utf-8')
  t.regex(jsContent, /module\.exports\.sum = nativeBinding\.sum/)
})

test('generateTypeDef preserves deterministic file order', async (t) => {
  const { projectDir, typeDefDir } = t.context

  await mkdir(join(typeDefDir, 'nested'), { recursive: true })
  await writeFile(
    join(typeDefDir, 'b.type'),
    '{"kind":"fn","name":"zeta","def":"function zeta(): void"}\n',
  )
  await writeFile(
    join(typeDefDir, 'a.type'),
    '{"kind":"fn","name":"alpha","def":"function alpha(): void"}\n',
  )

  const { exports, dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
  })

  t.deepEqual(exports, ['alpha', 'zeta'])
  t.true(
    dts.indexOf('function alpha(): void') <
      dts.indexOf('function zeta(): void'),
  )
})

test('should throw on emnapi version mismatch in wasm build', async (t) => {
  const { projectDir } = t.context
  const crateName = 'wasm_version_check'
  const binaryName = 'wasm-version-check'
  const packageName = 'wasm-version-check'
  const version = '0.1.0'

  const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
    win32Sep,
    posixSep,
  )

  await mkdir(join(projectDir, 'src'), { recursive: true })

  const cargoToml = `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}", features = ["noop"] }
napi-derive = { path = "${napiDerivePath}", features = ["noop"] }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`

  await writeFile(join(projectDir, 'Cargo.toml'), cargoToml)
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: ['wasm32-wasi-preview1-threads'],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(projectDir, 'build.rs'),
    'fn main() {\n    napi_build::setup();\n}\n',
  )
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  )

  // Create fake @emnapi/core and @emnapi/runtime with mismatched versions
  const fakeVersion = '0.0.0-fake'
  for (const pkg of ['@emnapi/core', '@emnapi/runtime']) {
    const pkgDir = join(projectDir, 'node_modules', pkg)
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkg, version: fakeVersion, main: 'index.js' }),
    )
    await writeFile(
      join(pkgDir, 'index.js'),
      `module.exports = { version: "${fakeVersion}" }`,
    )
  }

  const error = await t.throwsAsync(() =>
    buildProject({
      target: 'wasm32-wasi-preview1-threads',
      cwd: projectDir,
    }),
  )

  t.truthy(error)
  t.regex(error!.message, /emnapi version mismatch/)
})

test('validateCrossCompileFlags rejects combining two cross-compilation mechanisms', (t) => {
  t.throws(
    () => validateCrossCompileFlags({ useCross: true, crossCompile: true }),
    { message: /`--use-cross`.+`--cross-compile`.+cannot be used together/ },
  )
  t.throws(
    () => validateCrossCompileFlags({ useCross: true, useNapiCross: true }),
    { message: /`--use-cross`.+`--use-napi-cross`.+cannot be used together/ },
  )
  t.throws(
    () => validateCrossCompileFlags({ useNapiCross: true, crossCompile: true }),
    {
      message: /`--use-napi-cross`.+`--cross-compile`.+cannot be used together/,
    },
  )
  t.throws(
    () =>
      validateCrossCompileFlags({
        useCross: true,
        useNapiCross: true,
        crossCompile: true,
      }),
    {
      message:
        /`--use-cross`.+`--use-napi-cross`.+`--cross-compile`.+cannot be used together/,
    },
  )
})

test('validateCrossCompileFlags allows a single cross-compilation mechanism', (t) => {
  t.notThrows(() => validateCrossCompileFlags({}))
  t.notThrows(() => validateCrossCompileFlags({ useCross: true }))
  t.notThrows(() => validateCrossCompileFlags({ crossCompile: true }))
  t.notThrows(() => validateCrossCompileFlags({ useNapiCross: true }))
})

test('validateCrossCompileFlags rejects windows-gnu targets with `--cross-compile`', (t) => {
  const windowsGnuError =
    /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnu/
  // `cargo-xwin` is only used on non-Windows hosts, where it silently
  // no-ops for `windows-gnu` targets, so the combination must be rejected.
  t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'linux',
      ),
    { message: windowsGnuError },
  )
  t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'darwin',
      ),
    { message: windowsGnuError },
  )
  // `gnullvm`-flavored triples take the same broken `cargo-xwin` route.
  t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnullvm' },
        'linux',
      ),
    {
      message:
        /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnullvm/,
    },
  )
  // The target can also come from `CARGO_BUILD_TARGET`; the check is fully
  // synchronous, so the environment is mutated and restored without any
  // interleaving point another concurrently running test could observe.
  const originalCargoBuildTarget = process.env.CARGO_BUILD_TARGET
  try {
    process.env.CARGO_BUILD_TARGET = 'x86_64-pc-windows-gnu'
    t.throws(() => validateCrossCompileFlags({ crossCompile: true }, 'linux'), {
      message: windowsGnuError,
    })
  } finally {
    if (originalCargoBuildTarget === undefined) {
      delete process.env.CARGO_BUILD_TARGET
    } else {
      process.env.CARGO_BUILD_TARGET = originalCargoBuildTarget
    }
  }
})

test('validateCrossCompileFlags allows `--cross-compile` for non windows-gnu targets', (t) => {
  // MSVC targets are exactly what `cargo-xwin` supports.
  for (const target of [
    'x86_64-pc-windows-msvc',
    'aarch64-pc-windows-msvc',
    'i686-pc-windows-msvc',
    'x86_64-unknown-linux-gnu',
    'aarch64-apple-darwin',
  ]) {
    t.notThrows(() =>
      validateCrossCompileFlags({ crossCompile: true, target }, 'linux'),
    )
  }
  // On a Windows host `--cross-compile` never routes through `cargo-xwin`
  // (it falls back to a plain `cargo build`), so windows-gnu stays allowed.
  t.notThrows(() =>
    validateCrossCompileFlags(
      { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
      'win32',
    ),
  )
  // Without `--cross-compile` the target is none of this check's business.
  t.notThrows(() =>
    validateCrossCompileFlags({ target: 'x86_64-pc-windows-gnu' }, 'linux'),
  )
})

test('validateCrossCompileFlags rejects watch mode combined with cross builds', (t) => {
  t.throws(() => validateCrossCompileFlags({ watch: true, useCross: true }), {
    message: /`--watch` cannot be used with `--use-cross`/,
  })
  t.throws(
    () => validateCrossCompileFlags({ watch: true, crossCompile: true }),
    { message: /`--watch` cannot be used with `--cross-compile`/ },
  )
  t.notThrows(() => validateCrossCompileFlags({ watch: true }))
  t.notThrows(() =>
    validateCrossCompileFlags({ watch: true, useNapiCross: true }),
  )
})

test('validateNapiCrossSupport rejects unsupported hosts', (t) => {
  t.throws(
    () =>
      validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'darwin', 'arm64'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.throws(
    () => validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'win32', 'x64'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.throws(
    () =>
      validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'linux', 'ia32'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.notThrows(() =>
    validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'linux', 'x64'),
  )
  t.notThrows(() =>
    validateNapiCrossSupport('x86_64-unknown-linux-gnu', 'linux', 'arm64'),
  )
})

test('validateNapiCrossSupport rejects unsupported target triples', (t) => {
  t.throws(
    () => validateNapiCrossSupport('x86_64-unknown-linux-musl', 'linux', 'x64'),
    {
      message:
        /`--use-napi-cross` does not support the target x86_64-unknown-linux-musl/,
    },
  )
  t.throws(
    () =>
      validateNapiCrossSupport('riscv64gc-unknown-linux-gnu', 'linux', 'arm64'),
    {
      message:
        /`--use-napi-cross` does not support the target riscv64gc-unknown-linux-gnu/,
    },
  )
  for (const triple of [
    'x86_64-unknown-linux-gnu',
    'aarch64-unknown-linux-gnu',
    'armv7-unknown-linux-gnueabihf',
    's390x-unknown-linux-gnu',
    'powerpc64le-unknown-linux-gnu',
  ]) {
    t.notThrows(() => validateNapiCrossSupport(triple, 'linux', 'x64'))
    t.notThrows(() => validateNapiCrossSupport(triple, 'linux', 'arm64'))
  }
})

test('buildProject rejects invalid cross flag combinations upfront', async (t) => {
  const { projectDir } = t.context

  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(
    join(projectDir, 'Cargo.toml'),
    `[package]
name = "cross_flags_check"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
`,
  )
  await writeFile(join(projectDir, 'src', 'lib.rs'), '')
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'cross-flags-check',
        version: '0.1.0',
        napi: { binaryName: 'cross-flags-check' },
      },
      null,
      2,
    )}\n`,
  )

  const comboError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, useCross: true, crossCompile: true }),
  )
  t.regex(comboError!.message, /cannot be used together/)

  const watchError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, crossCompile: true }),
  )
  t.regex(
    watchError!.message,
    /`--watch` cannot be used with `--cross-compile`/,
  )

  const napiCrossError = await t.throwsAsync(() =>
    buildProject({
      cwd: projectDir,
      useNapiCross: true,
      target: 'riscv64gc-unknown-linux-gnu',
    }),
  )
  t.regex(napiCrossError!.message, /`--use-napi-cross`/)
})

test('buildProject validates cross flags before resolving the crate manifest', async (t) => {
  // `projectDir` deliberately contains no `Cargo.toml`: if `buildProject`
  // resolved the manifest (and spawned `cargo metadata`) before validating
  // the cross-compilation flags, these calls would fail with
  // "No crate found in manifest" instead of the validation errors below.
  const { projectDir } = t.context

  const comboError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, useCross: true, crossCompile: true }),
  )
  t.regex(
    comboError!.message,
    /`--use-cross`.+`--cross-compile`.+cannot be used together/,
  )

  const watchError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, useCross: true }),
  )
  t.regex(watchError!.message, /`--watch` cannot be used with `--use-cross`/)

  const watchCrossCompileError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, crossCompile: true }),
  )
  t.regex(
    watchCrossCompileError!.message,
    /`--watch` cannot be used with `--cross-compile`/,
  )

  // Rejected either for the unsupported host (non Linux x64/arm64) or for
  // the unsupported target triple (on Linux x64/arm64 hosts) — both are
  // `--use-napi-cross` validation errors, keeping this assertion
  // host-platform independent.
  const napiCrossError = await t.throwsAsync(() =>
    buildProject({
      cwd: projectDir,
      useNapiCross: true,
      target: 'riscv64gc-unknown-linux-gnu',
    }),
  )
  t.regex(napiCrossError!.message, /`--use-napi-cross`/)
})

// On a Windows host `--cross-compile` never routes through `cargo-xwin`,
// so the windows-gnu rejection only exists on non-Windows hosts.
;(process.platform === 'win32' ? test.skip : test)(
  'buildProject rejects `--cross-compile` with a windows-gnu target before any side effect',
  async (t) => {
    // `projectDir` deliberately contains no `Cargo.toml`: if `buildProject`
    // resolved the manifest (and spawned `cargo metadata`) before validating
    // the target, this call would fail with a manifest error instead of the
    // windows-gnu validation error below.
    const { projectDir } = t.context

    const error = await t.throwsAsync(() =>
      buildProject({
        cwd: projectDir,
        crossCompile: true,
        target: 'x86_64-pc-windows-gnu',
      }),
    )
    t.regex(
      error!.message,
      /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnu/,
    )
    t.regex(error!.message, /cargo-xwin/)
  },
)

// The scenario below only exists on hosts `--use-napi-cross` does not
// support (anything but Linux x64 / Linux arm64), so skip it elsewhere.
const isNapiCrossUnsupportedHost =
  process.platform !== 'linux' ||
  (process.arch !== 'x64' && process.arch !== 'arm64')

;(isNapiCrossUnsupportedHost ? test : test.skip)(
  'buildProject reports the `--use-napi-cross` host error before resolving the target',
  async (t) => {
    const { projectDir } = t.context

    // Without an explicit `--target` (or `CARGO_BUILD_TARGET`), resolving
    // the target spawns `rustc -vV`. Point `PATH` at an empty directory so
    // that spawn is guaranteed to fail — whether or not Rust is installed on
    // this machine: if `buildProject` resolved the target before validating
    // the host, the error below would be the `rustc` spawn failure instead
    // of the host validation error.
    const emptyPathDir = join(projectDir, 'empty-path')
    await mkdir(emptyPathDir, { recursive: true })

    const originalPath = process.env.PATH
    const originalCargoBuildTarget = process.env.CARGO_BUILD_TARGET
    process.env.PATH = emptyPathDir
    delete process.env.CARGO_BUILD_TARGET
    // The cross-flag validation runs synchronously at the top of
    // `buildProject`, so the promise below is already settled (rejected)
    // when the environment is restored right after — no other concurrently
    // running test can observe the modified `PATH`.
    let buildPromise: Promise<unknown>
    try {
      buildPromise = buildProject({ cwd: projectDir, useNapiCross: true })
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = originalPath
      }
      if (originalCargoBuildTarget === undefined) {
        delete process.env.CARGO_BUILD_TARGET
      } else {
        process.env.CARGO_BUILD_TARGET = originalCargoBuildTarget
      }
    }

    const error = await t.throwsAsync(() => buildPromise)
    t.regex(
      error!.message,
      /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/,
    )
  },
)
