import { Buffer } from 'buffer'

import { describe, it, expect } from 'vitest'

globalThis.Buffer = Buffer

// @ts-expect-error
const {
  // @ts-expect-error
  __fs,
  DEFAULT_COST,
  Bird,
  GetterSetterWithClosures,
  tsfnReturnPromise,
  tsfnReturnPromiseTimeout,
  asyncTaskReadFile,
  testWorkers,
}: typeof import('../index.cjs') = await import('../example.wasi-browser')

// Known flaky: Rust std's locks on wasm32-wasip1-threads run
// `memory.atomic.wait32` on the browser main thread, which traps with
// "Atomics.wait cannot be called in this context". The module keeps working,
// so a retry passes; the trap that escapes a test is ignored in
// vite.config.js. Remove once https://github.com/napi-rs/napi-rs/issues/3720
// is fixed.
const knownFlakyAtomicsWait = {
  retry: {
    count: 2,
    condition: /Atomics\.wait cannot be called in this context|Test timed out/,
  },
}

describe('NAPI-RS wasi browser test', function () {
  it('DEFAULT_COST', function () {
    expect(DEFAULT_COST).toBe(12)
  })

  it('async self in class', knownFlakyAtomicsWait, async function () {
    const b = new Bird('foo')
    expect(await b.getNameAsync()).toBe('foo')
  })

  it('Class with getter setter closures', () => {
    const instance = new GetterSetterWithClosures()
    // @ts-expect-error
    instance.name = 'Allie'
    // @ts-expect-error
    expect(instance.name).toBe(`I'm Allie`)
    // @ts-expect-error
    expect(instance.age).toBe(0.3)
  })

  it(
    'threadsafe function return Promise and await in Rust',
    knownFlakyAtomicsWait,
    async () => {
      const value = await tsfnReturnPromise((err, value) => {
        if (err) {
          throw err
        }
        return Promise.resolve(value + 2)
      })
      expect(value).toBe(5)
      await expect(
        tsfnReturnPromiseTimeout((err, value) => {
          if (err) {
            throw err
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(value + 2)
            }, 300)
          })
        }),
      ).rejects.toMatchObject(new Error('Timeout'))
      // trigger Promise.then in Rust after `Promise` is dropped
      await new Promise((resolve) => setTimeout(resolve, 400))
    },
  )

  it('readFileAsync', async () => {
    __fs.writeFileSync('/test.txt', 'hello world')
    const value = await asyncTaskReadFile('/test.txt')
    expect(value.toString('utf8')).toBe('hello world')
  })

  it('testWorkers should not throw', async () => {
    const { resolve, reject, promise } = Promise.withResolvers<void>()
    expect(() =>
      testWorkers(10, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }),
    ).not.toThrow()
    await expect(promise).resolves.toBeUndefined()
  })
})
