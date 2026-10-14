import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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
  // A local server, so the child's fetch never waits on a remote host and the
  // only thing the timeout below measures is whether the process exits.
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end('{"ok":true}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => server.close())
  const { port } = server.address() as AddressInfo
  const cp = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ASYNC_EXIT_URL: `http://127.0.0.1:${port}/` },
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
