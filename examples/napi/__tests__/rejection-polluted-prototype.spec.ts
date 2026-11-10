import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))

// With `deferred_trace`, napi-rs puts the message and the code of a rejection on a trace error.
// A polluted prototype must not leave the promise pending for ever with the exception reported
// as uncaught. Each case runs in a child process, because it pollutes a prototype of the whole
// realm. The child loads the same binding as this lane (native or WASI).
function run(kind: string) {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'rejection-polluted-prototype.js'), kind],
    { encoding: 'utf8', env: process.env, timeout: 60_000 },
  )
  const output = `${result.stdout}\n${result.stderr}`
  const line = result.stdout
    .split('\n')
    .find((text) => text.startsWith('rejection '))
  const report = line ? JSON.parse(line.slice('rejection '.length)) : undefined
  // Not compared: 'native', or the WASI flavor of the lane.
  delete report?.target
  return { result, output, report }
}

const OWN_ERROR = {
  settled: 'rejected',
  name: 'Error',
  message: 'Async Error',
  code: 'InvalidArg',
  uncaught: [],
}

// The code is an own data property: an assignment ran the setter, and the promise stayed pending.
test('a throwing setter on Error.prototype.code does not stop a rejection', (t) => {
  const { result, output, report } = run('code-setter')
  t.is(result.status, 0, output)
  t.deepEqual(report, OWN_ERROR, output)
})

// Node, Bun and Deno define the property natively. emnapi (WASI) builds a JavaScript descriptor
// object, which inherits `get` and is then invalid: the define call throws, and the promise is
// rejected with that `TypeError`. A WASI flavor that builds the rejection inside the call, before
// the prototype is polluted, rejects with its own error.
test('an accessor key on Object.prototype does not leave a rejection pending', (t) => {
  const { result, output, report } = run('descriptor-get')
  t.is(result.status, 0, output)
  if (process.env.WASI_TEST) {
    t.is(report?.settled, 'rejected', output)
    t.true(['TypeError', 'Error'].includes(report?.name), output)
    t.deepEqual(report?.uncaught, [], output)
  } else {
    t.deepEqual(report, OWN_ERROR, output)
  }
})
