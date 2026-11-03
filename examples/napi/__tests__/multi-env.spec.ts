import test from 'ava'

// Ensures index.cjs loaded the addon, so `loadedAddon()` can find it.
import '../index.cjs'
import { LOAD_IN_WORKER, runInWorker } from './multi-env-helpers'

// One addon image loaded twice on one thread gets two envs that share the
// image's statics. Each load must keep its own per-env state. These run in a
// worker so the extra load does not touch the env this process tests with.

test('a second load does not take the first load’s Reflect cache', async (t) => {
  if (process.env.WASI_TEST) {
    // A WASI instance has its own linear memory per load, so nothing is shared.
    t.pass()
    return
  }
  const result = await runInWorker(`
    ${LOAD_IN_WORKER}
    const make = () => new Error('boom', { cause: new Error('inner') })
    const first = load()
    const firstBefore = first.describeCapturedValue(make())
    const second = load()
    ;(async () => {
      parentPort.postMessage({
        firstBefore,
        first: first.describeCapturedValue(make()),
        second: second.describeCapturedValue(make()),
        firstRejection: await first.describePromiseRejection(
          Promise.reject(make()),
        ),
        secondRejection: await second.describePromiseRejection(
          Promise.reject(make()),
        ),
      })
    })()
  `)
  // Without a per-env cache the first load reads "JavaScript Error" and loses
  // the cause once the second load registers.
  const expected = 'GenericFailure|boom|inner'
  t.deepEqual(result, {
    firstBefore: expected,
    first: expected,
    second: expected,
    firstRejection: expected,
    secondRejection: expected,
  })
})
