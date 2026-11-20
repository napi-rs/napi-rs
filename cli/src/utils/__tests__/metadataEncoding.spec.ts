import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'

import { parseMetadata } from '../metadata.js'

// A fake `cargo` must be an executable file, and spawning cannot run a
// Windows `.cmd` shim without a shell. The behaviour under test does not
// depend on the platform, so cover it on POSIX only.
const posixOnly = process.platform === 'win32' ? test.serial.skip : test.serial

const PIPE_READ_CHUNK_BYTES = 65536

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function withFakeCargo(
  scriptSource: string,
  run: (manifestPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'napi-rs-metadata-utf8-'))
  const manifestPath = join(dir, 'Cargo.toml')
  const scriptPath = join(dir, 'cargo.mjs')
  const cargoPath = join(dir, 'cargo')

  await writeFile(scriptPath, scriptSource)
  await writeFile(
    cargoPath,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(scriptPath)} "$@"\n`,
  )
  await chmod(cargoPath, 0o755)
  await writeFile(manifestPath, '[package]\nname = "test"\nversion = "0.0.0"\n')

  const originalPath = process.env.PATH
  process.env.PATH = originalPath ? `${dir}:${originalPath}` : dir
  try {
    await run(manifestPath)
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    await rm(dir, { recursive: true, force: true })
  }
}

posixOnly(
  'should decode UTF-8 split across cargo metadata stdout chunks',
  async (t) => {
    const workspaceRoot = '/tmp/日本'
    const probe = JSON.stringify({
      pad: '',
      packages: [],
      workspace_root: workspaceRoot,
    })
    const firstByteOffset = Buffer.from(probe).indexOf(Buffer.from('日'))
    // Place the first byte of "日" (0xe6) at byte 65535 so libuv's 64 KiB
    // pipe read buffer splits the 3-byte UTF-8 sequence across separate reads.
    const padLength = PIPE_READ_CHUNK_BYTES - 1 - firstByteOffset
    const payload = JSON.stringify({
      pad: 'x'.repeat(padLength),
      packages: [],
      workspace_root: workspaceRoot,
    })
    const payloadBytes = Buffer.from(payload)
    t.is(payloadBytes.indexOf(Buffer.from('日')), PIPE_READ_CHUNK_BYTES - 1)

    const script = `
const bytes = Buffer.from(${JSON.stringify(payload)})
process.stdout.write(bytes.subarray(0, ${PIPE_READ_CHUNK_BYTES}), () => {
  process.stdout.end(bytes.subarray(${PIPE_READ_CHUNK_BYTES}))
})
`
    await withFakeCargo(script, async (manifestPath) => {
      const metadata = await parseMetadata(manifestPath)
      t.is(metadata.workspace_root, workspaceRoot)
    })
  },
)

posixOnly(
  'should decode UTF-8 split across cargo metadata stderr chunks',
  async (t) => {
    const targetPath = '/tmp/日本/Cargo.toml'
    const prefix = 'error: failed to parse manifest at '
    const targetPrefixBytes = Buffer.from(targetPath).indexOf(Buffer.from('日'))
    const padLength =
      PIPE_READ_CHUNK_BYTES -
      1 -
      Buffer.byteLength(prefix) -
      targetPrefixBytes -
      1
    const message = `${prefix}${'x'.repeat(padLength)} ${targetPath}\n`
    t.is(
      Buffer.from(message).indexOf(Buffer.from('日')),
      PIPE_READ_CHUNK_BYTES - 1,
    )

    const script = `
const bytes = Buffer.from(${JSON.stringify(message)})
process.stderr.write(bytes.subarray(0, ${PIPE_READ_CHUNK_BYTES}), () => {
  process.stderr.end(bytes.subarray(${PIPE_READ_CHUNK_BYTES}), () => {
    process.exit(1)
  })
})
`
    await withFakeCargo(script, async (manifestPath) => {
      const err = await t.throwsAsync(() => parseMetadata(manifestPath))
      t.truthy(err)
      t.true(err!.message.includes(targetPath))
      t.false(err!.message.includes('\uFFFD'))
    })
  },
)
