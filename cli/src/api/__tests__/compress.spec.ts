import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { arch, platform } from 'node:process'
import { fileURLToPath } from 'node:url'

import ava from 'ava'

import { compressNodeArtifact } from '../compress.js'

const test = ava

// The producer is a real Rust binary that injects + ad-hoc-signs the __NAPI_PAYLOAD
// section into a real Mach-O stub, so the happy path is an integration test against
// the host's prebuilt stub + built producer. It is darwin-only (only macOS enforces
// a code signature on dlopen) and skips when those artifacts are absent (e.g. a CI
// job that hasn't built them).
const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostTriple = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
const stubPath = join(cliRoot, 'stubs', `${hostTriple}.node`)
const napiCompressPath = [
  join(cliRoot, 'bin', `napi-compress-${hostTriple}`),
  join(cliRoot, '..', 'target', 'release', 'napi-compress'),
  join(cliRoot, '..', 'target', 'debug', 'napi-compress'),
].find(existsSync)

const canIntegrate =
  platform === 'darwin' && existsSync(stubPath) && !!napiCompressPath
const integration = canIntegrate ? test : test.skip

integration(
  'produces an in-place, ad-hoc-signed .node carrying the __NAPI_PAYLOAD section',
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'napi-compress-'))
    const nodePath = join(dir, 'addon.darwin-arm64.node')
    const raw = Buffer.alloc(64 * 1024, 0x7f)
    await writeFile(nodePath, raw)

    const result = await compressNodeArtifact(nodePath, {
      napiCompressPath: napiCompressPath!,
      stubPath,
    })

    t.is(result.path, nodePath, 'compressed in place, same filename')
    t.is(result.rawSize, raw.length, 'receipt reports the raw addon size')
    t.true(
      result.compSize > 0 && result.compSize < raw.length,
      'payload shrank',
    )
    t.is(result.level, 16, 'small addons use the quick default level')
    t.is(
      typeof result.contentHash,
      'bigint',
      'content hash parsed from the receipt',
    )
    t.false(existsSync(`${nodePath}.compressed`), 'no leftover producer temp')

    // The produced file must stay code-signing-clean — the whole point of the
    // section over a trailing footer.
    t.notThrows(
      () => execFileSync('/usr/bin/codesign', ['-v', nodePath]),
      'codesign -v passes on the produced .node',
    )
  },
)

integration('clamps the zstd level to the 1..22 range', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-compress-level-'))
  const nodePath = join(dir, 'addon.node')
  await writeFile(nodePath, randomBytes(2048))
  const result = await compressNodeArtifact(nodePath, {
    level: 99,
    napiCompressPath: napiCompressPath!,
    stubPath,
  })
  t.is(result.level, 22, 'an out-of-range level clamps to the max')
})

test('a failing producer throws loud, not silent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-compress-fail-'))
  const nodePath = join(dir, 'addon.node')
  await writeFile(nodePath, randomBytes(1024))

  const err = await t.throwsAsync(() =>
    compressNodeArtifact(nodePath, {
      napiCompressPath: join(dir, 'does-not-exist'),
      stubPath: join(dir, 'stub.node'),
    }),
  )
  t.regex(err!.message, /napi-compress producer failed/)
  t.regex(err!.message, /Fix:/, 'error names a fix')
})
