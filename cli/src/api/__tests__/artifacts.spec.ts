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

async function setupWasiProject(
  tmpDir: string,
  binaryName: string,
  target: string,
  withDeferredLoader: boolean,
) {
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify(
      {
        name: binaryName,
        version: '1.0.0',
        napi: {
          binaryName,
          targets: [target],
        },
      },
      null,
      2,
    ),
  )

  // dist dirs normally created by `napi create-npm-dirs`
  const wasiDir = join(tmpDir, 'npm', 'wasm32-wasi')
  await mkdir(wasiDir, { recursive: true })

  // CI artifacts dir with the built wasm binary
  const artifactsDir = join(tmpDir, 'artifacts')
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm')

  // loader files emitted next to package.json by the build
  await writeFile(join(tmpDir, `${binaryName}.wasi.cjs`), '// cjs loader')
  await writeFile(
    join(tmpDir, `${binaryName}.wasi-browser.js`),
    '// browser loader',
  )
  await writeFile(join(tmpDir, 'wasi-worker.mjs'), '// worker')
  await writeFile(join(tmpDir, 'wasi-worker-browser.mjs'), '// browser worker')
  if (withDeferredLoader) {
    await writeFile(
      join(tmpDir, `${binaryName}.wasi-deferred.js`),
      '// deferred loader',
    )
  }

  return wasiDir
}

test('should copy the deferred loader into the wasm32-wasi npm dir when present', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-deferred'
  const wasiDir = await setupWasiProject(
    tmpDir,
    binaryName,
    'wasm32-wasip1',
    true,
  )

  await collectArtifacts({ cwd: tmpDir })

  t.is(
    await readFile(join(wasiDir, `${binaryName}.wasi-deferred.js`), 'utf-8'),
    '// deferred loader',
  )
  // sibling loaders are still collected
  t.true(existsSync(join(wasiDir, `${binaryName}.wasi.cjs`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasi-browser.js`)))
  t.true(existsSync(join(wasiDir, 'wasi-worker.mjs')))
  t.true(existsSync(join(wasiDir, 'wasi-worker-browser.mjs')))
})

test('should tolerate a missing deferred loader for threaded WASI builds', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-threaded'
  const wasiDir = await setupWasiProject(
    tmpDir,
    binaryName,
    'wasm32-wasi-preview1-threads',
    false,
  )

  // must not throw even though the deferred loader was never emitted
  await collectArtifacts({ cwd: tmpDir })

  t.false(existsSync(join(wasiDir, `${binaryName}.wasi-deferred.js`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasi.cjs`)))
})
