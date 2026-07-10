import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
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
import { chromium } from 'playwright'
import { createServer } from 'vite'

const execFileAsync = promisify(execFile)
const fixtureDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(fixtureDir, '..')
const repoDir = resolve(packageDir, '../..')
const napiCli = join(repoDir, 'cli/cli.mjs')
const packageName = '@examples/napi'
const flavorPackageName = `${packageName}-wasm32-wasip1`
const publicWasmSpecifier = `${packageName}/wasm`
const publicWasmAliasSpecifier = `${packageName}/wasm.wasm`
const rootFiles = ['index.cjs', 'index.d.cts', 'browser.js']
const copiedLoaderFiles = [
  'example.wasip1.cjs',
  'example.wasip1-browser.js',
  'example.wasip1-deferred.js',
]
const initialPages = 1024
const pageBytes = 64 * 1024
const maxWorkerdMemoryBytes = 128 * 1024 * 1024
const maxBuffer = 64 * 1024 * 1024
const tempDir = await mkdtemp(join(tmpdir(), 'napi-rs-public-wasi-'))

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

function readPnpmPackageManager(packageJson) {
  const packageManager = packageJson.packageManager
  const match =
    typeof packageManager === 'string'
      ? packageManager.match(
          /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+.+)?$/,
        )
      : null
  assert.ok(match, 'the pnpm fixture must declare an exact packageManager')
  const version = match[1]
  const engine = packageJson.devEngines?.packageManager
  if (engine !== undefined) {
    assert.equal(engine.name, 'pnpm')
    assert.ok(
      engine.version === version ||
        engine.version === packageManager.slice('pnpm@'.length),
      'packageManager and devEngines.packageManager must agree',
    )
  }
  return { packageManager, version }
}

function resolvePnpm(packageJson, consumerDir) {
  const pnpm = readPnpmPackageManager(packageJson)
  const candidates =
    process.platform === 'win32'
      ? [
          ['corepack.cmd', [pnpm.packageManager]],
          ['pnpm.cmd', []],
        ]
      : [
          ['corepack', [pnpm.packageManager]],
          ['pnpm', []],
        ]

  for (const [command, arguments_] of candidates) {
    const probe = spawnSync(command, [...arguments_, '--version'], {
      cwd: consumerDir,
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '1' },
      encoding: 'utf8',
    })
    if (probe.status === 0 && probe.stdout.trim() === pnpm.version) {
      return { command, arguments_ }
    }
  }
  throw new Error(
    `Could not execute the fixture package manager ${pnpm.packageManager}`,
  )
}

async function rewriteInitialMemory(path) {
  const source = await readFile(path, 'utf8')
  const descriptor = /initial:\s*16384,/g
  assert.equal(
    [...source.matchAll(descriptor)].length,
    1,
    `${relative(packageDir, path)} must contain one 16,384-page descriptor`,
  )
  await writeFile(path, source.replace(descriptor, `initial: ${initialPages},`))
}

async function stageRelease(releaseDir) {
  await mkdir(releaseDir, { recursive: true })
  const packageJson = JSON.parse(
    await readFile(join(packageDir, 'package.json'), 'utf8'),
  )
  packageJson.main = './index.cjs'
  packageJson.types = './index.d.cts'
  packageJson.browser = './browser.js'
  packageJson.files = rootFiles
  packageJson.napi.targets = ['wasm32-wasip1']
  packageJson.napi.wasm.initialMemory = initialPages
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
  await Promise.all(
    copiedLoaderFiles.map((file) =>
      rewriteInitialMemory(join(flavorDir, file)),
    ),
  )

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

function assertStagedMemory(source, file) {
  assert.match(source, new RegExp(`initial:\\s*${initialPages},`), file)
  assert.doesNotMatch(source, /initial:\s*16384,/, file)
}

async function runBrowserTest(consumerDir) {
  let browser
  const browserRoot = await realpath(consumerDir)
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: browserRoot,
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  })

  try {
    await server.listen()
    const address = server.httpServer?.address()
    assert.ok(address && typeof address === 'object')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    page.setDefaultTimeout(120_000)
    await page.goto(`http://127.0.0.1:${address.port}/browser/`, {
      waitUntil: 'load',
    })
    const result = await page.evaluate(async () => {
      return globalThis.__napiPublicSurfaceTest
    })

    assert.equal(result.crossOriginIsolated, false)
    assert.equal(result.sharedArrayBufferType, 'undefined')
    assert.equal(result.hasGlobalBuffer, false)
    assert.equal(result.add, 42)
    assert.equal(result.output, 'Hello world')
    assert.equal(result.outputIsBuffer, true)
    assert.equal(result.appended, 'browser threadless input!')
    assert.equal(result.appendedIsBuffer, true)
    assert.equal(result.tokioError, result.expectedTokioError)
    assert.equal(result.addAfterTokioError, 42)
    return result
  } finally {
    await browser?.close()
    await server.close()
  }
}

