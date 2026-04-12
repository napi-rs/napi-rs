import { existsSync } from 'node:fs'
import { exec } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, dirname, resolve } from 'node:path'
import { join as posixJoin, sep as posixSep } from 'node:path/posix'
import { sep as win32Sep } from 'node:path/win32'
import { fileURLToPath } from 'node:url'

import ava, { type TestFn } from 'ava'

import { buildProject, generateTypeDef, writeJsBinding } from '../build.js'
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

test('useNapiCross passes a valid bindgen sysroot', async (t) => {
  const { projectDir, tmpDir } = t.context
  const crateName = 'napi_cross_env'
  const binaryName = 'napi-cross-env'
  const packageName = 'napi-cross-env'
  const version = '0.1.0'
  const targetTriple = 'aarch64-unknown-linux-gnu'
  const require = createRequire(import.meta.url)
  const { version: crossToolchainVersion } = require('@napi-rs/cross-toolchain')
  const toolchainPath = join(
    homedir(),
    '.napi-rs',
    'cross-toolchain',
    crossToolchainVersion,
    targetTriple,
  )
  const targetSysroot = join(toolchainPath, targetTriple, 'sysroot')
  const envLogPath = join(tmpDir, 'fake-cargo-env.json')
  const fakeCargoScriptPath = join(tmpDir, 'fake-cargo.cjs')
  const fakeCargoPath = join(
    tmpDir,
    process.platform === 'win32' ? 'fake-cargo.cmd' : 'fake-cargo',
  )
  const createdToolchainPath = !existsSync(toolchainPath)

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
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: [targetTriple],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(join(projectDir, 'src', 'lib.rs'), 'pub fn noop() {}\n')

  await writeFile(
    fakeCargoScriptPath,
    `const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const targetIndex = args.indexOf('--target')
const target = targetIndex === -1 ? '${targetTriple}' : args[targetIndex + 1]
const profile = args.includes('--release') ? 'release' : 'debug'
const outDir = path.join(process.cwd(), 'target', target, profile)

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'lib${crateName}.so'), '')
fs.writeFileSync(
  '${envLogPath.replaceAll('\\', '\\\\')}',
  JSON.stringify({
    BINDGEN_EXTRA_CLANG_ARGS: process.env.BINDGEN_EXTRA_CLANG_ARGS,
    TARGET_SYSROOT: process.env.TARGET_SYSROOT,
  }),
)
`,
  )
  if (process.platform === 'win32') {
    await writeFile(
      fakeCargoPath,
      `@"${process.execPath}" "${fakeCargoScriptPath}" %*\r\n`,
    )
  } else {
    await writeFile(
      fakeCargoPath,
      `#!/bin/sh
exec "${process.execPath}" "${fakeCargoScriptPath}" "$@"
`,
    )
    await chmod(fakeCargoPath, 0o755)
  }

  if (createdToolchainPath) {
    await mkdir(join(targetSysroot, 'usr', 'include'), { recursive: true })
    await mkdir(join(toolchainPath, 'bin'), { recursive: true })
    await writeFile(join(toolchainPath, 'package.json'), '{}\n')
  }

  const originalCargo = process.env.CARGO
  const originalBindgenArgs = process.env.BINDGEN_EXTRA_CLANG_ARGS
  const originalTargetSysroot = process.env.TARGET_SYSROOT
  delete process.env.BINDGEN_EXTRA_CLANG_ARGS
  delete process.env.TARGET_SYSROOT
  process.env.CARGO = fakeCargoPath

  try {
    const { task } = await buildProject({
      cwd: projectDir,
      target: targetTriple,
      useNapiCross: true,
    })
    await task
  } finally {
    if (originalCargo === undefined) {
      delete process.env.CARGO
    } else {
      process.env.CARGO = originalCargo
    }
    if (originalBindgenArgs === undefined) {
      delete process.env.BINDGEN_EXTRA_CLANG_ARGS
    } else {
      process.env.BINDGEN_EXTRA_CLANG_ARGS = originalBindgenArgs
    }
    if (originalTargetSysroot === undefined) {
      delete process.env.TARGET_SYSROOT
    } else {
      process.env.TARGET_SYSROOT = originalTargetSysroot
    }
    if (createdToolchainPath) {
      await rm(toolchainPath, { recursive: true, force: true })
    }
  }

  const envLog = JSON.parse(await readFile(envLogPath, 'utf-8')) as {
    BINDGEN_EXTRA_CLANG_ARGS?: string
    TARGET_SYSROOT?: string
  }

  t.is(envLog.TARGET_SYSROOT, targetSysroot)
  t.is(envLog.BINDGEN_EXTRA_CLANG_ARGS, `--sysroot=${targetSysroot}`)
  t.false(envLog.BINDGEN_EXTRA_CLANG_ARGS?.endsWith('}') ?? true)
})
