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
import { test } from 'node:test'
import assert from 'node:assert'

import { generateTypeDef, writeJsBinding } from '../build.js'
import { getSystemDefaultTarget } from '../../utils/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

test('build pipeline generates bindings and artifacts', async () => {
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

  try {
    await runTest(projectDir, typeDefDir)
  } finally {
    if (existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true })
    }
  }
})

async function runTest(projectDir: string, typeDefDir: string) {
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
  assert.ok(files.length > 0, 'type definition files should be generated')

  const exports = await generateTypeDef({
    typeDefDir,
    outputDir: projectDir,
    cwd: projectDir,
  })

  assert.ok(exports.includes('sum'), 'generateTypeDef should expose napi exports')

  const jsBinding = await writeJsBinding({
    platform: true,
    idents: exports,
    binaryName,
    packageName,
    version,
    outputDir: projectDir,
  })

  assert.ok(jsBinding)
  assert.strictEqual(jsBinding?.path, join(projectDir, 'index.js'))

  const libName = crateName.replace(/-/g, '_')
  const srcName =
    target.platform === 'darwin'
      ? `lib${libName}.dylib`
      : target.platform === 'win32'
        ? `${libName}.dll`
        : `lib${libName}.so`
  const profile = 'debug'
  const srcPath = join(projectDir, 'target', target.triple, profile, srcName)
  assert.ok(existsSync(srcPath), 'compiled artifact should exist')

  const destName = `${binaryName}.${target.platformArchABI}.${srcName.endsWith('.wasm') ? 'wasm' : 'node'}`
  const destPath = join(projectDir, destName)
  await copyFile(srcPath, destPath)
  assert.ok(existsSync(destPath), 'artifact should be copied to output directory')

  const nodeStat = await stat(destPath)
  assert.ok(nodeStat.size > 0)

  const dtsPath = join(projectDir, 'index.d.ts')
  assert.ok(existsSync(dtsPath))
  const dtsContent = await readFile(dtsPath, 'utf-8')
  assert.match(
    dtsContent,
    /export declare function sum\(a: number, b: number\): number/,
  )

  const jsPath = join(projectDir, 'index.js')
  assert.ok(existsSync(jsPath))
  const jsContent = await readFile(jsPath, 'utf-8')
  assert.match(jsContent, /module\.exports\.sum = nativeBinding\.sum/)
}
