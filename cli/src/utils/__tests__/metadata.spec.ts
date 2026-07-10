import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  createCargoMetadataInvocation,
  getNapiDeriveDependentCrates,
  parseMetadata,
} from '../metadata.js'

const FIXTURE_WORKSPACE = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'optional-napi-derive',
)

test('metadata invocation preserves graph-affecting build context', (t) => {
  const cwd = join(tmpdir(), 'napi-rs-metadata-cwd')
  const manifestPath = join(cwd, 'workspace', 'Cargo.toml')
  const invocation = createCargoMetadataInvocation(manifestPath, {
    cwd,
    featurePackage: 'fixture',
    features: ['zeta,dependency/alpha'],
    noDefaultFeatures: true,
    filterPlatform: 'wasm32-wasip1',
    cargoOptions: [
      '--config',
      'patch.crates-io.local.path="../local"',
      '--offline',
      '-Fbeta',
      '--message-format=json',
    ],
  })

  t.is(invocation.cwd, cwd)
  t.deepEqual(invocation.args, [
    '--config',
    'patch.crates-io.local.path="../local"',
    'metadata',
    '--manifest-path',
    manifestPath,
    '--format-version',
    '1',
    '--offline',
    '--features',
    'dependency/alpha,fixture/beta,fixture/zeta',
    '--no-default-features',
    '--filter-platform',
    'wasm32-wasip1',
  ])
})

test('should surface child process startup errors', async (t) => {
  const manifestPath = join(
    tmpdir(),
    `napi-rs-metadata-${process.pid}-${Date.now()}.toml`,
  )
  const originalPath = process.env.PATH

  await writeFile(manifestPath, '[package]\nname = "test"\nversion = "0.0.0"\n')
  process.env.PATH = ''

  try {
    const error = await t.throwsAsync(() => parseMetadata(manifestPath))
    t.truthy(error)
    t.is(error?.message, 'cargo metadata failed to run')
    t.is((error?.cause as NodeJS.ErrnoException | undefined)?.code, 'ENOENT')
  } finally {
    process.env.PATH = originalPath
    await unlink(manifestPath)
  }
})

test('should exclude crates whose optional napi-derive dependency is disabled', async (t) => {
  const metadata = await parseMetadata(
    join(FIXTURE_WORKSPACE, 'main-crate', 'Cargo.toml'),
  )
  const dependentCrates = getNapiDeriveDependentCrates(metadata).map(
    (crate) => crate.name,
  )
  t.deepEqual(dependentCrates, ['main-crate'])
})

test('should include crates whose optional napi-derive dependency is enabled via build features', async (t) => {
  const metadata = await parseMetadata(
    join(FIXTURE_WORKSPACE, 'with-optional-derive', 'Cargo.toml'),
    {
      features: ['node'],
    },
  )
  const dependentCrates = getNapiDeriveDependentCrates(metadata).map(
    (crate) => crate.name,
  )
  t.true(dependentCrates.includes('with-optional-derive'))
})

test('should fall back to declared dependencies when the resolve graph is unavailable', async (t) => {
  const metadata = await parseMetadata(
    join(FIXTURE_WORKSPACE, 'main-crate', 'Cargo.toml'),
  )
  metadata.resolve = null
  const dependentCrates = getNapiDeriveDependentCrates(metadata)
    .map((crate) => crate.name)
    .sort()
  t.deepEqual(dependentCrates, ['main-crate', 'with-optional-derive'])
})
