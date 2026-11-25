import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava from 'ava'

import {
  WASI_ARTIFACT_METADATA_PREFIX as PUBLIC_PREFIX,
  parseWasiArtifactMetadata as publicParse,
  readWasiArtifactMetadata as publicRead,
  readWasiArtifactMetadataSync as publicReadSync,
} from '../../index.js'
import {
  WASI_ARTIFACT_METADATA_PREFIX,
  parseWasiArtifactMetadata,
  readWasiArtifactMetadata,
  readWasiArtifactMetadataSync,
} from '../wasi-metadata.js'

const test = ava

test('re-exports WASI metadata helpers from package root', (t) => {
  t.is(PUBLIC_PREFIX, WASI_ARTIFACT_METADATA_PREFIX)
  t.is(publicParse, parseWasiArtifactMetadata)
  t.is(publicRead, readWasiArtifactMetadata)
  t.is(publicReadSync, readWasiArtifactMetadataSync)
})

test('parseWasiArtifactMetadata returns undefined when header prefix is absent', (t) => {
  t.is(parseWasiArtifactMetadata(''), undefined)
  t.is(
    parseWasiArtifactMetadata('/* eslint-disable */\nmodule.exports = {}'),
    undefined,
  )
  t.is(
    parseWasiArtifactMetadata(
      `// comment\n${WASI_ARTIFACT_METADATA_PREFIX}{"version":2,"rootEntry":null,"managedRootEntries":[]}\n`,
    ),
    undefined,
  )
})

test('parseWasiArtifactMetadata parses v1 and v2 metadata and deduplicates managedRootEntries', (t) => {
  const v1 = parseWasiArtifactMetadata(
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 1,
      rootEntry: 'binding.cjs',
    })}\r\nmodule.exports = {}\r\n`,
  )
  t.deepEqual(v1, {
    version: 1,
    rootEntry: 'binding.cjs',
    managedRootEntries: ['browser.js', 'binding.cjs'],
  })

  const v1NullRoot = parseWasiArtifactMetadata(
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 1,
      rootEntry: null,
    })}\n`,
  )
  t.deepEqual(v1NullRoot, {
    version: 1,
    rootEntry: null,
    managedRootEntries: ['browser.js'],
  })

  const v1BrowserRoot = parseWasiArtifactMetadata(
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 1,
      rootEntry: 'browser.js',
    })}\n`,
  )
  t.deepEqual(v1BrowserRoot, {
    version: 1,
    rootEntry: 'browser.js',
    managedRootEntries: ['browser.js'],
  })

  const v2 = parseWasiArtifactMetadata(
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 2,
      rootEntry: 'index.js',
      exports: ['sum', 'mul'],
      managedRootEntries: ['browser.js', 'index.js', 'browser.js', 'test.wasm'],
    })}\nmodule.exports = {}\n`,
  )
  t.deepEqual(v2, {
    version: 2,
    rootEntry: 'index.js',
    exports: ['sum', 'mul'],
    managedRootEntries: ['browser.js', 'index.js', 'test.wasm'],
  })
})

test('parseWasiArtifactMetadata throws descriptive errors on invalid JSON or schema', (t) => {
  const jsonErr = t.throws(
    () =>
      parseWasiArtifactMetadata(
        `${WASI_ARTIFACT_METADATA_PREFIX}{not-json}\n`,
        'pkg/loader.wasi.cjs',
      ),
    { message: 'Invalid WASI artifact metadata in pkg/loader.wasi.cjs' },
  )
  t.truthy(jsonErr?.cause)

  t.throws(
    () =>
      parseWasiArtifactMetadata(`${WASI_ARTIFACT_METADATA_PREFIX}{not-json}\n`),
    { message: 'Invalid WASI artifact metadata' },
  )

  for (const payload of [
    null,
    42,
    { version: 3, rootEntry: null, managedRootEntries: [] },
    { version: 2, rootEntry: 123, managedRootEntries: [] },
    { version: 2, rootEntry: null, managedRootEntries: 'browser.js' },
    { version: 2, rootEntry: null, managedRootEntries: ['browser.js', 1] },
    {
      version: 2,
      rootEntry: null,
      managedRootEntries: ['browser.js'],
      exports: 'sum',
    },
    {
      version: 2,
      rootEntry: null,
      managedRootEntries: ['browser.js'],
      exports: ['sum', 2],
    },
  ]) {
    t.throws(
      () =>
        parseWasiArtifactMetadata(
          `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify(payload)}\n`,
          'loader.wasip1.cjs',
        ),
      { message: 'Unsupported WASI artifact metadata in loader.wasip1.cjs' },
    )
  }
})

test('readWasiArtifactMetadata and readWasiArtifactMetadataSync read files from disk', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-rs-wasi-metadata-'))
  t.teardown(() => rm(dir, { recursive: true, force: true }))

  const validFile = join(dir, 'addon.wasip1.cjs')
  await writeFile(
    validFile,
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 2,
      rootEntry: 'index.js',
      exports: ['add'],
      managedRootEntries: ['browser.js', 'index.js', 'browser.js'],
    })}\nmodule.exports = {}\n`,
  )
  const expected = {
    version: 2,
    rootEntry: 'index.js',
    exports: ['add'],
    managedRootEntries: ['browser.js', 'index.js'],
  }
  t.deepEqual(await readWasiArtifactMetadata(validFile), expected)
  t.deepEqual(readWasiArtifactMetadataSync(validFile), expected)

  const plainFile = join(dir, 'plain.cjs')
  await writeFile(plainFile, 'module.exports = {}\n')
  t.is(await readWasiArtifactMetadata(plainFile), undefined)
  t.is(readWasiArtifactMetadataSync(plainFile), undefined)

  const invalidFile = join(dir, 'invalid.wasip1.cjs')
  await writeFile(invalidFile, `${WASI_ARTIFACT_METADATA_PREFIX}{bad\n`)
  await t.throwsAsync(() => readWasiArtifactMetadata(invalidFile), {
    message: `Invalid WASI artifact metadata in ${invalidFile}`,
  })
  t.throws(() => readWasiArtifactMetadataSync(invalidFile), {
    message: `Invalid WASI artifact metadata in ${invalidFile}`,
  })
})
