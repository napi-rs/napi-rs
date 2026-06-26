import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { exec, execSync } from 'node:child_process'
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
import { fileURLToPath, pathToFileURL } from 'node:url'

import ava, { type ExecutionContext, type TestFn } from 'ava'

import {
  buildProject,
  generateTypeDef,
  napiCrossToolchainEnvs,
  validateCrossCompileFlags,
  validateNapiCrossSupport,
  writeJsBinding,
} from '../build.js'
import { getSystemDefaultTarget } from '../../utils/index.js'
  createArtifactDestinationName,
  createWasiBrowserEntry,
  createWasiCompilerFlags,
  createWasiDeferredBindingTypeDef,
  generateTypeDef,
  selectWasiBrowserTarget,
  verifyWasiReactor,
  writeJsBinding,
} from '../build.js'
import {
  DEFAULT_TYPE_DEF_HEADER,
  getSystemDefaultTarget,
  parseTriple,
} from '../../utils/index.js'

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

test('WASI artifact names remain flavor-specific without --platform', (t) => {
  const sourceName = 'binding.wasm'
  const threaded = createArtifactDestinationName(
    'binding',
    parseTriple('wasm32-wasip1-threads'),
    sourceName,
    false,
  )
  const threadless = createArtifactDestinationName(
    'binding',
    parseTriple('wasm32-wasip1'),
    sourceName,
    false,
  )

  t.is(threaded, 'binding.wasm32-wasi.wasm')
  t.is(threadless, 'binding.wasm32-wasip1.wasm')
  t.not(threaded, threadless)
})

test('WASI SDK compiler flags preserve paths containing spaces', (t) => {
  const wasiSdkPath = join(t.context.tmpDir, 'WASI SDK')
  const sysroot = join(wasiSdkPath, 'share', 'wasi-sysroot')
  const linker = join(wasiSdkPath, 'bin', 'wasm-ld')
  const flags = createWasiCompilerFlags(
    wasiSdkPath,
    'wasm32-wasip1-threads',
    true,
  )

  t.is(
    flags.compileFlags,
    `'--target=wasm32-wasip1-threads' '--sysroot=${sysroot}' '-pthread' '-mllvm' '-wasm-enable-sjlj'`,
  )
  t.is(
    flags.linkerFlags,
    `'-fuse-ld=${linker}' '--target=wasm32-wasip1-threads'`,
  )
})

test('writeJsBinding creates nested custom entry directories', async (t) => {
  const output = await writeJsBinding({
    platform: true,
    idents: [],
    jsBinding: join('dist', 'binding.cjs'),
    binaryName: 'nested-wasi',
    packageName: 'nested-wasi',
    version: '1.0.0',
    outputDir: t.context.projectDir,
    wasiFlavors: ['wasm32-wasip1'],
  })

  t.is(output?.path, join(t.context.projectDir, 'dist', 'binding.cjs'))
  t.true(existsSync(output!.path))
})

test('writeJsBinding emits an untyped CJS WASI fallback loader', async (t) => {
  const { projectDir } = t.context
  const output = await writeJsBinding({
    platform: true,
    idents: [],
    binaryName: 'untyped-wasi',
    packageName: 'untyped-wasi',
    version: '1.0.0',
    outputDir: projectDir,
    wasiFlavors: ['wasm32-wasip1'],
  })

  t.is(output?.path, join(projectDir, 'index.js'))
  const binding = await readFile(join(projectDir, 'index.js'), 'utf8')
  t.true(binding.includes("require('./untyped-wasi.wasip1.cjs')"))
  t.true(binding.includes("require('untyped-wasi-wasm32-wasip1')"))
  t.true(binding.includes('module.exports = nativeBinding'))
})

test.serial(
  'writeJsBinding emits an executable untyped ESM WASI fallback loader',
  async (t) => {
    const { projectDir } = t.context
    await writeFile(
      join(projectDir, 'untyped-esm-wasi.wasip1.cjs'),
      'module.exports = { answer: 42 }\n',
    )
    await writeFile(join(projectDir, 'untyped-esm-wasi.wasm32-wasip1.wasm'), '')
    const output = await writeJsBinding({
      platform: true,
      esm: true,
      idents: [],
      jsBinding: 'index.mjs',
      binaryName: 'untyped-esm-wasi',
      packageName: 'untyped-esm-wasi',
      version: '1.0.0',
      outputDir: projectDir,
      wasiFlavors: ['wasm32-wasip1'],
    })

    t.is(output?.path, join(projectDir, 'index.mjs'))
    const previousForceWasi = process.env.NAPI_RS_FORCE_WASI
    process.env.NAPI_RS_FORCE_WASI = 'true'
    try {
      const binding = await import(
        `${pathToFileURL(output!.path).href}?test=${Date.now()}`
      )
      t.is(binding.default.answer, 42)
      t.false('answer' in binding)
    } finally {
      if (previousForceWasi === undefined) {
        delete process.env.NAPI_RS_FORCE_WASI
      } else {
        process.env.NAPI_RS_FORCE_WASI = previousForceWasi
      }
    }
  },
)

