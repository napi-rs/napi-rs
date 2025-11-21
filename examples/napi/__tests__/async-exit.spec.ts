import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const bindingPath = join(projectRoot, 'index.cjs')

test('async napi functions let the process exit', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }

  const script = `
    const { asyncMultiTwo } = require(${JSON.stringify(bindingPath)});
    (async () => {
      const value = await asyncMultiTwo(21);
      if (value !== 42) {
        process.exitCode = 1;
      }
    })();
  `

  const child = spawn(process.execPath, ['-e', script], {
    cwd: projectRoot,
  })

  const stdout: string[] = []
  const stderr: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (data) => stdout.push(String(data)))
  child.stderr?.on('data', (data) => stderr.push(String(data)))

  const timeoutMs = 8000
  let timeout: NodeJS.Timeout | undefined

  try {
    const result = (await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once('error', reject)
          child.once('exit', (code, signal) => resolve({ code, signal }))
        },
      ),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill()
          }
          reject(
            new Error(`Timed out waiting ${timeoutMs}ms for child to exit`),
          )
        }, timeoutMs)
      }),
    ])) as { code: number | null; signal: NodeJS.Signals | null }

    t.is(result.signal, null, `child exited with signal ${result.signal ?? ''}`)
    t.is(
      result.code,
      0,
      `child exited with code ${result.code}, stderr: ${stderr.join('')}`,
    )
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }
})
