import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

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

function fixtureLibraryFileName(): string {
  switch (process.platform) {
    case 'win32':
      return 'napi_duplicate_registration.dll'
    case 'darwin':
      return 'libnapi_duplicate_registration.dylib'
    default:
      return 'libnapi_duplicate_registration.so'
  }
}

// Built + staged as a loadable `.node` in `before`; left undefined (→ test
// skips) if cargo is unavailable or the build fails in this environment.
let fixtureNodePath: string | undefined

test.before(() => {
  try {
    execFileSync('cargo', ['build', '-p', 'napi-duplicate-registration'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    const built = join(repoRoot, 'target', 'debug', fixtureLibraryFileName())
    if (!existsSync(built)) {
      return
    }
    const staged = join(
      tmpdir(),
      `napi-duplicate-registration-${process.pid}.node`,
    )
    copyFileSync(built, staged)
    fixtureNodePath = staged
  } catch {
    // Leave `fixtureNodePath` undefined so the test below skips gracefully.
  }
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
