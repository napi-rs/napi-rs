import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { collectArtifacts } from '../artifacts.js'
import { WASI_ARTIFACT_METADATA_PREFIX } from '../build.js'

const test = ava as TestFn<{ tmpDir: string }>

test.beforeEach(async (t) => {
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `artifacts-spec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  await mkdir(tmpDir, { recursive: true })
  t.context = { tmpDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('resolves a relative WASI build output directory from cwd', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'wasi-artifact'
  const packageName = '@napi-rs/wasi-artifact'
  const buildOutputDir = join(tmpDir, 'build-output')
  const wasiPackageDir = join(tmpDir, 'npm', 'wasm32-wasi')

  await Promise.all([
    mkdir(join(tmpDir, 'artifacts'), { recursive: true }),
    mkdir(buildOutputDir, { recursive: true }),
    mkdir(wasiPackageDir, { recursive: true }),
  ])
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      napi: {
        binaryName,
        targets: ['wasm32-wasi-preview1-threads'],
      },
    }),
  )

  const browserEntry =
    "const worker = new URL('./wasi-worker-browser.mjs', import.meta.url)\n"
  await Promise.all([
    writeFile(
      join(tmpDir, 'artifacts', `${binaryName}.wasm32-wasi.wasm`),
      'wasm artifact',
    ),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), 'node binding'),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'node binding types',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'node worker'),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      browserEntry,
    ),
    writeFile(
      join(buildOutputDir, 'wasi-worker-browser.mjs'),
      'browser worker',
    ),
    writeFile(join(buildOutputDir, 'browser.js'), 'root browser'),
    writeFile(join(buildOutputDir, 'index.js'), 'root index'),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(
    await readFile(
      join(wasiPackageDir, `${binaryName}.wasm32-wasi.wasm`),
      'utf8',
    ),
    'wasm artifact',
  )
  t.is(
    await readFile(join(wasiPackageDir, `${binaryName}.wasi.cjs`), 'utf8'),
    'node binding',
  )
  t.is(
    await readFile(join(wasiPackageDir, 'wasi-worker.mjs'), 'utf8'),
    'node worker',
  )
  t.is(
    await readFile(join(wasiPackageDir, 'wasi-worker-browser.mjs'), 'utf8'),
    'browser worker',
  )
  t.is(
    await readFile(
      join(wasiPackageDir, `${binaryName}.wasi-browser.js`),
      'utf8',
    ),
    browserEntry.replace(
      "new URL('./wasi-worker-browser.mjs', import.meta.url)",
      `new URL('${packageName}-wasm32-wasi/wasi-worker-browser.mjs', import.meta.url)`,
    ),
  )
})

test('keeps the generated WASI root entry when package.json#main is a handwritten wrapper', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'mixed-entry'
  const packageName = '@napi-rs/mixed-entry'
  const artifactsDir = join(tmpDir, 'artifacts')

  // Mirrors packages like @node-rs/bcrypt: `main` points at a handwritten
  // `index.js` wrapper while `napi build --js binding.js` generates the
  // loader under a different name recorded as `rootEntry` in the WASI
  // loader metadata.
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: [
      'browser.js',
      'binding.js',
      `${binaryName}.wasm`,
      `${binaryName}.debug.wasm`,
    ],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(artifactsDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(artifactsDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(artifactsDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(artifactsDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    // The generated loader sits at the package root alongside the wrapper,
    // next to neither the `.node` artifact nor `package.json#main`.
    writeFile(join(tmpDir, 'binding.js'), 'module.exports = {}\n'),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = {}\n'),
  ])

  await collectArtifacts({ cwd: tmpDir })

  // `binding.js` is a managed root entry that `package.json#main` does not
  // cover; it must be kept rather than swept as a stale destination.
  t.is(
    await readFile(join(tmpDir, 'binding.js'), 'utf8'),
    'module.exports = {}\n',
  )
  t.is(
    await readFile(join(tmpDir, 'index.js'), 'utf8'),
    'module.exports = {}\n',
  )
})
