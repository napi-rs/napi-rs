// Threaded WASI lane: a pool worker that fails while it loads, after the
// runtime's thread spawn that created it already returned.
//
// The loader thread is then inside wasm: the 'exit' teardown runs
// napi_prepare_wasm_env_cleanup, whose finish_shutdown joins that thread in
// 1 ms slices and checks the addon's crash flag between them. The worker has
// no instance to call napi_wasm_thread_crashed through, so only the store
// into the view of that flag the loader passed it ends the join.
//
// Run `yarn workspace @examples/shared-async-runtime build:wasi-threads` first
// (the CI job does); this file only runs the generated artifacts. Set
// NAPI_RS_TEST_HANG_CHECK=1 to also check that, with the view dropped, the
// same exit and dispose hang until a watchdog kills them.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))

function runChild(mode, env = {}, timeout = 30_000) {
  const started = performance.now()
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      './wasi-threads-crash-preload.mjs',
      './wasi-threads-crash-child.cjs',
      mode,
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        NAPI_RS_TEST_FAIL_WORKER: '1',
        ...env,
      },
      timeout,
      killSignal: 'SIGKILL',
    },
  )
  return {
    ...result,
    elapsed: performance.now() - started,
    output: `${result.stdout}\n${result.stderr}`,
  }
}

test('process.exit() ends after a pool worker fails to load', () => {
  const result = runChild('exit')
  assert.equal(result.error, undefined, result.output)
  assert.equal(result.signal, null, result.output)
  assert.equal(result.status, 0, result.output)
  assert.match(result.stdout, /^exiting$/m)
  // The loader passed the view, and the worker failed while it loaded.
  assert.match(result.stderr, /worker 1: addon crash flag view at \d+\n/)
  assert.match(result.stderr, /worker 1: failing its wasm load/)
  // The teardown entered wasm and waited there until the worker failed; it
  // did not skip the wasm because the crash was already known.
  const teardown = Number(
    /exit teardown took (\d+) ms/.exec(result.stdout)?.[1],
  )
  assert.ok(teardown >= 100, result.output)
})

test('dispose() rejects with the crash after a pool worker fails to load', () => {
  const result = runChild('dispose')
  assert.equal(result.error, undefined, result.output)
  assert.equal(result.signal, null, result.output)
  assert.equal(result.status, 0, result.output)
  assert.match(
    result.stdout,
    /dispose rejected: napi-rs: WASI binding cannot be disposed after a worker thread crashed \| cause: napi-rs test: worker 1 failed to load/,
  )
})

// A CurrentThread sleep holds a referenced host timeout on the loader thread.
// The crash disposal cannot unregister the hosts, which enters wasm, so it
// clears those timeouts itself; before it did, the process stayed alive until
// the 60 s sleep ended, past this test's timeout.
test('dispose() after a crash releases an armed CurrentThread sleep', () => {
  const result = runChild('dispose-sleep')
  assert.equal(result.error, undefined, result.output)
  assert.equal(result.signal, null, result.output)
  assert.equal(result.status, 0, result.output)
  assert.match(result.stdout, /^idle thread started: true$/m)
  assert.match(
    result.stdout,
    /dispose rejected: napi-rs: WASI binding cannot be disposed after a worker thread crashed \| cause: napi-rs test: worker 1 failed to load/,
  )
  // Released, not fired: its result would have been handed back to wasm.
  assert.doesNotMatch(result.stdout, /^sleep (resolved|rejected)/m)
  const exited = Number(/exited after (\d+) ms/.exec(result.stdout)?.[1])
  assert.ok(exited < 15_000, result.output)
})

// Manual (NAPI_RS_TEST_HANG_CHECK=1): that the store into the view is what ends
// the waits above. Each mode waits for its watchdog, so it is left out of CI.
for (const mode of ['exit', 'dispose']) {
  test(
    `without the view, the ${mode} hangs`,
    {
      skip:
        process.env.NAPI_RS_TEST_HANG_CHECK !== '1' &&
        'set NAPI_RS_TEST_HANG_CHECK=1',
    },
    () => {
      const result = runChild(
        mode,
        { NAPI_RS_TEST_DROP_ADDON_CRASH_FLAG: '1' },
        8_000,
      )
      assert.match(
        result.stderr,
        /worker 1: addon crash flag view at \d+, dropped/,
      )
      assert.match(result.stderr, /worker 1: failing its wasm load/)
      assert.equal(result.signal, 'SIGKILL', result.output)
      assert.equal(result.error?.code, 'ETIMEDOUT', result.output)
    },
  )
}
