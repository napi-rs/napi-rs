import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runnerPath = join(__dirname, 'external-ref-lifecycle.js')

test.skipIf(Boolean(process.env.WASI_TEST))(
  'ExternalRef rejects foreign environments and survives owner teardown',
  async (t) => {
    const child = spawn(process.execPath, ['--expose-gc', runnerPath], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })

    await t.notThrowsAsync(
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('ExternalRef lifecycle test timed out'))
        }, 30_000)
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.once('exit', (code, signal) => {
          clearTimeout(timer)
          if (code === 0 && signal === null) {
            resolve()
          } else {
            reject(
              new Error(
                `ExternalRef lifecycle test exited with code ${code} and signal ${signal}\n${output}`,
              ),
            )
          }
        })
      }),
    )
  },
)
