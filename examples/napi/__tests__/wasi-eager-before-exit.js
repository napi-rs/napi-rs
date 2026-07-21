import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const loaderSuffix = process.argv[2]

assert.ok(
  loaderSuffix === 'wasi' || loaderSuffix === 'wasip1',
  `unsupported WASI loader suffix: ${loaderSuffix}`,
)

const loader = `../example.${loaderSuffix}.cjs`
const binding = require(loader)

assert.equal(binding.add(1, 2), 3)

let completedCycles = 0
const resumeWork = () => {
  const cycle = completedCycles + 1
  setImmediate(() => {
    assert.strictEqual(require(loader), binding)
    assert.equal(binding.add(cycle, 40), cycle + 40)
    completedCycles = cycle
    if (completedCycles === 3) {
      process.removeListener('beforeExit', resumeWork)
      process.stdout.write(
        `eager beforeExit lifecycle passed: ${loaderSuffix}\n`,
      )
    }
  })
}
process.on('beforeExit', resumeWork)

process.once('exit', () => {
  assert.equal(completedCycles, 3)
})
