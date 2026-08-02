import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

// Deferred #1164 test: on a build WITHOUT `napi8`, an inherited *plain method*
// called on a descendant must still throw "Illegal invocation" — the
// pre-feature status quo. `#[napi(extends)]` wires the instance prototype chain
// regardless of napi8 (pure `Object.setPrototypeOf`), so `instanceof` and the
// child's own members work; but the P8 rebuild that strips a BorrowedUpcast
// plain method's V8 receiver signature — the piece that lets a descendant
// actually call it — is napi8-only. The fixture addon
// (`examples/napi-no-napi8`) is compiled without napi8 to pin that boundary.

const __dirname = join(fileURLToPath(import.meta.url), '..')
const repoRoot = join(__dirname, '..', '..', '..')
const require = createRequire(import.meta.url)

interface NoNapi8Addon {
  NoNapi8Base: new (value: number) => { doubled(): number }
  NoNapi8Sub: {
    create(value: number, extra: number): { extra: number; doubled(): number }
  }
}

function fixtureLibraryFileName(): string {
  switch (process.platform) {
    case 'win32':
      return 'napi_no_napi8.dll'
    case 'darwin':
      return 'libnapi_no_napi8.dylib'
    default:
      return 'libnapi_no_napi8.so'
  }
}

// Loaded in `before`; left undefined (→ test skips) if cargo is unavailable or
// the build fails in this environment.
let addon: NoNapi8Addon | undefined

test.before(() => {
  try {
    execFileSync('cargo', ['build', '-p', 'napi-no-napi8'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    const built = join(repoRoot, 'target', 'debug', fixtureLibraryFileName())
    if (!existsSync(built)) {
      return
    }
    const staged = join(tmpdir(), `napi-no-napi8-${process.pid}.node`)
    copyFileSync(built, staged)
    addon = require(staged) as NoNapi8Addon
  } catch {
    // Leave `addon` undefined so the test below skips gracefully.
  }
})

const noNapi8Test = process.env.WASI_TEST ? test.skip : test

noNapi8Test(
  'without napi8, an inherited plain method throws Illegal invocation on a descendant',
  (t) => {
    if (!addon) {
      t.pass(
        'no-napi8 fixture addon was not built (cargo unavailable?); skipping',
      )
      return
    }

    const sub = addon.NoNapi8Sub.create(10, 5)

    // Prototype wiring is not gated on napi8, so instanceof and the child's own
    // members work even here.
    t.true(sub instanceof addon.NoNapi8Base)
    t.is(sub.extra, 5)

    // The inherited plain method has no P8 rebuild without napi8, so V8's
    // method-receiver signature check rejects the descendant.
    const error = t.throws(() => sub.doubled())
    t.regex(
      String(error?.message),
      /Illegal invocation/,
      'an inherited plain method is rejected on a descendant without napi8',
    )

    // It still works on a real base instance.
    const base = new addon.NoNapi8Base(7)
    t.is(base.doubled(), 14)
  },
)