test('WASI artifact verification requires a reactor initializer', async (t) => {
  const missingPath = join(t.context.tmpDir, 'missing-initialize.wasm')
  await writeFile(missingPath, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
  const error = await t.throwsAsync(() => verifyWasiReactor(missingPath))
  t.regex(error.message, /does not export _initialize/)

  const validPath = join(t.context.tmpDir, 'reactor.wasm')
  await writeFile(
    validPath,
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 15, 1, 11,
      95, 105, 110, 105, 116, 105, 97, 108, 105, 122, 101, 0, 0, 10, 4, 1, 2, 0,
      11,
    ]),
  )
  await t.notThrowsAsync(() => verifyWasiReactor(validPath))
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
  const gnuError = t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'linux',
      ),
    { message: windowsGnuError },
  )
  // `windows-gnu` links with a mingw-w64 GCC toolchain.
  t.regex(gnuError!.message, /x86_64-w64-mingw32-gcc/)
  t.regex(gnuError!.message, /LIBNODE_PATH/)
  t.regex(gnuError!.message, /x86_64-pc-windows-msvc/)
  t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'darwin',
      ),
    { message: windowsGnuError },
  )
  // `gnullvm`-flavored triples take the same broken `cargo-xwin` route, but
  // link with an LLVM toolchain (llvm-mingw), not the mingw-w64 GCC one.
  const gnullvmError = t.throws(
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
  t.regex(gnullvmError!.message, /llvm-mingw/)
  t.notRegex(gnullvmError!.message, /mingw32-gcc/)
  t.regex(gnullvmError!.message, /LIBNODE_PATH/)
  t.regex(gnullvmError!.message, /x86_64-pc-windows-msvc/)
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

const napiCrossToolchainPath = posixJoin(
  '/home/user/.napi-rs/cross-toolchain/1.0.0',
  'aarch64-unknown-linux-gnu',
)
const napiCrossDownloadedSysroot = join(
  napiCrossToolchainPath,
  'aarch64-unknown-linux-gnu',
  'sysroot',
)

test('napiCrossToolchainEnvs points the build at the downloaded toolchain', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin' },
  )

  t.is(
    envs.CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER,
    join(napiCrossToolchainPath, 'bin', 'aarch64-unknown-linux-gnu-gcc'),
  )
  t.is(envs.TARGET_SYSROOT, napiCrossDownloadedSysroot)
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, `--sysroot=${napiCrossDownloadedSysroot}`)
  t.is(envs.PATH, `${napiCrossToolchainPath}/bin:/usr/bin`)
  // gcc is the default compiler, so no clang-specific flags are set.
  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs respects a user-provided TARGET_SYSROOT', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_SYSROOT: '/opt/custom-sysroot' },
  )

  // The user's value wins: it is not overridden...
  t.is(envs.TARGET_SYSROOT, undefined)
  // ...and the derived flags use it.
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, '--sysroot=/opt/custom-sysroot')
})

test('napiCrossToolchainEnvs treats an empty TARGET_SYSROOT as unset', (t) => {
  // `setEnvIfNotExists` uses falsy semantics (`!process.env[env]`), so a
  // present-but-empty `TARGET_SYSROOT` still gets the downloaded sysroot
  // written to the build environment — the flags derived from the effective
  // sysroot must follow the same rule instead of producing `--sysroot=`.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_SYSROOT: '' },
  )

  t.is(envs.TARGET_SYSROOT, napiCrossDownloadedSysroot)
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, `--sysroot=${napiCrossDownloadedSysroot}`)
})

test('napiCrossToolchainEnvs derives clang flags from the effective sysroot', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {
      PATH: '/usr/bin',
      // Present-but-empty values must fall back to the downloaded sysroot.
      TARGET_SYSROOT: '',
      TARGET_CC: 'clang',
      TARGET_CXX: 'clang++',
      TARGET_CFLAGS: '-O2',
    },
  )

  t.is(
    envs.TARGET_CFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} -O2`,
  )
  t.is(
    envs.TARGET_CXXFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `,
  )
})

