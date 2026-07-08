import { Buffer } from 'buffer'

import { describe, it, expect } from 'vitest'

globalThis.Buffer = Buffer

type BrowserTsfnTestBinding = typeof import('../index.cjs') & {
  abortBoundedTsfnFromOwnerAgent(): void
  boundedTsfnOwnerAbortState(): Array<number>
  finishBoundedTsfnOwnerAbort(): void
  prepareBoundedTsfnOwnerAbort(
    callback: (arg: number) => void,
    postNative: boolean,
  ): void
  releaseBoundedTsfnNativeWait(): void
}

// @ts-expect-error
const {
  // @ts-expect-error
  __fs,
  DEFAULT_COST,
  Bird,
  GetterSetterWithClosures,
  abortBoundedTsfnFromOwnerAgent,
  boundedTsfnOwnerAbortState,
  finishBoundedTsfnOwnerAbort,
  prepareBoundedTsfnOwnerAbort,
  releaseBoundedTsfnNativeWait,
  tsfnReturnPromise,
  tsfnReturnPromiseTimeout,
  asyncTaskReadFile,
  testWorkers,
}: BrowserTsfnTestBinding = await import('../example.wasi-browser')

async function runWasiWorkers(amount: number): Promise<void> {
  const { resolve, reject, promise } = Promise.withResolvers<void>()
  testWorkers(amount, (err) => {
    if (err) {
      reject(err)
    } else {
      resolve()
    }
  })
  await promise
}

async function finishBoundedTsfnScenario(
  expectedScenario: number,
  expectedBlockingStatus: number,
  expectedLifecycleStatus: number,
  expectedSlotRelease: number,
): Promise<void> {
  await expect
    .poll(
      () => {
        const state = boundedTsfnOwnerAbortState()
        return [
          state[0],
          state[3],
          state[5],
          state[6],
          state[7],
          state[8],
          state[9],
          state[10],
          state[11],
          state[15],
          state[16],
          state[17],
          state[18],
          state[22],
          state[23],
          state[24],
          state[27],
          state[28],
          state[29],
        ]
      },
      { timeout: 10_000 },
    )
    .toEqual([
      expectedScenario,
      1,
      1,
      1,
      1,
      expectedScenario === 2 ? 1 : 0,
      expectedScenario === 2 ? 1 : 0,
      1,
      expectedBlockingStatus,
      expectedScenario === 1 ? 1 : 0,
      expectedLifecycleStatus,
      1,
      1,
      0,
      1,
      1,
      expectedSlotRelease,
      1,
      0,
    ])
  finishBoundedTsfnOwnerAbort()
}

async function cleanupBoundedTsfnScenario(): Promise<void> {
  try {
    releaseBoundedTsfnNativeWait()
  } catch {}
  try {
    releaseBoundedTsfnNativeWait()
  } catch {}
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const state = boundedTsfnOwnerAbortState()
    const lifecycleComplete =
      state[0] !== 1 || state[12] === 0 || state[15] === 1
    if (state[10] === 1 && state[24] === 1 && lifecycleComplete) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  try {
    finishBoundedTsfnOwnerAbort()
  } catch {}
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

  it('owner-agent TSFN abort defers native retirement under lifecycle contention', async () => {
    await runWasiWorkers(2)
    prepareBoundedTsfnOwnerAbort(() => {}, false)
    try {
      await expect
        .poll(
          () => {
            const state = boundedTsfnOwnerAbortState()
            return [state[0], state[1], state[29]]
          },
          { timeout: 10_000 },
        )
        .toEqual([1, 1, 0])
      releaseBoundedTsfnNativeWait()
      const gatedState = boundedTsfnOwnerAbortState()
      expect([
        gatedState[3],
        gatedState[5],
        gatedState[6],
        gatedState[7],
        gatedState[13],
        gatedState[28],
        gatedState[29],
      ]).toEqual([1, 1, 1, 0, 1, 1, 0])

      const atomicWait = Atomics.wait
      let ownerAtomicWaitCalls = 0
      Atomics.wait = function () {
        ownerAtomicWaitCalls += 1
        throw new Error('browser-window owner entered Atomics.wait')
      }
      try {
        abortBoundedTsfnFromOwnerAgent()
        expect(ownerAtomicWaitCalls).toBe(0)
      } finally {
        Atomics.wait = atomicWait
      }
      await finishBoundedTsfnScenario(1, 1, 1, 0)
    } finally {
      await cleanupBoundedTsfnScenario()
    }
  })

  it('owner-agent TSFN abort returns in the post-native blocking-call window', async () => {
    prepareBoundedTsfnOwnerAbort(() => {}, true)
    try {
      await expect
        .poll(
          () => {
            const state = boundedTsfnOwnerAbortState()
            return [state[0], state[1], state[29]]
          },
          { timeout: 10_000 },
        )
        .toEqual([2, 1, 0])
      releaseBoundedTsfnNativeWait()
      await expect
        .poll(
          () => {
            const state = boundedTsfnOwnerAbortState()
            return [
              state[0],
              state[3],
              state[5],
              state[6],
              state[7],
              state[8],
              state[9],
              state[10],
              state[17],
              state[22],
              state[23],
              state[29],
            ]
          },
          { timeout: 10_000 },
        )
        .toEqual([2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0])

      const atomicWait = Atomics.wait
      let ownerAtomicWaitCalls = 0
      Atomics.wait = function () {
        ownerAtomicWaitCalls += 1
        throw new Error('browser-window owner entered Atomics.wait')
      }
      try {
        abortBoundedTsfnFromOwnerAgent()
        const state = boundedTsfnOwnerAbortState()
        expect([state[8], state[9], state[10], state[17], state[18]]).toEqual([
          1, 0, 0, 1, 1,
        ])
        expect(ownerAtomicWaitCalls).toBe(0)
      } finally {
        Atomics.wait = atomicWait
      }

      releaseBoundedTsfnNativeWait()
      await finishBoundedTsfnScenario(2, 2, 0, 1)
    } finally {
      await cleanupBoundedTsfnScenario()
    }
  })

  it('readFileAsync', async () => {
    __fs.writeFileSync('/test.txt', 'hello world')
    const value = await asyncTaskReadFile('/test.txt')
    expect(value.toString('utf8')).toBe('hello world')
  })

  it('testWorkers should not throw', async () => {
    await expect(runWasiWorkers(10)).resolves.toBeUndefined()
  })
})
