import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { collectArtifacts } from '../artifacts.js'

const test = ava as TestFn<{
  tmpDir: string
}>

test.beforeEach(async (t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `artifacts-${timestamp}-${random}`,
  )
  await mkdir(tmpDir, { recursive: true })
  t.context = { tmpDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

interface WasiFlavorFixture {
  /** rust triple declared in `napi.targets` */
  target: string
  /** expected `platformArchABI` (npm dir name + wasm artifact suffix) */
  platformArchABI: string
  /** expected loader file suffix (`wasi` | `wasip1`) */
  loaderSuffix: string
  hasThreads: boolean
  withDeferredLoader: boolean
}

async function setupWasiProject(
  tmpDir: string,
  binaryName: string,
  flavors: WasiFlavorFixture[],
) {
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify(
      {
        name: binaryName,
        version: '1.0.0',
        napi: {
          binaryName,
          targets: flavors.map((flavor) => flavor.target),
        },
      },
      null,
      2,
    ),
  )

  // CI artifacts dir with the built wasm binaries
  const artifactsDir = join(tmpDir, 'artifacts')
  await mkdir(artifactsDir, { recursive: true })

  const wasiDirs: string[] = []
  for (const flavor of flavors) {
    // dist dirs normally created by `napi create-npm-dirs`
    const wasiDir = join(tmpDir, 'npm', flavor.platformArchABI)
    await mkdir(wasiDir, { recursive: true })
    wasiDirs.push(wasiDir)

    await writeFile(
      join(artifactsDir, `${binaryName}.${flavor.platformArchABI}.wasm`),
      `wasm ${flavor.platformArchABI}`,
    )

    // loader files emitted next to package.json by the build
    await writeFile(
      join(tmpDir, `${binaryName}.${flavor.loaderSuffix}.cjs`),
      `// cjs loader ${flavor.platformArchABI}`,
    )
    await writeFile(
      join(tmpDir, `${binaryName}.${flavor.loaderSuffix}-browser.js`),
      `// browser loader ${flavor.platformArchABI}`,
    )
    if (flavor.hasThreads) {
      await writeFile(join(tmpDir, 'wasi-worker.mjs'), '// worker')
      await writeFile(
        join(tmpDir, 'wasi-worker-browser.mjs'),
        '// browser worker',
      )
    }
    if (flavor.withDeferredLoader) {
      await writeFile(
        join(tmpDir, `${binaryName}.${flavor.loaderSuffix}-deferred.js`),
        '// deferred loader',
      )
    }
  }

  return wasiDirs
}

test('should copy the deferred loader into the wasm32-wasip1 npm dir when present', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-deferred'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])

  await collectArtifacts({ cwd: tmpDir })

  t.is(
    await readFile(join(wasiDir, `${binaryName}.wasip1-deferred.js`), 'utf-8'),
    '// deferred loader',
  )
  // sibling loaders are still collected
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1.cjs`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1-browser.js`)))
  // worker scripts belong to the threaded flavor only
  t.false(existsSync(join(wasiDir, 'wasi-worker.mjs')))
  t.false(existsSync(join(wasiDir, 'wasi-worker-browser.mjs')))
})

test('should tolerate a missing deferred loader for threaded WASI builds', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-threaded'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasi-preview1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])

  // must not throw even though the deferred loader was never emitted
  await collectArtifacts({ cwd: tmpDir })

  t.false(existsSync(join(wasiDir, `${binaryName}.wasi-deferred.js`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasi.cjs`)))
  t.true(existsSync(join(wasiDir, 'wasi-worker.mjs')))
  t.true(existsSync(join(wasiDir, 'wasi-worker-browser.mjs')))
})

test('should route both WASI flavors into their own npm dirs side by side', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-flavors'
  // Declare the NON-threaded flavor first: `wasm32-wasi` is a prefix of
  // `wasm32-wasip1`, so substring dist-dir matching would bind the threaded
  // wasm to the non-threaded dir. Exact basename matching must not.
  const [singleDir, threadedDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
    {
      target: 'wasm32-wasip1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])

  await collectArtifacts({ cwd: tmpDir })

  // each flavor's wasm landed in ITS dir (exact-match, not prefix-match)
  t.is(
    await readFile(
      join(threadedDir, `${binaryName}.wasm32-wasi.wasm`),
      'utf-8',
    ),
    'wasm wasm32-wasi',
  )
  t.is(
    await readFile(
      join(singleDir, `${binaryName}.wasm32-wasip1.wasm`),
      'utf-8',
    ),
    'wasm wasm32-wasip1',
  )
  t.false(existsSync(join(singleDir, `${binaryName}.wasm32-wasi.wasm`)))
  t.false(existsSync(join(threadedDir, `${binaryName}.wasm32-wasip1.wasm`)))

  // per-flavor loader sets
  t.true(existsSync(join(threadedDir, `${binaryName}.wasi.cjs`)))
  t.true(existsSync(join(threadedDir, `${binaryName}.wasi-browser.js`)))
  t.true(existsSync(join(threadedDir, 'wasi-worker.mjs')))
  t.true(existsSync(join(threadedDir, 'wasi-worker-browser.mjs')))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1.cjs`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1-browser.js`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1-deferred.js`)))
  t.false(existsSync(join(singleDir, 'wasi-worker.mjs')))
  t.false(existsSync(join(singleDir, 'wasi-worker-browser.mjs')))
})