test('napiCrossToolchainEnvs sets a bare toolchain PATH when the env has none', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {},
  )

  // No `:undefined` tail when the provided env has no PATH at all.
  t.is(envs.PATH, `${napiCrossToolchainPath}/bin`)
})

test('napiCrossToolchainEnvs recognizes path-qualified, prefixed and versioned clang', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  for (const [cc, cxx] of [
    ['/usr/bin/clang', '/opt/llvm/bin/clang++'],
    ['aarch64-linux-gnu-clang', 'aarch64-linux-gnu-clang++'],
    ['clang-18', 'clang++-18'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs ignores CC/CXX when the toolchain compiler is effective', (t) => {
  // With TARGET_CC/TARGET_CXX unset, the function itself exports the
  // toolchain gcc/g++ as TARGET_CC/TARGET_CXX — and cc-rs prefers TARGET_CC
  // over CC for cross builds, so a clang in CC/CXX never actually runs.
  // Injecting the clang-only `--gcc-toolchain=` flag here would hard-error
  // the gcc that does run.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', CC: '/usr/bin/clang', CXX: '/opt/llvm/bin/clang++' },
  )

  t.true(envs.TARGET_CC.endsWith('-gcc'))
  t.true(envs.TARGET_CXX.endsWith('-g++'))
  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs treats an empty TARGET_CC as unset for clang detection', (t) => {
  // Falsy semantics: a present-but-empty TARGET_CC still gets the toolchain
  // gcc written to the build environment, so the CC fallback must not
  // resurrect clang detection for a compiler that will not run.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: '', CC: '/usr/bin/clang' },
  )

  t.is(
    envs.TARGET_CC,
    join(napiCrossToolchainPath, 'bin', 'aarch64-unknown-linux-gnu-gcc'),
  )
  t.is(envs.TARGET_CFLAGS, undefined)
})

