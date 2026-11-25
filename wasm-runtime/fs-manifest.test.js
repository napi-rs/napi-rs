import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveModuleFilePath } from './resolve-module-file-path.js'

const runtimeDirectory = process.env.WASM_RUNTIME_TEST_PACKAGE
  ? resolve(process.env.WASM_RUNTIME_TEST_PACKAGE)
  : dirname(fileURLToPath(import.meta.url))

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

test('dist/fs.packages.json and dist/THIRD-PARTY-LICENSE describe bundled dist/fs.js packages deterministically', async () => {
  const [manifestRaw, licenseRaw, packageJsonRaw] = await Promise.all([
    readFile(join(runtimeDirectory, 'dist', 'fs.packages.json'), 'utf8'),
    readFile(join(runtimeDirectory, 'dist', 'THIRD-PARTY-LICENSE'), 'utf8'),
    readFile(join(runtimeDirectory, 'package.json'), 'utf8'),
  ])

  const pkg = JSON.parse(packageJsonRaw)
  assert.ok(
    pkg.files.includes('dist/fs.packages.json'),
    'package.json#files must ship dist/fs.packages.json',
  )
  assert.ok(
    pkg.files.includes('dist/THIRD-PARTY-LICENSE'),
    'package.json#files must ship dist/THIRD-PARTY-LICENSE',
  )
  assert.equal(pkg.exports['./fs.packages.json'], './dist/fs.packages.json')
  assert.equal(pkg.exports['./package.json'], './package.json')

  const manifest = JSON.parse(manifestRaw)
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.bundle, 'dist/fs.js')
  assert.ok(Array.isArray(manifest.packages) && manifest.packages.length > 0)

  // No local filesystem paths may leak into either shipped file.
  for (const [label, text] of [
    ['dist/fs.packages.json', manifestRaw],
    ['dist/THIRD-PARTY-LICENSE', licenseRaw],
  ]) {
    assert.ok(
      !text.includes(runtimeDirectory),
      `${label} must not contain local workspace paths`,
    )
    assert.ok(
      !/\/(?:Users|home)\/[^/\s]+\//.test(text),
      `${label} must not contain Unix home directory paths`,
    )
    assert.ok(
      !/[A-Za-z]:\\\\/.test(text),
      `${label} must not contain Windows drive paths`,
    )
    assert.ok(
      !text.includes('\r'),
      `${label} must use LF line endings consistently`,
    )
    assert.ok(text.endsWith('\n'), `${label} must end with a trailing newline`)
  }

  // Entries must be deduplicated, sorted by (name, version), and well-formed.
  const seen = new Set()
  for (let index = 0; index < manifest.packages.length; index++) {
    const entry = manifest.packages[index]
    assert.equal(typeof entry.name, 'string')
    assert.ok(entry.name.length > 0)
    assert.notEqual(entry.name, '@napi-rs/wasm-runtime')
    assert.equal(typeof entry.version, 'string')
    assert.ok(entry.version.length > 0)
    assert.equal(typeof entry.license, 'string')
    assert.ok(entry.license.length > 0)

    const key = `${entry.name}@${entry.version}`
    assert.ok(!seen.has(key), `duplicate package entry ${key}`)
    seen.add(key)

    if (entry.licenseFile !== null) {
      assert.equal(typeof entry.licenseFile, 'string')
      assert.ok(
        !entry.licenseFile.includes('/') && !entry.licenseFile.includes('\\'),
        `licenseFile must be a relative basename, got ${entry.licenseFile}`,
      )
      assert.equal(typeof entry.licenseText, 'string')
      assert.ok(entry.licenseText.length > 0)
    }

    if (index > 0) {
      const previous = manifest.packages[index - 1]
      const cmp =
        compareCodeUnits(previous.name, entry.name) ||
        compareCodeUnits(previous.version, entry.version)
      assert.ok(
        cmp < 0,
        `packages must be sorted by name then version: ${previous.name}@${previous.version} vs ${key}`,
      )
    }

    assert.ok(
      licenseRaw.includes(`${key}\nLicense: ${entry.license}`),
      `dist/THIRD-PARTY-LICENSE must include ${key}`,
    )
  }

  const packageNames = new Set(manifest.packages.map((entry) => entry.name))
  for (const expected of [
    '@jsonjoy.com/fs-core',
    '@jsonjoy.com/fs-node',
    'abort-controller',
    'buffer',
    'events',
    'glob-to-regex.js',
    'ieee754',
    'memfs',
    'path-browserify',
    'process',
    'readable-stream',
    'string_decoder',
    'thingies',
    'tslib',
  ]) {
    assert.ok(
      packageNames.has(expected),
      `dist/fs.packages.json must include bundled package ${expected}`,
    )
  }
})

test('resolveModuleFilePath preserves literal # in directory paths and strips bundler query/fragment suffixes', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'wasm-runtime-manifest-'))
  try {
    // Create both an ancestor-prefix directory (`napi`) and a checkout directory
    // containing `#` (`napi#3740`) to ensure stripping never stops at a directory.
    const ancestorDir = join(tempRoot, 'napi')
    const pkgDir = join(tempRoot, 'napi#3740', 'pkg')
    const entryFile = join(pkgDir, 'index.js')
    await mkdir(ancestorDir, { recursive: true })
    await mkdir(pkgDir, { recursive: true })
    await writeFile(entryFile, 'export const ok = true\n')

    assert.equal(resolveModuleFilePath(entryFile), entryFile)
    assert.equal(
      resolveModuleFilePath(`${entryFile}?commonjs-entry`),
      entryFile,
    )
    assert.equal(resolveModuleFilePath(`${entryFile}?a=1#frag`), entryFile)
    assert.equal(
      resolveModuleFilePath(`${entryFile}?${'a'.repeat(300)}`),
      entryFile,
    )

    const missingFile = join(pkgDir, 'missing.js')
    assert.notEqual(resolveModuleFilePath(missingFile), ancestorDir)
    assert.equal(resolveModuleFilePath(missingFile), missingFile)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
