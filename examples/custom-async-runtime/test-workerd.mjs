import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const execFileAsync = promisify(execFile)
const packageDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(packageDir, '../..')
const napiCli = join(repoDir, 'cli/cli.mjs')
const packageName = '@examples/custom-async-runtime'
const flavorPackageName = `${packageName}-wasm32-wasip1`
const publicWasmSpecifier = `${packageName}/wasm.wasm`
const rootFiles = ['index.cjs', 'index.d.cts', 'browser.js']
const maxBuffer = 64 * 1024 * 1024
const tempDir = await mkdtemp(join(tmpdir(), 'napi-rs-workerd-'))
let mf

function fileDependency(from, path) {
  return `file:${relative(from, path).split(sep).join('/')}`
}

async function run(command, arguments_, options = {}) {
  return execFileAsync(command, arguments_, {
    maxBuffer,
    ...options,
    env: { ...process.env, ...options.env },
  })
}

async function runNapi(arguments_) {
  await run(process.execPath, [napiCli, ...arguments_])
}

async function packPackage(sourceDir, destination) {
  const { stdout } = await run(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { cwd: sourceDir },
  )
  const result = JSON.parse(stdout)
  assert.equal(result.length, 1)
  assert.equal(typeof result[0].filename, 'string')
  return join(destination, result[0].filename)
}

function resolvePnpm(consumerDir) {
  const candidates =
    process.platform === 'win32'
      ? [
          ['pnpm.cmd', []],
          ['corepack.cmd', ['pnpm']],
        ]
      : [
          ['pnpm', []],
          ['corepack', ['pnpm']],
        ]

  for (const [command, arguments_] of candidates) {
    const probe = spawnSync(command, [...arguments_, '--version'], {
      cwd: consumerDir,
      env: process.env,
      stdio: 'ignore',
    })
    if (probe.status === 0) {
      return { command, arguments_ }
    }
  }
  throw new Error('pnpm or Corepack is required for the isolated consumer')
}

