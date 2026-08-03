import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import { buildCargoCdylibArtifact } from './helpers/cargo-artifact.js'

// The registration-manifest pre-pass must fail closed on a `(namespace, name)`
// collision that N-API would otherwise resolve by silently overwriting one
// definition with another. The fixture addon
// (`examples/napi-duplicate-registration`) exports two distinct `#[napi]`
// classes under the same top-level name, so `napi_register_module_v1` throws and
// `require()` fails. The per-rule Ok/Err logic is covered exhaustively by the
// `manifest_tests` Rust unit tests; this proves the end-to-end runtime throw
// path — a bad addon fails loudly at load rather than loading with a member
// silently missing.

const __dirname = join(fileURLToPath(import.meta.url), '..')
const repoRoot = join(__dirname, '..', '..', '..')
const require = createRequire(import.meta.url)

// Built + staged as a loadable `.node` in `before`; left undefined (→ test
// skips) only when cargo itself is unavailable in this environment. A real
// build/lookup failure is thrown from `before` instead, so a broken fixture
// fails the test rather than silently skipping it.
let fixtureNodePath: string | undefined

test.before(() => {
  const result = buildCargoCdylibArtifact(
    repoRoot,
    'napi-duplicate-registration',
  )
  if (result.cargoUnavailable) {
    return
  }
  if (!result.path) {
    throw new Error(
      'failed to build/locate the napi-duplicate-registration fixture addon',
      { cause: result.error },
    )
  }
  const staged = join(
    tmpdir(),
    `napi-duplicate-registration-${process.pid}.node`,
  )
  copyFileSync(result.path, staged)
  fixtureNodePath = staged
})

const nativeOnly = process.env.WASI_TEST ? test.skip : test

nativeOnly(
  'a duplicate (namespace, name) export makes require() throw a clear error',
  (t) => {
    if (!fixtureNodePath) {
      t.pass(
        'duplicate-registration fixture addon was not built (cargo unavailable?); skipping',
      )
      return
    }

    const error = t.throws(() => require(fixtureNodePath as string))
    t.regex(
      String(error?.message),
      /duplicate export/,
      'the manifest pre-pass names the collision',
    )
    t.regex(
      String(error?.message),
      /Widget/,
      'the error names the colliding export',
    )
  },
)

nativeOnly(
  'NAPI_RS_ALLOW_DUPLICATE_EXPORTS lets the addon load with a warning instead of throwing',
  (t) => {
    if (!fixtureNodePath) {
      t.pass(
        'duplicate-registration fixture addon was not built (cargo unavailable?); skipping',
      )
      return
    }

    // A native `eprintln!` writes straight to the process's stderr file
    // descriptor, bypassing Node's `process.stderr` JS stream — so a real
    // child process (whose stdout/stderr the parent captures at the OS level
    // regardless of which layer inside it wrote) is the only reliable way to
    // observe both the successful load and the warning text.
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `require(${JSON.stringify(fixtureNodePath)}); console.log('loaded')`,
      ],
      {
        env: { ...process.env, NAPI_RS_ALLOW_DUPLICATE_EXPORTS: '1' },
        encoding: 'utf8',
        timeout: 30_000,
      },
    )

    t.is(
      result.status,
      0,
      `the escape hatch lets require() succeed instead of throwing (stderr: ${result.stderr})`,
    )
    t.is(result.stdout.trim(), 'loaded')
    t.regex(
      result.stderr,
      /duplicate export/,
      'the collision is still reported, as a warning',
    )
    t.regex(
      result.stderr,
      /Widget/,
      'the warning still names the colliding export',
    )
  },
)