async function dispatchWorkerd(modules, consumerDir, pathname) {
  const mf = new Miniflare({
    compatibilityDate: '2026-06-01',
    modulesRoot: consumerDir,
    modules,
  })

  try {
    const response = await mf.dispatchFetch(`http://localhost${pathname}`)
    if (response.status !== 200) {
      assert.fail(
        `workerd ${pathname} returned ${response.status}: ${await response.text()}`,
      )
    }
    return response.json()
  } finally {
    await mf.dispose()
  }
}

async function runWorkerdTests(
  consumerDir,
  workerPath,
  publicWorkerdPath,
  publicWasmPath,
) {
  const workerdDir = dirname(workerPath)
  const bundlePath = join(workerdDir, 'worker.bundle.mjs')
  const compiledWasmPath = join(workerdDir, 'example.public.wasm')
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
        setup(buildContext) {
          buildContext.onResolve(
            {
              filter: new RegExp(
                `^${publicWasmSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
              ),
            },
            () => ({
              path: './example.public.wasm',
              external: true,
            }),
          )
        },
      },
    ],
  })
  const publicWorkerdFile = publicWorkerdPath.split(sep).at(-1)
  assert.ok(
    Object.keys(buildResult.metafile.inputs).some((path) =>
      path.endsWith(publicWorkerdFile),
    ),
    'bundle must traverse the root package workerd facade',
  )
  assert.ok(
    Object.keys(buildResult.metafile.inputs).some((path) =>
      path.endsWith('.wasip1-deferred.js'),
    ),
    'bundle must resolve the transitive flavor workerd loader',
  )

  const modules = [
    {
      type: 'ESModule',
      path: bundlePath,
    },
    {
      type: 'CompiledWasm',
      path: compiledWasmPath,
      contents: await readFile(publicWasmPath),
    },
  ]
  const lifecycle = await dispatchWorkerd(modules, consumerDir, '/lifecycle')
  assert.equal(lifecycle.add, 42)
  assert.equal(lifecycle.output, 'Hello world')
  assert.equal(lifecycle.outputIsBuffer, true)
  assert.equal(lifecycle.appended, 'workerd threadless input!')
  assert.equal(lifecycle.appendedIsBuffer, true)
  assert.equal(lifecycle.tokioError, lifecycle.expectedTokioError)
  assert.equal(lifecycle.addAfterTokioError, 42)
  assert.equal(lifecycle.independentExportsAreDistinct, true)
  assert.equal(lifecycle.firstIndependentAdd, 42)
  assert.equal(lifecycle.secondAfterFirstDispose, 42)
  assert.equal(lifecycle.recreatedAdd, 42)
  assert.equal(lifecycle.hasGlobalBuffer, false)
  assert.equal(lifecycle.hasNodeProcess, false)

  const growth = await dispatchWorkerd(modules, consumerDir, '/growth')
  const initialMemoryBytes = initialPages * pageBytes
  assert.ok(
    growth.beforeBytes >= initialMemoryBytes &&
      growth.beforeBytes <= initialMemoryBytes + 4 * 1024 * 1024,
    `expected startup memory near 64 MiB, got ${growth.beforeBytes}`,
  )
  assert.ok(
    growth.afterBytes > growth.beforeBytes,
    `expected memory growth beyond ${growth.beforeBytes}, got ${growth.afterBytes}`,
  )
  assert.ok(
    growth.afterBytes <= maxWorkerdMemoryBytes,
    `grown linear memory exceeds 128 MiB: ${growth.afterBytes}`,
  )
  assert.equal(growth.allocationBytes, 48 * 1024 * 1024)
  assert.equal(growth.allocationType, 'CustomFinalize')
  assert.equal(growth.addAfterGrowth, 42)
  return { lifecycle, growth }
}

try {
  const releaseDir = join(tempDir, 'release')
  const tarballDir = join(tempDir, 'tarballs')
  const consumerDir = join(tempDir, 'consumer')
  const consumerBrowserDir = join(consumerDir, 'browser')
  const consumerWorkerdDir = join(consumerDir, 'workerd')
  await Promise.all([
    mkdir(tarballDir, { recursive: true }),
    mkdir(consumerBrowserDir, { recursive: true }),
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
        name: 'napi-public-wasi-consumer',
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
  const writtenConsumerManifest = JSON.parse(
    await readFile(join(consumerDir, 'package.json'), 'utf8'),
  )
  await writeFile(
    join(consumerDir, 'pnpm-workspace.yaml'),
    `overrides:
  ${JSON.stringify(flavorPackageName)}: ${JSON.stringify(fileDependency(consumerDir, flavorTarball))}
  ${JSON.stringify('@napi-rs/wasm-runtime')}: ${JSON.stringify(fileDependency(consumerDir, wasmRuntimeTarball))}
`,
  )
  await Promise.all([
    copyFile(
      join(fixtureDir, 'browser/index.html'),
      join(consumerBrowserDir, 'index.html'),
    ),
    copyFile(
      join(fixtureDir, 'browser/test.mjs'),
      join(consumerBrowserDir, 'test.mjs'),
    ),
    copyFile(
      join(fixtureDir, 'workerd/worker.mjs'),
      join(consumerWorkerdDir, 'worker.mjs'),
    ),
  ])

  const pnpm = resolvePnpm(writtenConsumerManifest, consumerDir)
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
      env: { COREPACK_ENABLE_PROJECT_SPEC: '1' },
    },
  )

  await assert.rejects(
    access(join(consumerDir, 'node_modules', flavorPackageName)),
    (error) => error?.code === 'ENOENT',
  )

  const workerPath = join(consumerWorkerdDir, 'worker.mjs')
  const consumerRequire = createRequire(pathToFileURL(workerPath))
  const rootEntryPath = consumerRequire.resolve(packageName)
  const rootPackageDir = dirname(rootEntryPath)
  const rootManifest = JSON.parse(
    await readFile(join(rootPackageDir, 'package.json'), 'utf8'),
  )
  assert.equal(rootManifest.exports['.'].browser, './browser.js')
  assert.deepEqual(rootManifest.exports['./workerd'], {
    types: './example.wasm32-wasip1.workerd.d.mts',
    default: './example.wasm32-wasip1.workerd.mjs',
  })
  const expectedWasmExport = {
    types: './example.wasm32-wasip1.wasm.d.mts',
    default: './example.wasm32-wasip1.wasm',
  }
  assert.deepEqual(rootManifest.exports['./wasm'], expectedWasmExport)
  assert.deepEqual(rootManifest.exports['./wasm.wasm'], expectedWasmExport)
  assert.match(
    await readFile(join(rootPackageDir, 'browser.js'), 'utf8'),
    new RegExp(flavorPackageName.replaceAll('/', '\\/')),
  )

  const publicWorkerdPath = consumerRequire.resolve(`${packageName}/workerd`)
  const publicWasmPath = consumerRequire.resolve(publicWasmSpecifier)
  const publicWasmAliasPath = consumerRequire.resolve(publicWasmAliasSpecifier)
  assert.match(publicWorkerdPath, /\.wasm32-wasip1\.workerd\.mjs$/)
  assert.match(publicWasmPath, /\.wasm32-wasip1\.wasm$/)
  assert.equal(publicWasmAliasPath, publicWasmPath)
  assert.match(
    await readFile(publicWorkerdPath, 'utf8'),
    new RegExp(`${flavorPackageName.replaceAll('/', '\\/')}/workerd`),
  )

  const flavorRequire = createRequire(pathToFileURL(publicWorkerdPath))
  const flavorEntryPath = flavorRequire.resolve(flavorPackageName)
  const flavorPackageDir = dirname(flavorEntryPath)
  const flavorWasmPath = flavorRequire.resolve(`${flavorPackageName}/wasm`)
  const flavorWasmAliasPath = flavorRequire.resolve(
    `${flavorPackageName}/wasm.wasm`,
  )
  assert.equal(flavorWasmAliasPath, flavorWasmPath)
  assert.deepEqual(
    await readFile(publicWasmPath),
    await readFile(flavorWasmPath),
  )
  await Promise.all(
    copiedLoaderFiles.map(async (file) => {
      assertStagedMemory(
        await readFile(join(flavorPackageDir, file), 'utf8'),
        file,
      )
    }),
  )

  const browserResult = await runBrowserTest(consumerDir)
  const workerdResult = await runWorkerdTests(
    consumerDir,
    workerPath,
    publicWorkerdPath,
    publicWasmPath,
  )
  console.log(
    'threadless WASI public surfaces passed:',
    JSON.stringify({
      browser: browserResult,
      workerd: workerdResult,
    }),
  )
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
