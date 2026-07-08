import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'

import { createCargoMetadataInvocation, parseMetadata } from '../metadata.js'

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
