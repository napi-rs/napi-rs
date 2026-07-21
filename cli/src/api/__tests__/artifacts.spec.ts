import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { collectArtifacts } from '../artifacts.js'

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
