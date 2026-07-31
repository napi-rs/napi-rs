import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const testScript = join(packageDirectory, 'test.mjs')
// The combined build's loader has to sit inside the package so Node resolves
// `@napi-rs/wasm-runtime` and `@emnapi/*` from the repo's node_modules; a
// loader left in the OS temp directory cannot. Kept out of the artifacts the
// other lanes share by living in its own directory.
const combinedDirectory = join(packageDirectory, '.combined-wasi')

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
const combinedOutputDirectory = await mkdtemp(
  join(tmpdir(), 'napi-custom-runtime-combined-'),
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

  const declarationPath = join(outputDirectory, 'index.d.cts')
  // The generated loaders come along so `test.mjs` can drive the real
  // `__rollbackWasiInitialization` / `__createInstance` catch paths, not just
  // the hand-written loader.
  for (const file of [
    'custom_async_runtime.wasm32-wasip1.wasm',
    'custom_async_runtime.wasip1.cjs',
    'custom_async_runtime.wasip1-deferred.js',
  ]) {
    await copyFile(join(outputDirectory, file), join(packageDirectory, file))
  }
  // The generated eager loader prefers the debug wasm when one is present, so
  // keep it in lockstep: take the freshly built one, or drop a stale one left
  // behind by `build.mjs` rather than silently running a different binary than
  // the loaders were generated for.
  const debugWasm = 'custom_async_runtime.wasm32-wasip1.debug.wasm'
  try {
    await copyFile(
      join(outputDirectory, debugWasm),
      join(packageDirectory, debugWasm),
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    await rm(join(packageDirectory, debugWasm), { force: true })
  }
  const declarations = await readFile(declarationPath, 'utf8')
  if (declarations.includes('retainTaskWaker')) {
    throw new Error('threadless WASI declarations exposed retainTaskWaker')
  }

  // Second, a *combined* `async-runtime` + `tokio_rt` build of the same addon.
  // Every other lane builds one backend or the other; this is the only place
  // both exist at once, which is the configuration where napi's Tokio
  // compatibility helpers can reach a built-in runtime the cleanup barrier
  // never drained (because a custom backend owns the lifecycle and the slot was
  // never constructed). It goes to its own directory so the threadless
  // artifacts copied above stay the ones every other lane loads.
  await runNode(
    [
      napiCli,
      'build',
      '--target',
      'wasm32-wasip1',
      '--platform',
      '--no-js',
      '--dts',
      'index.d.cts',
      '--output-dir',
      combinedOutputDirectory,
      '--profile',
      'wasi',
    ],
    {
      cwd: packageDirectory,
      env: process.env,
      stdio: 'inherit',
    },
  )
  await rm(combinedDirectory, { force: true, recursive: true })
  await mkdir(combinedDirectory, { recursive: true })
  for (const file of [
    'custom_async_runtime.wasm32-wasip1.wasm',
    'custom_async_runtime.wasip1.cjs',
  ]) {
    await copyFile(
      join(combinedOutputDirectory, file),
      join(combinedDirectory, file),
    )
  }
  const combinedDebugWasm = join(combinedOutputDirectory, debugWasm)
  try {
    await copyFile(combinedDebugWasm, join(combinedDirectory, debugWasm))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  await runNode([testScript, 'wasi-threadless'], {
    cwd: packageDirectory,
    env: {
      ...process.env,
      NAPI_RS_TEST_THREADLESS_WASI_DECLARATION: declarationPath,
      NAPI_RS_TEST_COMBINED_WASI_DIR: combinedDirectory,
    },
    stdio: 'inherit',
  })
} finally {
  await rm(outputDirectory, { force: true, recursive: true })
  await rm(combinedOutputDirectory, { force: true, recursive: true })
  await rm(combinedDirectory, { force: true, recursive: true })
}
