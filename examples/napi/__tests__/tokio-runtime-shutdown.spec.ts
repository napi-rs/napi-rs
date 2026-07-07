import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, 'tokio-runtime-shutdown.js')
const finalizerScriptPath = join(
  __dirname,
  'tokio-runtime-finalizer-lifecycle.js',
)
const lifecycleTimeoutMilliseconds = 30_000

test('Tokio shutdown rejects generated promises and releases their resources', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }

  const child = spawn(process.execPath, [scriptPath], {
    stdio: 'inherit',
  })
  const run = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('child process did not exit after Tokio shutdown'))
    }, lifecycleTimeoutMilliseconds)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(new Error(`child exited with code ${code} and signal ${signal}`))
      }
    })
  })

  await t.notThrowsAsync(run)
})

test('ordinary live-environment finalizers may start and stop Tokio', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }

  const child = spawn(process.execPath, ['--expose-gc', finalizerScriptPath], {
    stdio: 'inherit',
  })
  const run = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('child process did not observe the class finalizer'))
    }, lifecycleTimeoutMilliseconds)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(new Error(`child exited with code ${code} and signal ${signal}`))
      }
    })
  })

  await t.notThrowsAsync(run)
})
