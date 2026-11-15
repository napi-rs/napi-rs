import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'

import { parseMetadata } from '../metadata.js'

test('should decode UTF-8 split across cargo metadata output chunks', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-rs-metadata-utf8-'))
  const manifestPath = join(dir, 'Cargo.toml')
  const payload = JSON.stringify({ packages: [], workspace_root: '/tmp/日本' })
  const split = Buffer.from(payload).indexOf(Buffer.from('日')) + 1
  const cargoPath = join(dir, 'cargo')
  await writeFile(
    cargoPath,
    `#!/usr/bin/env node
const bytes = Buffer.from(${JSON.stringify(payload)})
process.stdout.write(bytes.subarray(0, ${split}))
setTimeout(() => process.stdout.write(bytes.subarray(${split})), 50)
`,
  )
  await chmod(cargoPath, 0o755)
  await writeFile(manifestPath, '[package]\nname = "test"\nversion = "0.0.0"\n')
  const originalPath = process.env.PATH
  process.env.PATH = `${dir}:${originalPath}`
  try {
    const metadata = await parseMetadata(manifestPath)
    t.is(metadata.workspace_root, '/tmp/日本')
  } finally {
    process.env.PATH = originalPath
    await rm(dir, { recursive: true, force: true })
  }
})