test('napiCrossToolchainEnvs lets a user TARGET_CC=clang win over CC=gcc', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: 'clang', CC: 'gcc' },
  )

  t.is(
    envs.TARGET_CFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `,
  )
  // The CXX side is untouched, so it stays on the toolchain g++ without
  // clang flags — each language is detected independently.
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs injects no flags on either side when only CC=clang is set', (t) => {
  // Both languages default to the toolchain gcc/g++; neither effective
  // compiler is clang, so neither flag set is injected.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', CC: 'clang' },
  )

  t.true(envs.TARGET_CC.endsWith('-gcc'))
  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs does not mistake non-clang tools for clang', (t) => {
  for (const [cc, cxx] of [
    ['gcc', 'g++'],
    ['x86_64-unknown-linux-gnu-gcc', 'x86_64-unknown-linux-gnu-g++'],
    // `clang-format` is a clang-family tool but not a compiler.
    ['clang-format', 'clang-format'],
    ['someclangthing', 'someclangthing'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs detects clang behind cc-rs wrapper and argument forms', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  // cc-rs parses the env value before executing it (`env_tool`): the value
  // is split on whitespace, a known wrapper prefix (`sccache clang`) runs
  // the second token, and an argument form (`clang -target …`) runs the
  // first token with the rest as arguments — clang runs in both cases.
  for (const [cc, cxx] of [
    ['sccache clang', 'sccache clang++'],
    ['ccache clang-18', 'ccache clang++-18'],
    ['distcc /usr/bin/clang', 'distcc /usr/bin/clang++'],
    [
      'clang -target aarch64-unknown-linux-gnu',
      'clang++ -target aarch64-unknown-linux-gnu',
    ],
    ['/usr/bin/clang --sysroot=/x', '/usr/bin/clang++ --sysroot=/x'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
  }
})

// Writes empty files at `relativePaths` under a fresh temp directory whose
// subdirectories contain spaces, mirroring installs like `/opt/LLVM 18`.
// Returns the temp directory root; removal is registered on `t.teardown`.
const makeCompilerFixture = (
  t: ExecutionContext,
  relativePaths: Array<string>,
): string => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'napi-clang-detect-'))
  t.teardown(() => rmSync(fixtureRoot, { recursive: true, force: true }))
  for (const relativePath of relativePaths) {
    const absolutePath = join(fixtureRoot, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, '')
  }
  return fixtureRoot
}

test('napiCrossToolchainEnvs matches clang in space-containing paths that exist on disk', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  // cc-rs's `env_tool` treats the WHOLE env value as the compiler when it
  // exists on the filesystem (`check_exe`) before any whitespace splitting,
  // so `TARGET_CC="<tmp>/LLVM 18/bin/clang"` runs clang — splitting it into
  // `<tmp>/LLVM` + `18/bin/clang` would miss the clang detection entirely.
  const fixtureRoot = makeCompilerFixture(t, [
    'LLVM 18/bin/clang',
    'LLVM 18/bin/clang++-17',
  ])
  const cc = join(fixtureRoot, 'LLVM 18', 'bin', 'clang')
  const cxx = join(fixtureRoot, 'LLVM 18', 'bin', 'clang++-17')
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
  )

  t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
  t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
})

test('napiCrossToolchainEnvs does not mistake existing space-containing non-clang paths for clang', (t) => {
  const fixtureRoot = makeCompilerFixture(t, [
    'app dir/bin/gcc',
    'app dir/bin/g++',
    // A clang-family tool that is not a compiler, in a space-containing path.
    'LLVM 18/bin/clang-format',
  ])
  for (const [cc, cxx] of [
    [
      join(fixtureRoot, 'app dir', 'bin', 'gcc'),
      join(fixtureRoot, 'app dir', 'bin', 'g++'),
    ],
    [
      join(fixtureRoot, 'LLVM 18', 'bin', 'clang-format'),
      join(fixtureRoot, 'LLVM 18', 'bin', 'clang-format'),
    ],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs splits space-containing paths that do not exist on disk', (t) => {
  // cc-rs only takes the whole value as a compiler path when it exists on
  // the filesystem; otherwise it splits on whitespace, so this value runs
  // `/nonexistent` with `dir/bin/clang` as an argument — never clang.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {
      PATH: '/usr/bin',
      TARGET_CC: '/nonexistent dir/bin/clang',
      TARGET_CXX: '/nonexistent dir/bin/clang++',
    },
  )

  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs does not mistake gcc with clang-ending arguments for clang', (t) => {
  // The basename of each WHOLE value below is `clang`, but none of them
  // exists as a file, so cc-rs splits on whitespace and runs gcc — clang
  // flags injected here would hard-error the gcc compile.
  for (const [cc, cxx] of [
    ['gcc --sysroot=/opt/clang', 'g++ --sysroot=/opt/clang'],
    ['gcc -B/opt/LLVM 18/bin/clang', 'g++ -B/opt/LLVM 18/bin/clang'],
    ['sccache gcc --sysroot=/opt/clang', 'sccache g++ --sysroot=/opt/clang'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs does not mistake wrapped or argument-form non-clang for clang', (t) => {
  for (const [cc, cxx] of [
    ['sccache gcc', 'sccache g++'],
    ['ccache gcc', 'ccache g++'],
    ['gcc -B/foo', 'g++ -B/foo'],
    // The compiler token behind the wrapper is still not a compiler.
    ['sccache clang-format', 'sccache clang-format'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
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
// Integration: an explicit threadless target controls the emitted loader and
// browser entry even when package config declares only the threaded flavor.
test('explicit WASI build target selects the browser flavor', (t) => {
  const target = selectWasiBrowserTarget(
    parseTriple('wasm32-wasip1'),
    [parseTriple('wasm32-wasip1-threads')],
    [parseTriple('wasm32-wasip1')],
  )

  t.is(target?.platformArchABI, 'wasm32-wasip1')
})

test('untyped WASI browser entry forwards the default export', async (t) => {
  const { projectDir } = t.context
  const packageName = 'untyped-browser-entry-wasm32-wasip1'
  const packageDir = join(projectDir, 'node_modules', packageName)
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      type: 'module',
      exports: './index.js',
    }),
  )
  await writeFile(
    join(packageDir, 'index.js'),
    'export default { answer: 42 }\n',
  )
  const entryPath = join(projectDir, 'browser.mjs')
  await writeFile(
    entryPath,
    createWasiBrowserEntry('untyped-browser-entry', 'wasm32-wasip1', []),
  )

  const binding = await import(
    `${pathToFileURL(entryPath).href}?test=${Date.now()}`
  )
  t.is(binding.default.answer, 42)
  t.is(
    createWasiBrowserEntry('typed-browser-entry', 'wasm32-wasip1', ['sum']),
    "export * from 'typed-browser-entry-wasm32-wasip1'\n",
  )
})

test('deferred WASI declarations preserve typed and untyped bindings', (t) => {
  t.true(
    createWasiDeferredBindingTypeDef('./binding.wasip1.cjs', true).includes(
      "export type WasiBinding = typeof import('./binding.wasip1.cjs')",
    ),
  )
  const untyped = createWasiDeferredBindingTypeDef(
    './binding.wasip1.cjs',
    false,
  )
  t.true(untyped.includes('export type WasiBinding = Record<string, unknown>'))
  t.false(untyped.includes("import('./binding.wasip1.cjs')"))
})

test('direct untyped wasm32-wasip1 build emits complete browser and workerd entries', async (t) => {
  // The wasm32-wasip1 build needs the rust target; the cli test suite runs on
  // lanes that only install the host toolchain, so skip when unavailable.
  // Exact per-line match: a substring probe would be satisfied by a listing
  // containing only `wasm32-wasip1-threads`.
  const targetLibDir = execSync(
    'rustc --print target-libdir --target wasm32-wasip1',
    {
      encoding: 'utf8',
    },
  ).trim()
  if (
    !existsSync(targetLibDir) ||
    !(await readdir(targetLibDir)).some((file) => file.startsWith('libcore-'))
  ) {
    t.pass('skipped: wasm32-wasip1 rust target is not installed')
    return
  }

  const { projectDir } = t.context
  const crateName = 'wasip1_direct'
  const binaryName = 'wasip1-direct'
  const packageName = 'wasip1-direct'
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

  await writeFile(
    join(projectDir, 'Cargo.toml'),
    `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]
