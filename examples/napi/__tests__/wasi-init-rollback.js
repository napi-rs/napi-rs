import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const loaderPath = fileURLToPath(
  new URL('../example.wasi.cjs', import.meta.url),
)
const copyPath = fileURLToPath(
  new URL(`../.wasi-init-rollback-${process.pid}.cjs`, import.meta.url),
)

const source = await readFile(loaderPath, 'utf8')
const anchor = 'module.exports = __napiModule.exports\n'
assert.equal(
  source.split(anchor).length - 1,
  1,
  'the generated loader no longer aliases __napiModule.exports exactly once',
)

// An initialization failure leaves the loader in one particular state: the pool
// workers it already spawned are registered and loaded with the emnapi thread
// manager, while the destructuring that assigns `__napiModule` never ran —
// instantiation threw before it could return. Reproduce exactly that state: let
// the loader initialize, then take `__napiModule` away before the workers are
// torn down. Nothing else about the loader is changed.
const patched = source.replace(
  anchor,
  `const __rollbackTestExports = __napiModule.exports
Object.defineProperty(__rollbackTestExports, '__clearNapiModule', {
  value: function () { __napiModule = undefined },
  enumerable: false,
})
module.exports = __rollbackTestExports
`,
)

await writeFile(copyPath, patched)
try {
  const binding = require(copyPath)
  // Registers and loads a pool worker, the way a module-init hook that starts
  // async work does before the load goes on to fail.
  await binding.asyncTaskVoidReturn()
  binding.__clearNapiModule()
  // The real catch block starts the rollback and does not await it, then throws
  // the initialization error at the caller — who catches it and carries on.
  binding[Symbol.for('napi.rs.wasi.dispose')]().catch(() => {})
  process.stdout.write('caller survived the failed initialization\n')
} finally {
  await rm(copyPath, { force: true })
}
