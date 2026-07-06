import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

const timeoutMilliseconds = 20_000

function waitForMessage(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for pure-runtime worker metrics'))
    }, timeoutMilliseconds)
    const onMessage = (message) => {
      cleanup()
      if (message?.error) {
        reject(new Error(message.error))
      } else {
        resolve(message)
      }
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`pure-runtime worker exited early with code ${code}`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
  })
}

async function assertFileMissing(path, message) {
  await assert.rejects(
    access(path),
    (error) => error?.code === 'ENOENT',
    message,
  )
}

export async function findPureRuntimeBinding() {
  const directory = new URL('./.pure-runtime/', import.meta.url)
  const bindings = (await readdir(directory)).filter(
    (filename) =>
      filename.startsWith('custom_async_runtime_pure.') &&
      filename.endsWith('.node'),
  )
  assert.equal(
    bindings.length,
    1,
    `expected one pure-runtime native artifact, found ${bindings.join(', ')}`,
  )
  return fileURLToPath(new URL(bindings[0], directory))
}

export async function runPureRuntimeReloadLifecycle(bindingFile) {
  assert.ok(
    isAbsolute(bindingFile),
    'pure-runtime binding path must be absolute',
  )

  const require = createRequire(import.meta.url)
  assert.equal(
    require.cache[bindingFile],
    undefined,
    'the parent process must not load the pure-runtime artifact',
  )

  const missingResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const binding = require(${JSON.stringify(bindingFile)})
        console.log('pure addon loaded without a backend')
        const timeout = setTimeout(
          () => {
            console.error('timed out waiting for missing-backend rejection')
            process.exitCode = 1
          },
          5000,
        )
        ;(async () => {
          let generatedPromise
          try {
            generatedPromise = binding.asyncDouble(21)
          } catch (error) {
            throw new Error(
              \`generated async export threw synchronously instead of returning a Promise: \${error}\`,
              { cause: error },
            )
          }
          if (!(generatedPromise instanceof Promise)) {
            throw new TypeError('generated async export did not return a Promise')
          }
          try {
            await generatedPromise
          } catch (error) {
            const errors = []
            let current = error
            while (current) {
              errors.push(String(current))
              current = current.cause
            }
            if (/No AsyncRuntime backend is registered/i.test(errors.join('\\n'))) {
              console.log('pure async operation rejected without a backend')
              return
            }
            throw error
          }
          throw new Error('pure async operation unexpectedly succeeded without a backend')
        })().then(
          () => clearTimeout(timeout),
          (error) => {
            clearTimeout(timeout)
            console.error(error)
            process.exitCode = 1
          },
        )
      `,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NAPI_CUSTOM_RUNTIME_TEST_MISSING: '1' },
      timeout: timeoutMilliseconds,
    },
  )
  assert.equal(
    missingResult.signal,
    null,
    `${missingResult.stdout}\n${missingResult.stderr}`,
  )
  assert.equal(
    missingResult.status,
    0,
    `${missingResult.stdout}\n${missingResult.stderr}`,
  )
  assert.match(missingResult.stdout, /loaded without a backend/)
  assert.match(missingResult.stdout, /operation rejected without a backend/)

  const directory = await mkdtemp(join(tmpdir(), 'napi-pure-runtime-reload-'))
  const dropMarker = join(directory, 'backend-dropped')
  const previousDropProbe = process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE
  process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE = dropMarker
  let backendIdentity

  try {
    for (let generation = 0; generation < 3; generation += 1) {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { bindingFile },
      })
      try {
        const result = await waitForMessage(worker)
        assert.equal(result.value, 42)
        assert.equal(result.metrics.tokioRuntimeEnabled, false)
        assert.equal(result.metrics.moduleInitCalls, 1)
        assert.equal(result.metrics.runtimeRegistrationCalls, 1)
        assert.equal(result.metrics.startCalls, generation + 1)
        assert.equal(result.metrics.shutdownCalls, generation)
        assert.equal(result.metrics.backendDropCalls, 0)
        if (backendIdentity === undefined) {
          backendIdentity = result.metrics.backendIdentity
          assert.ok(backendIdentity, 'backend identity must not be empty')
        } else {
          assert.equal(
            result.metrics.backendIdentity,
            backendIdentity,
            'sequential workers must reuse one retained backend',
          )
        }
      } finally {
        await worker.terminate()
      }

      await assertFileMissing(
        dropMarker,
        `backend Drop ran after worker generation ${generation + 1}`,
      )
      assert.equal(
        require.cache[bindingFile],
        undefined,
        'the parent process must remain free of the pure-runtime artifact',
      )
    }

    console.log('pure async-runtime reload lifecycle passed')
  } finally {
    if (previousDropProbe === undefined) {
      delete process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE
    } else {
      process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE = previousDropProbe
    }
    await rm(directory, { recursive: true, force: true })
  }
}

async function runWorker() {
  try {
    const require = createRequire(import.meta.url)
    const binding = require(workerData.bindingFile)
    const value = await binding.asyncDouble(21)
    parentPort.postMessage({
      metrics: binding.getRuntimeMetrics(),
      value,
    })
  } catch (error) {
    parentPort.postMessage({ error: error?.stack ?? String(error) })
  }
}

if (!isMainThread) {
  await runWorker()
} else if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await runPureRuntimeReloadLifecycle(
    process.argv[2] ?? (await findPureRuntimeBinding()),
  )
}
