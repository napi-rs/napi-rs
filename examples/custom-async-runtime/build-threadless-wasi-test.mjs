import { spawn } from 'node:child_process'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const outputDirectory = join(packageDirectory, '.threadless-wasi-test')

await rm(outputDirectory, { force: true, recursive: true })
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        napiCli,
        'build',
        '--target',
        'wasm32-wasip1',
        '--platform',
        '--no-js',
        '--no-default-features',
        '--features',
        'async-runtime',
        '--dts',
        'index.d.cts',
        '--output-dir',
        outputDirectory,
        '--profile',
        'wasi',
      ],
      {
        cwd: packageDirectory,
        env: process.env,
        stdio: 'inherit',
      },
    )
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(
          new Error(
            `threadless WASI build exited with code ${code} and signal ${signal}`,
          ),
        )
      }
    })
  })

  const outputPath = join(
    packageDirectory,
    'custom_async_runtime.wasm32-wasip1.wasm',
  )
  await copyFile(
    join(outputDirectory, 'custom_async_runtime.wasm32-wasip1.wasm'),
    outputPath,
  )
  const declarations = await readFile(
    join(outputDirectory, 'index.d.cts'),
    'utf8',
  )
  if (declarations.includes('retainTaskWaker')) {
    throw new Error('threadless WASI declarations exposed retainTaskWaker')
  }
} finally {
  await rm(outputDirectory, { force: true, recursive: true })
}
