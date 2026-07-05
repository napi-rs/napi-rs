import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, 'tokio-runtime-shutdown.js')

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
    }, 5000)

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
