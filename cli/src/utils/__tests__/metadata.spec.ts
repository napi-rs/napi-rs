import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'

import { parseMetadata } from '../metadata.js'

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
