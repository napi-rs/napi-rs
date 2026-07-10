import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const entryPath = require.resolve('../index.cjs')
const wasiDisposeSymbol = Symbol.for('napi.rs.wasi.dispose')

process.env.NAPI_RS_FORCE_WASI = 'error'

const binding = require(entryPath)
const dispose = binding[wasiDisposeSymbol]

assert.equal(typeof dispose, 'function')
assert.equal(binding.add(1, 2), 3)

let completedCycles = 0
let disposed = false

const resumeWork = () => {
  const cycle = completedCycles + 1
  setImmediate(() => {
    assert.strictEqual(require(entryPath), binding)
    assert.equal(binding.add(cycle, 40), cycle + 40)
    completedCycles = cycle

    if (completedCycles === 3) {
      process.removeListener('beforeExit', resumeWork)
      const keepAlive = setInterval(() => {}, 100)
      const firstDisposal = dispose()
      assert.strictEqual(dispose(), firstDisposal)
      firstDisposal.then(
        () => {
          assert.strictEqual(dispose(), firstDisposal)
          disposed = true
          clearInterval(keepAlive)
          process.stdout.write('WASI beforeExit lifecycle passed\n')
        },
        (error) => {
          clearInterval(keepAlive)
          setImmediate(() => {
            throw error
          })
        },
      )
    }
  })
}

process.on('beforeExit', resumeWork)
process.once('exit', () => {
  assert.equal(completedCycles, 3)
  assert.equal(disposed, true)
})
