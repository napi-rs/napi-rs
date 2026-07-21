import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const testScript = join(packageDirectory, 'test.mjs')

function runNode(arguments_, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, options)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(
          new Error(
            `${arguments_.join(' ')} exited with code ${code} and signal ${signal}`,
          ),
        )
      }
    })
  })
}

const outputDirectory = await mkdtemp(
  join(tmpdir(), 'napi-custom-runtime-threadless-'),
)
try {
  await runNode(
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

  const outputPath = join(
    packageDirectory,
    'custom_async_runtime.wasm32-wasip1.wasm',
  )
  const declarationPath = join(outputDirectory, 'index.d.cts')
  await copyFile(
    join(outputDirectory, 'custom_async_runtime.wasm32-wasip1.wasm'),
    outputPath,
  )
  const declarations = await readFile(declarationPath, 'utf8')
  if (declarations.includes('retainTaskWaker')) {
    throw new Error('threadless WASI declarations exposed retainTaskWaker')
  }

  await runNode([testScript, 'wasi-threadless'], {
    cwd: packageDirectory,
    env: {
      ...process.env,
      NAPI_RS_TEST_THREADLESS_WASI_DECLARATION: declarationPath,
    },
    stdio: 'inherit',
  })
} finally {
  await rm(outputDirectory, { force: true, recursive: true })
}
