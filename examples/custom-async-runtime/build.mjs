import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const userArguments = process.argv.slice(2)

function run(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [napiCli, 'build', ...arguments_], {
      cwd: packageDirectory,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(
          new Error(
            `napi build ${arguments_.join(' ')} exited with code ${code} and signal ${signal}`,
          ),
        )
      }
    })
  })
}

await run([
  '--platform',
  '--js',
  'index.cjs',
  '--dts',
  'index.d.cts',
  ...userArguments,
])
