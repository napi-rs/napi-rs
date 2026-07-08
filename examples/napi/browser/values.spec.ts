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
  abortBoundedTsfnFromOwnerAgent,
  abortBoundedTsfnPostCallFromOwnerAgent,
  armBoundedTsfnPostCallNativeWait,
  boundedTsfnOwnerAbortState,
  boundedTsfnPostCallAbortState,
  finishBoundedTsfnOwnerAbort,
  finishBoundedTsfnPostCallAbort,
  prepareBoundedTsfnOwnerAbort,
  prepareBoundedTsfnPostCallAbort,
  releaseBoundedTsfnNativeWait,
  releaseBoundedTsfnPostCallSlot,
  tsfnReturnPromise,
  tsfnReturnPromiseTimeout,
  asyncTaskReadFile,
  testWorkers,
}: typeof import('../index.cjs') = await import('../example.wasi-browser')

async function verifyBoundedPostCallAbort(): Promise<void> {
  prepareBoundedTsfnPostCallAbort(() => {})
  try {
    await expect
      .poll(
        () => {
          const state = boundedTsfnPostCallAbortState()
          return [state[0], state[29]]
        },
        { timeout: 10_000 },
      )
      .toEqual([1, 0])
    armBoundedTsfnPostCallNativeWait()
    await expect
      .poll(
        () => {
          const state = boundedTsfnPostCallAbortState()
          return [
            state[0],
            state[3],
            state[5],
            state[6],
            state[7],
            state[8],
            state[10],
            state[29],
          ]
        },
        { timeout: 10_000 },
      )
      .toEqual([1, 1, 1, 1, 1, 1, 0, 0])

    const atomicWait = Atomics.wait
    let ownerAtomicWaitCalls = 0
    Atomics.wait = function () {
      ownerAtomicWaitCalls += 1
      throw new Error('browser-window owner entered Atomics.wait')
    }
    try {
      abortBoundedTsfnPostCallFromOwnerAgent()
      expect(ownerAtomicWaitCalls).toBe(0)
      expect(boundedTsfnPostCallAbortState()[10]).toBe(0)
    } finally {
      Atomics.wait = atomicWait
    }

    releaseBoundedTsfnPostCallSlot()
    await expect
      .poll(
        () => {
          const state = boundedTsfnPostCallAbortState()
          return [
            state[10],
            state[11],
            state[18],
            state[20],
            state[27],
            state[34],
            state[29],
          ]
        },
        { timeout: 10_000 },
      )
      .toEqual([1, 1, 1, 1, 1, 1, 0])
    finishBoundedTsfnPostCallAbort()
  } finally {
    try {
      releaseBoundedTsfnPostCallSlot()
    } catch {}
    try {
      finishBoundedTsfnPostCallAbort()
    } catch {}
  }
}

describe('NAPI-RS wasi browser test', function () {
  it('DEFAULT_COST', function () {
    expect(DEFAULT_COST).toBe(12)
  })

  it('async self in class', async function () {
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

  it('threadsafe function return Promise and await in Rust', async () => {
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
  })

  it('owner-agent TSFN abort does not enter an atomic wait', async () => {
    await verifyBoundedPostCallAbort()
    prepareBoundedTsfnOwnerAbort(() => {})
    try {
      await expect
        .poll(
          () => {
            const state = boundedTsfnOwnerAbortState()
            return [state[0], state[1], state[30]]
          },
          { timeout: 10_000 },
        )
        .toEqual([1, 1, 1])

      const atomicWait = Atomics.wait
      let ownerAtomicWaitCalls = 0
      Atomics.wait = function () {
        ownerAtomicWaitCalls += 1
        throw new Error('browser-window owner entered Atomics.wait')
      }
      try {
        abortBoundedTsfnFromOwnerAgent()
        expect(boundedTsfnOwnerAbortState()).toEqual([
          1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1,
          3, 3, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0,
        ])

        await expect
          .poll(
            () => {
              const state = boundedTsfnOwnerAbortState()
              return [state[10], state[14], state[20]]
            },
            { timeout: 10_000 },
          )
          .toEqual([1, 1, 1])
        expect(ownerAtomicWaitCalls).toBe(0)
        expect(boundedTsfnOwnerAbortState()).toEqual([
          1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1,
          3, 3, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1,
        ])
      } finally {
        Atomics.wait = atomicWait
      }
    } finally {
      try {
        releaseBoundedTsfnNativeWait()
      } catch {}
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const state = boundedTsfnOwnerAbortState()
        if (state[10] === 1 && state[14] === 1 && state[20] === 1) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      try {
        finishBoundedTsfnOwnerAbort()
      } catch {}
    }
  })

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
