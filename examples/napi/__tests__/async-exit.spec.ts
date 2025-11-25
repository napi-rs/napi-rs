import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, 'async-exit.js')

test('async napi functions let the process exit', async (t) => {
  if (process.env.WASI_TEST || process.arch === 'arm') {
    t.pass()
    return
  }
  const cp = spawn(process.execPath, [scriptPath], {
    stdio: 'inherit',
  })
  let done = false
  let timer: NodeJS.Timeout | null = null
  const run = new Promise<void>((resolve, reject) => {
    cp.on('exit', (code) => {
      done = true
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Process exited with code ${code}`))
      }
    })
    cp.on('error', reject)
    timer = setTimeout(() => {
      if (!done) {
        cp.kill()
        reject(new Error('timeout'))
      }
    }, 5000)
  }).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
  await t.notThrowsAsync(() => run)
})
