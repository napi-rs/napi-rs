import { expect, test } from 'vitest'

test('single-thread wasi binding works in a non-cross-origin-isolated browser', async () => {
  // The whole point of the single-thread build: no COOP/COEP headers are set
  // by the dev server, so the page must NOT be cross-origin isolated and the
  // SharedArrayBuffer constructor must not be exposed at all.
  expect(globalThis.crossOriginIsolated).toBeFalsy()
  expect(typeof globalThis.SharedArrayBuffer).toBe('undefined')

  // Mirror test.mjs's static assertions on the generated loader source: the
  // single-thread browser loader must never spawn workers or touch
  // SharedArrayBuffer, and must pin the async work pool to zero.
  const source = (await import('../custom_async_runtime.wasi-browser.js?raw'))
    .default
  expect(source).not.toMatch(/node:worker_threads/)
  expect(source).not.toMatch(/\bWorker\b/)
  expect(source).not.toMatch(/SharedArrayBuffer/)
  expect(source).toMatch(/asyncWorkPoolSize:\s*0/)

  const binding = await import('../custom_async_runtime.wasi-browser.js')
  const initial = binding.getRuntimeMetrics()

  expect(binding.isWasm()).toBe(true)
  expect(initial.startCalls).toBeGreaterThanOrEqual(1)
  expect(initial.activeGuards).toBe(0)

  expect(binding.runtimeContextIsActive()).toBe(true)
  const afterEnter = binding.getRuntimeMetrics()
  expect(afterEnter.enterCalls).toBe(initial.enterCalls + 1)
  expect(afterEnter.exitCalls).toBe(initial.exitCalls + 1)
  expect(afterEnter.activeGuards).toBe(0)

  expect(binding.blockOnValue(41)).toBe(42)
  const afterBlockOn = binding.getRuntimeMetrics()
  expect(afterBlockOn.blockOnCalls).toBe(initial.blockOnCalls + 1)
  expect(afterBlockOn.blockOnPolls).toBeGreaterThanOrEqual(
    initial.blockOnPolls + 2,
  )

  const beforeAsync = binding.getRuntimeMetrics()
  expect(
    await Promise.all([1, 2, 3, 4].map((value) => binding.asyncDouble(value))),
  ).toEqual([2, 4, 6, 8])
  expect(await binding.spawnFuture(41)).toBe(42)
  await expect(binding.asyncError()).rejects.toThrow(
    'custom runtime async error',
  )

  // 6 async tasks were spawned above: 4x asyncDouble, 1x spawnFuture,
  // 1x asyncError. (asyncPanic/asyncPanicString are native-mode-only.)
  const afterAsync = binding.getRuntimeMetrics()
  const expectedAsyncTasks = 6
  expect(afterAsync.spawnCalls).toBeGreaterThanOrEqual(
    beforeAsync.spawnCalls + expectedAsyncTasks,
  )
  expect(afterAsync.completedTasks).toBeGreaterThanOrEqual(
    beforeAsync.completedTasks + expectedAsyncTasks,
  )
  expect(afterAsync.taskPolls).toBeGreaterThanOrEqual(
    beforeAsync.taskPolls + expectedAsyncTasks * 2,
  )
  expect(afterAsync.wakeCalls).toBeGreaterThanOrEqual(
    beforeAsync.wakeCalls + expectedAsyncTasks,
  )

  const beforeLifecycle = binding.getRuntimeMetrics()
  binding.shutdownRuntime()
  const afterShutdown = binding.getRuntimeMetrics()
  expect(afterShutdown.shutdownCalls).toBe(beforeLifecycle.shutdownCalls + 1)

  binding.startRuntime()
  const afterStart = binding.getRuntimeMetrics()
  expect(afterStart.startCalls).toBe(beforeLifecycle.startCalls + 1)
  expect(await binding.asyncDouble(21)).toBe(42)
})
