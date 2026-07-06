import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = join(__dirname, '..', 'module-init-rollback')
const addonPath = join(fixtureDirectory, 'module-init-rollback.node')
const runnerPath = join(__dirname, 'module-init-rollback.js')

test.before(async () => {
  if (!isWasi) {
    await access(addonPath)
  }
})

test.skipIf(isWasi)(
  'failed module initialization retires callbacks before Worker environment cleanup',
  async (t) => {
    const child = spawn(process.execPath, [runnerPath, addonPath], {
      cwd: fixtureDirectory,
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
          reject(new Error('module-init rollback scenario timed out'))
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
                `module-init rollback scenario exited with code ${code} and signal ${signal}\n${output}`,
              ),
            )
          }
        })
      }),
    )
  },
)