async function stageRelease(releaseDir) {
  await mkdir(releaseDir, { recursive: true })
  const packageJson = JSON.parse(
    await readFile(join(packageDir, 'package.json'), 'utf8'),
  )
  packageJson.files = rootFiles
  await writeFile(
    join(releaseDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  await Promise.all(
    rootFiles.map((file) =>
      copyFile(join(packageDir, file), join(releaseDir, file)),
    ),
  )

  await runNapi(['create-npm-dirs', '--cwd', releaseDir])
  const flavorDir = join(releaseDir, 'npm', 'wasm32-wasip1')
  const flavorManifest = JSON.parse(
    await readFile(join(flavorDir, 'package.json'), 'utf8'),
  )
  for (const file of flavorManifest.files) {
    try {
      await access(join(flavorDir, file))
    } catch {
      await copyFile(join(packageDir, file), join(flavorDir, file))
    }
  }

  await runNapi([
    'pre-publish',
    '--cwd',
    releaseDir,
    '--tag-style',
    'npm',
    '--no-gh-release',
    '--skip-optional-publish',
  ])
  return flavorDir
}

try {
  const releaseDir = join(tempDir, 'release')
  const tarballDir = join(tempDir, 'tarballs')
  const consumerDir = join(tempDir, 'consumer')
  const consumerWorkerdDir = join(consumerDir, 'workerd')
  await Promise.all([
    mkdir(tarballDir, { recursive: true }),
    mkdir(consumerWorkerdDir, { recursive: true }),
  ])

  const flavorDir = await stageRelease(releaseDir)
  const [flavorTarball, rootTarball, wasmRuntimeTarball] = await Promise.all([
    packPackage(flavorDir, tarballDir),
    packPackage(releaseDir, tarballDir),
    packPackage(join(repoDir, 'wasm-runtime'), tarballDir),
  ])

  await writeFile(
    join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'custom-async-runtime-workerd-consumer',
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.10.0',
        dependencies: {
          [packageName]: fileDependency(consumerDir, rootTarball),
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerDir, 'pnpm-workspace.yaml'),
    `overrides:
  ${JSON.stringify(flavorPackageName)}: ${JSON.stringify(fileDependency(consumerDir, flavorTarball))}
  ${JSON.stringify('@napi-rs/wasm-runtime')}: ${JSON.stringify(fileDependency(consumerDir, wasmRuntimeTarball))}
`,
  )
  await copyFile(
    join(packageDir, 'workerd/worker.mjs'),
    join(consumerWorkerdDir, 'worker.mjs'),
  )

  const pnpm = resolvePnpm(consumerDir)
  await run(
    pnpm.command,
    [
      ...pnpm.arguments_,
      'install',
      '--ignore-scripts',
      '--config.node-linker=isolated',
    ],
    {
      cwd: consumerDir,
      env: { COREPACK_ENABLE_PROJECT_SPEC: '0' },
    },
  )

  await assert.rejects(
    access(join(consumerDir, 'node_modules', flavorPackageName)),
    (error) => error?.code === 'ENOENT',
  )

  const workerPath = join(consumerWorkerdDir, 'worker.mjs')
  const consumerRequire = createRequire(pathToFileURL(workerPath))
  const publicWorkerdPath = consumerRequire.resolve(`${packageName}/workerd`)
  const publicWasmPath = consumerRequire.resolve(publicWasmSpecifier)
  assert.match(publicWorkerdPath, /\.wasm32-wasip1\.workerd\.mjs$/)
  assert.match(publicWasmPath, /\.wasm32-wasip1\.wasm$/)
  assert.match(
    await readFile(publicWorkerdPath, 'utf8'),
    new RegExp(`${flavorPackageName.replaceAll('/', '\\/')}/workerd`),
  )

  const bundlePath = join(consumerWorkerdDir, 'worker.bundle.mjs')
  const compiledWasmPath = join(
    consumerWorkerdDir,
    'custom_async_runtime.public.wasm',
  )
  const buildResult = await build({
    absWorkingDir: consumerDir,
    entryPoints: [workerPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: bundlePath,
    metafile: true,
    plugins: [
      {
        name: 'workerd-compiled-wasm',
        setup(build) {
          build.onResolve(
            {
              filter: new RegExp(
                `^${publicWasmSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
              ),
            },
            () => ({
              path: './custom_async_runtime.public.wasm',
              external: true,
            }),
          )
        },
      },
    ],
    // Intentionally do not shim `setImmediate`: emnapi 1.11.2 includes
    // toyobayashi/emnapi#221, so this fixture exercises the released bound-host
    // function path directly and would regress to "Illegal invocation" without it.
  })
  assert.ok(
    Object.keys(buildResult.metafile.inputs).some((path) =>
      path.endsWith('.wasm32-wasip1.workerd.mjs'),
    ),
    'bundle must traverse the root package workerd facade',
  )
  assert.ok(
    Object.keys(buildResult.metafile.inputs).some((path) =>
      path.endsWith('.wasip1-deferred.js'),
    ),
    'bundle must resolve the transitive flavor workerd loader',
  )

  mf = new Miniflare({
    compatibilityDate: '2026-06-01',
    modulesRoot: consumerDir,
    modules: [
      {
        type: 'ESModule',
        path: bundlePath,
      },
      {
        type: 'CompiledWasm',
        path: compiledWasmPath,
        contents: await readFile(publicWasmPath),
      },
    ],
  })

  const res = await mf.dispatchFetch('http://localhost/')
  if (res.status !== 200) {
    // Surface the workerd error page in CI logs before failing.
    assert.fail(`worker returned ${res.status}: ${await res.text()}`)
  }
  const body = await res.json()
  console.log('workerd result:', body)
  assert.equal(body.isWasm, true)
  // Mirror test.mjs semantics: asyncDouble doubles, spawnFuture/blockOnValue
  // return value + 1.
  assert.deepEqual(body.results, [42, 200, 8])
  assert.equal(body.blockOn, 6)
  assert.deepEqual(body.buffer, [0, 1, 255])
  assert.equal(body.rejected, true)
  // 4 async tasks were spawned: 2x asyncDouble, 1x spawnFuture, 1x asyncError.
  assert.ok(body.spawnCalls >= 4, `spawnCalls: ${body.spawnCalls}`)
  assert.equal(body.hasGlobalBuffer, false)
  assert.equal(body.hasNodeProcess, false)
  console.log('workerd single-thread async runtime OK')
} finally {
  try {
    await mf?.dispose()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
