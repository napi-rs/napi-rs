import { spawn } from 'node:child_process'
import { access, copyFile, readFile, rm } from 'node:fs/promises'
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
  let copied = false
  for (const candidate of [
    'custom_async_runtime.wasm32-wasi.debug.wasm',
    'custom_async_runtime.wasm32-wasi.wasm',
  ]) {
    const candidatePath = join(outputDirectory, candidate)
    try {
      await access(candidatePath)
      await copyFile(candidatePath, outputPath)
      copied = true
      break
    } catch {}
  }

  if (!copied) {
    throw new Error('threadless WASI build did not produce a wasm artifact')
  }
  const wasmModule = new WebAssembly.Module(await readFile(outputPath))
  const wasmExports = WebAssembly.Module.exports(wasmModule).map(
    ({ name }) => name,
  )
  if (!wasmExports.includes('napi_prepare_wasm_env_cleanup')) {
    throw new Error(
      'threadless WASI build did not export napi_prepare_wasm_env_cleanup',
    )
  }
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
