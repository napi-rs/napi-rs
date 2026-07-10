import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const loaderSuffix = process.argv[2]
const fault = process.argv[3]

assert.ok(
  loaderSuffix === 'wasi' || loaderSuffix === 'wasip1',
  `unsupported WASI loader suffix: ${loaderSuffix}`,
)
assert.ok(
  fault === 'exit-registration' ||
    fault === 'before-exit-removal' ||
    fault === 'handoff-rollback',
  `unsupported cleanup handoff fault: ${fault}`,
)

const loader = `../example.${loaderSuffix}.cjs`
const handoffError = new Error(fault)
const rollbackError = new Error('exit rollback failed')
const events = []
const once = process.once
const removeListener = process.removeListener
let beforeExitRemovalFailed = false
let exitRemovalFailed = false

process.once = function (event, listener) {
  if (listener.name.startsWith('__destroyEmnapiContext')) {
    events.push(`once:${event}:${listener.name}`)
  }
  if (
    fault === 'exit-registration' &&
    event === 'exit' &&
    listener.name === '__destroyEmnapiContextAtExit'
  ) {
    throw handoffError
  }
  return Reflect.apply(once, this, [event, listener])
}
process.removeListener = function (event, listener) {
  if (listener.name.startsWith('__destroyEmnapiContext')) {
    events.push(`remove:${event}:${listener.name}`)
  }
  if (
    (fault === 'before-exit-removal' || fault === 'handoff-rollback') &&
    !beforeExitRemovalFailed &&
    event === 'beforeExit' &&
    listener.name === '__destroyEmnapiContextBeforeExit'
  ) {
    beforeExitRemovalFailed = true
    throw handoffError
  }
  if (
    fault === 'handoff-rollback' &&
    !exitRemovalFailed &&
    event === 'exit' &&
    listener.name === '__destroyEmnapiContextAtExit'
  ) {
    exitRemovalFailed = true
    throw rollbackError
  }
  return Reflect.apply(removeListener, this, [event, listener])
}

try {
  assert.throws(
    () => require(loader),
    (error) => {
      if (fault !== 'handoff-rollback') {
        return error === handoffError
      }
      return (
        error instanceof AggregateError &&
        error.cause === handoffError &&
        error.errors[0] === handoffError &&
        error.errors[1] === rollbackError
      )
    },
  )
} finally {
  process.once = once
  process.removeListener = removeListener
}

const generatedBeforeExitListeners = process
  .rawListeners('beforeExit')
  .filter(
    (listener) =>
      listener.name === '__destroyEmnapiContextBeforeExit' ||
      listener.listener?.name === '__destroyEmnapiContextBeforeExit',
  )
const generatedExitListeners = process
  .rawListeners('exit')
  .filter(
    (listener) =>
      listener.name === '__destroyEmnapiContextAtExit' ||
      listener.listener?.name === '__destroyEmnapiContextAtExit',
  )

assert.equal(generatedBeforeExitListeners.length, 0)
assert.equal(generatedExitListeners.length, 0)
if (fault === 'exit-registration') {
  assert.deepEqual(events, [
    'once:beforeExit:__destroyEmnapiContextBeforeExit',
    'once:exit:__destroyEmnapiContextAtExit',
    'remove:beforeExit:__destroyEmnapiContextBeforeExit',
  ])
} else if (fault === 'before-exit-removal') {
  assert.deepEqual(events, [
    'once:beforeExit:__destroyEmnapiContextBeforeExit',
    'once:exit:__destroyEmnapiContextAtExit',
    'remove:beforeExit:__destroyEmnapiContextBeforeExit',
    'remove:exit:__destroyEmnapiContextAtExit',
    'remove:beforeExit:__destroyEmnapiContextBeforeExit',
  ])
} else {
  assert.deepEqual(events, [
    'once:beforeExit:__destroyEmnapiContextBeforeExit',
    'once:exit:__destroyEmnapiContextAtExit',
    'remove:beforeExit:__destroyEmnapiContextBeforeExit',
    'remove:exit:__destroyEmnapiContextAtExit',
    'remove:beforeExit:__destroyEmnapiContextBeforeExit',
    'remove:exit:__destroyEmnapiContextAtExit',
  ])
}
process.stdout.write(`eager cleanup handoff passed: ${fault}\n`)