`,
  )
  await writeFile(join(projectDir, 'src', 'lib.rs'), '')

[dependencies]
napi = { path = "${napiPath}", default-features = false, features = ["napi4"] }
napi-derive = { path = "${napiDerivePath}", default-features = false, features = ["strict"] }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`,
  )
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'cross-flags-check',
        version: '0.1.0',
        napi: { binaryName: 'cross-flags-check' },
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: ['wasm32-wasip1-threads'],
        },
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
  await writeFile(
    join(projectDir, 'build.rs'),
    'fn main() {\n    napi_build::setup();\n}\n',
  )
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  )

  // `setWasiEnv` requires @emnapi/core and @emnapi/runtime resolvable from
  // the project with versions matching the cli's own `emnapi` package.
  const emnapiVersion = JSON.parse(
    await readFile(
      join(repoRoot, 'node_modules', 'emnapi', 'package.json'),
      'utf-8',
    ),
  ).version
  for (const pkg of ['@emnapi/core', '@emnapi/runtime']) {
    const pkgDir = join(projectDir, 'node_modules', pkg)
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkg, version: emnapiVersion, main: 'index.js' }),
    )
    await writeFile(
      join(pkgDir, 'index.js'),
      `module.exports = { version: "${emnapiVersion}" }`,
    )
  }

  // `buildProject` resolves to `{ task }` without awaiting the build; the
  // cargo compile + postBuild run on the returned task promise.
  const { task } = await buildProject({
    platform: true,
    target: 'wasm32-wasip1',
    cwd: projectDir,
  })
  await task

  // the build emitted the wasip1-named loader set...
  t.true(existsSync(join(projectDir, `${binaryName}.wasip1.cjs`)))
  t.true(existsSync(join(projectDir, `${binaryName}.wasip1.d.cts`)))
  t.true(existsSync(join(projectDir, `${binaryName}.wasip1-browser.js`)))
  t.true(existsSync(join(projectDir, `${binaryName}.wasip1-deferred.js`)))
  t.true(existsSync(join(projectDir, `${binaryName}.wasip1-deferred.d.ts`)))
  t.false(existsSync(join(projectDir, `${binaryName}.wasi.cjs`)))

  // The built flavor still participates in the fallback chain even though it
  // differs from the configured flavor.
  const js = await readFile(join(projectDir, 'index.js'), 'utf-8')
  t.regex(js, new RegExp(`require\\('\\./${binaryName}\\.wasip1\\.cjs'\\)`))
  t.regex(js, new RegExp(`require\\('${packageName}-wasm32-wasip1'\\)`))
  t.is(
    await readFile(join(projectDir, 'browser.js'), 'utf8'),
    `export * from '${packageName}-wasm32-wasip1'\nexport { default } from '${packageName}-wasm32-wasip1'\n`,
  )
  const workerdTypeDef = await readFile(
    join(projectDir, `${binaryName}.wasip1-deferred.d.ts`),
    'utf8',
  )
  t.true(
    workerdTypeDef.includes(
      'export type WasiBinding = Record<string, unknown>',
    ),
  )
  t.false(workerdTypeDef.includes(`import('${packageName}')`))
  t.is(
    await readFile(join(projectDir, `${binaryName}.wasip1.d.cts`), 'utf8'),
    `${DEFAULT_TYPE_DEF_HEADER}
declare const binding: Record<string, unknown>
export = binding
`,
  )
  t.false(existsSync(join(projectDir, 'index.d.ts')))
})
