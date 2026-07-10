import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import ava, { type TestFn } from 'ava'

import {
  createWasmModuleTypeDef,
  resolvePackageReconciliationPaths,
  withFileSystemReconciliation,
} from '../../utils/index.js'
import { createWasiDeferredBindingTypeDef } from '../build.js'
import { createNpmDirs } from '../create-npm-dirs.js'
import { createWasiDeferredBrowserBinding } from '../templates/load-wasi-template.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const transactionJournalName = '.napi-rs-filesystem-transaction.swp'

function createNativeTargets(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => {
    const abi = `${prefix}${index.toString().padStart(3, '0')}`
    return {
      platformArchABI: `linux-x64-${abi}`,
      triple: `x86_64-unknown-linux-${abi}`,
    }
  })
}

async function readPackageVersion(path: string) {
  return JSON.parse(await readFile(path, 'utf8')).version as string
}

function resolveNpmCliFrom(directory: string) {
  for (const candidate of [
    join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    if (existsSync(candidate)) {
      return realpathSync(candidate)
    }
  }
}

function resolveNpmCli(
  nodeExecutable = process.execPath,
  searchPath = process.env.PATH ?? '',
  platform = process.platform,
) {
  const bundledNpmCli = resolveNpmCliFrom(dirname(nodeExecutable))
  if (bundledNpmCli) {
    return bundledNpmCli
  }

  const npmLauncher = platform === 'win32' ? 'npm.cmd' : 'npm'

  for (const pathEntry of searchPath.split(delimiter).filter(Boolean)) {
    const launcherPath = join(pathEntry, npmLauncher)
    if (!existsSync(launcherPath)) {
      continue
    }

    const resolvedLauncherPath = realpathSync(launcherPath)
    if (resolvedLauncherPath.endsWith('npm-cli.js')) {
      return resolvedLauncherPath
    }

    const prefixedNpmCli =
      resolveNpmCliFrom(dirname(resolvedLauncherPath)) ??
      resolveNpmCliFrom(dirname(launcherPath))
    if (prefixedNpmCli) {
      return prefixedNpmCli
    }
  }

  throw new Error(`Could not resolve ${npmLauncher} from PATH`)
}

const test = ava as TestFn<{
  tmpDir: string
  packageJsonPath: string
  npmConfigRegistry?: string
}>
const crashRecoveryTest = process.platform === 'win32' ? test.skip : test.serial

test.beforeEach(async (t) => {
  // Create a unique temp directory for tests
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `create-npm-dirs-${timestamp}-${random}`,
  )
  const packageJsonPath = join(tmpDir, 'package.json')

  // Create the directory
  await mkdir(tmpDir, { recursive: true })

  t.context = {
    tmpDir,
    packageJsonPath,
    npmConfigRegistry: process.env.npm_config_registry,
  }
})

test.afterEach.always(async (t) => {
  if (t.context.npmConfigRegistry === undefined) {
    delete process.env.npm_config_registry
  } else {
    process.env.npm_config_registry = t.context.npmConfigRegistry
  }

  // Clean up any created directories
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('resolves npm from a bundled Windows Node installation', async (t) => {
  const nodeDir = join(t.context.tmpDir, 'node')
  const npmCli = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await mkdir(dirname(npmCli), { recursive: true })
  await writeFile(npmCli, '')

  t.is(
    resolveNpmCli(join(nodeDir, 'node.exe'), '', 'win32'),
    realpathSync(npmCli),
  )
})

test('resolves npm from a Windows launcher prefix', async (t) => {
  const nodeDir = join(t.context.tmpDir, 'node')
  const npmPrefix = join(t.context.tmpDir, 'npm-prefix')
  const npmCli = join(npmPrefix, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await mkdir(dirname(npmCli), { recursive: true })
  await writeFile(join(npmPrefix, 'npm.cmd'), '')
  await writeFile(npmCli, '')

  t.is(
    resolveNpmCli(join(nodeDir, 'node.exe'), npmPrefix, 'win32'),
    realpathSync(npmCli),
  )
})

async function startRegistryServer(
  responseBody: Record<string, unknown> = {
    'dist-tags': {
      latest: '1.2.3',
    },
  },
) {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(responseBody))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Failed to resolve test registry server address')
  }

  return {
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      }),
    origin: `http://127.0.0.1:${address.port}`,
  }
}

test('should omit exports fields from publishConfig in scoped packages', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  // Create a package.json with publishConfig that includes exports field
  const packageJson = {
    name: 'test-package',
    version: '1.0.0',
    publishConfig: {
      registry: 'https://custom-registry.com',
      access: 'public',
      exports: {
        '.': './dist/index.js',
        './package.json': './package.json',
      },
      tag: 'beta',
    },
    napi: {
      binaryName: 'test-package',
      targets: ['x86_64-unknown-linux-gnu'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  // Check that the scoped package directory was created
  const scopedDir = join(tmpDir, 'npm', 'linux-x64-gnu')
  t.true(existsSync(scopedDir))

  // Read the generated package.json for the scoped package
  const scopedPackageJsonPath = join(scopedDir, 'package.json')
  t.true(existsSync(scopedPackageJsonPath))

  const scopedPackageJson = JSON.parse(
    await readFile(scopedPackageJsonPath, 'utf-8'),
  )

  // Verify that publishConfig only contains registry and access, not exports
  t.truthy(scopedPackageJson.publishConfig)
  t.is(scopedPackageJson.publishConfig.registry, 'https://custom-registry.com')
  t.is(scopedPackageJson.publishConfig.access, 'public')
  t.is(scopedPackageJson.publishConfig.exports, undefined)
  t.is(scopedPackageJson.publishConfig.tag, undefined)
})

test('should handle package without publishConfig', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  // Create a package.json without publishConfig
  const packageJson = {
    name: 'test-package-no-config',
    version: '1.0.0',
    napi: {
      binaryName: 'test-package-no-config',
      targets: ['x86_64-unknown-linux-gnu'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  // Check that the scoped package directory was created
  const scopedDir = join(tmpDir, 'npm', 'linux-x64-gnu')
  t.true(existsSync(scopedDir))

  // Read the generated package.json for the scoped package
  const scopedPackageJsonPath = join(scopedDir, 'package.json')
  const scopedPackageJson = JSON.parse(
    await readFile(scopedPackageJsonPath, 'utf-8'),
  )

  // Verify that publishConfig is not present when not in source
  t.is(scopedPackageJson.publishConfig, undefined)
})

test('should preserve only registry and access in publishConfig', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  // Create a package.json with minimal publishConfig
  const packageJson = {
    name: 'test-package-minimal',
    version: '1.0.0',
    publishConfig: {
      registry: 'https://npm.company.com',
      access: 'restricted',
    },
    napi: {
      binaryName: 'test-package-minimal',
      targets: ['aarch64-apple-darwin'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  // Check that the scoped package directory was created
  const scopedDir = join(tmpDir, 'npm', 'darwin-arm64')
  t.true(existsSync(scopedDir))

  // Read the generated package.json for the scoped package
  const scopedPackageJsonPath = join(scopedDir, 'package.json')
  const scopedPackageJson = JSON.parse(
    await readFile(scopedPackageJsonPath, 'utf-8'),
  )

  // Verify that publishConfig contains exactly registry and access
  t.truthy(scopedPackageJson.publishConfig)
  t.is(scopedPackageJson.publishConfig.registry, 'https://npm.company.com')
  t.is(scopedPackageJson.publishConfig.access, 'restricted')
  t.is(Object.keys(scopedPackageJson.publishConfig).length, 2)
})

test('should handle WASM targets correctly with publishConfig', async (t) => {
  const { tmpDir, packageJsonPath } = t.context
  const registryServer = await startRegistryServer()

  // Create a package.json for WASM target
  const packageJson = {
    name: 'test-wasm-package',
    version: '1.0.0',
    publishConfig: {
      registry: `${registryServer.origin}/wasm`,
      access: 'public',
      exports: './wasm.js',
      browser: './browser.js',
    },
    napi: {
      binaryName: 'test-wasm-package',
      targets: ['wasm32-wasi-preview1-threads'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  try {
    await createNpmDirs({
      cwd: tmpDir,
      packageJsonPath: 'package.json',
    })

    // Check that the scoped package directory was created
    const scopedDir = join(tmpDir, 'npm', 'wasm32-wasi')
    t.true(existsSync(scopedDir))

    // Read the generated package.json for the scoped package
    const scopedPackageJsonPath = join(scopedDir, 'package.json')
    const scopedPackageJson = JSON.parse(
      await readFile(scopedPackageJsonPath, 'utf-8'),
    )

    // Verify that publishConfig is correctly filtered for WASM too
    t.truthy(scopedPackageJson.publishConfig)
    t.is(
      scopedPackageJson.publishConfig.registry,
      `${registryServer.origin}/wasm`,
    )
    t.is(scopedPackageJson.publishConfig.access, 'public')
    t.is(scopedPackageJson.publishConfig.exports, undefined)
    t.is(scopedPackageJson.publishConfig.browser, undefined)

    // Verify WASM-specific fields are set correctly
    t.truthy(scopedPackageJson.main)
    t.truthy(scopedPackageJson.browser)
    t.truthy(scopedPackageJson.dependencies)
  } finally {
    await registryServer.close()
  }
})

test('should preserve stricter node engine ranges for WASM targets', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  const packageJson = {
    name: 'test-wasm-engines',
    version: '1.0.0',
    engines: {
      node: '>=18',
    },
    napi: {
      binaryName: 'test-wasm-engines',
      targets: ['wasm32-wasi-preview1-threads'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  const scopedPackageJson = JSON.parse(
    await readFile(join(tmpDir, 'npm', 'wasm32-wasi', 'package.json'), 'utf-8'),
  )

  t.is(scopedPackageJson.engines.node, '>=18')
})

test('should intersect mixed node engine ranges with the WASI minimum', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  const packageJson = {
    name: 'test-wasm-mixed-engines',
    version: '1.0.0',
    engines: {
      node: '>=12 <14 || >=18',
    },
    napi: {
      binaryName: 'test-wasm-mixed-engines',
      targets: ['wasm32-wasi-preview1-threads'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  const scopedPackageJson = JSON.parse(
    await readFile(join(tmpDir, 'npm', 'wasm32-wasi', 'package.json'), 'utf-8'),
  )

  t.is(scopedPackageJson.engines.node, '>=18.0.0')
})

test('should preserve sibling engine constraints when node is missing for WASM targets', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  const packageJson = {
    name: 'test-wasm-sibling-engines',
    version: '1.0.0',
    engines: {
      npm: '>=10',
    },
    napi: {
      binaryName: 'test-wasm-sibling-engines',
      targets: ['wasm32-wasi-preview1-threads'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  const scopedPackageJson = JSON.parse(
    await readFile(join(tmpDir, 'npm', 'wasm32-wasi', 'package.json'), 'utf-8'),
  )

  t.deepEqual(scopedPackageJson.engines, {
    npm: '>=10',
    node: '>=14.18.0',
  })
})

test('should replace an exact node engine below the WASI minimum for WASM targets', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  const packageJson = {
    name: 'test-wasm-exact-node-engine',
    version: '1.0.0',
    engines: {
      node: '13.0.0',
    },
    napi: {
      binaryName: 'test-wasm-exact-node-engine',
      targets: ['wasm32-wasi-preview1-threads'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  const scopedPackageJson = JSON.parse(
    await readFile(join(tmpDir, 'npm', 'wasm32-wasi', 'package.json'), 'utf-8'),
  )

  t.is(scopedPackageJson.engines.node, '>=14.18.0')
})

test('should drop exact node engine branches below the WASI minimum for WASM targets', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  const packageJson = {
    name: 'test-wasm-exact-node-branch',
    version: '1.0.0',
    engines: {
      node: '13.0.0 || >=18',
    },
    napi: {
      binaryName: 'test-wasm-exact-node-branch',
      targets: ['wasm32-wasi-preview1-threads'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  const scopedPackageJson = JSON.parse(
    await readFile(join(tmpDir, 'npm', 'wasm32-wasi', 'package.json'), 'utf-8'),
  )

  t.is(scopedPackageJson.engines.node, '>=18.0.0')
})

test.serial(
  'should include the deferred loader in files for non-threaded WASM targets',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-wasm-deferred',
      version: '1.0.0',
      napi: {
        binaryName: 'test-wasm-deferred',
        targets: ['wasm32-wasip1'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      const scopedPackageJson = JSON.parse(
        await readFile(
          join(tmpDir, 'npm', 'wasm32-wasip1', 'package.json'),
          'utf-8',
        ),
      )

      // Non-threaded flavors get their own distinctly named artifact set:
      // no worker scripts (the threadless loaders never spawn workers), and
      // the deferred workerd-safe loader ships alongside.
      t.is(scopedPackageJson.name, 'test-wasm-deferred-wasm32-wasip1')
      t.is(scopedPackageJson.main, 'test-wasm-deferred.wasip1.cjs')
      t.is(scopedPackageJson.types, 'test-wasm-deferred.wasip1.d.cts')
      t.is(scopedPackageJson.browser, 'test-wasm-deferred.wasip1-browser.js')
      t.is(scopedPackageJson.type, 'module')
      t.is(scopedPackageJson.cpu, undefined)
      t.deepEqual(scopedPackageJson.dependencies, {
        '@napi-rs/wasm-runtime': '^1.2.3',
        '@emnapi/core': require('emnapi/package.json').version,
        '@emnapi/runtime': require('emnapi/package.json').version,
      })
      t.deepEqual(scopedPackageJson.exports, {
        '.': {
          types: './test-wasm-deferred.wasip1.d.cts',
          browser: './test-wasm-deferred.wasip1-browser.js',
          require: './test-wasm-deferred.wasip1.cjs',
          default: './test-wasm-deferred.wasip1.cjs',
        },
        './workerd': {
          types: './test-wasm-deferred.wasip1-deferred.d.ts',
          default: './test-wasm-deferred.wasip1-deferred.js',
        },
        './wasm': {
          types: './test-wasm-deferred.wasm32-wasip1.wasm.d.ts',
          default: './test-wasm-deferred.wasm32-wasip1.wasm',
        },
        './wasm.wasm': {
          types: './test-wasm-deferred.wasm32-wasip1.wasm.d.ts',
          default: './test-wasm-deferred.wasm32-wasip1.wasm',
        },
        './package.json': './package.json',
      })
      t.deepEqual(scopedPackageJson.files, [
        'test-wasm-deferred.wasm32-wasip1.wasm',
        'test-wasm-deferred.wasip1.cjs',
        'test-wasm-deferred.wasip1.d.cts',
        'test-wasm-deferred.wasip1-browser.js',
        'test-wasm-deferred.wasip1-deferred.js',
        'test-wasm-deferred.wasip1-deferred.d.ts',
        'test-wasm-deferred.wasm32-wasip1.wasm.d.ts',
      ])
      t.is(
        await readFile(
          join(
            tmpDir,
            'npm',
            'wasm32-wasip1',
            'test-wasm-deferred.wasm32-wasip1.wasm.d.ts',
          ),
          'utf8',
        ),
        createWasmModuleTypeDef(),
      )
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'should add buffer only to WASI packages that import it',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-wasm-buffer',
      version: '1.0.0',
      napi: {
        binaryName: 'test-wasm-buffer',
        targets: [
          'wasm32-wasip1-threads',
          'wasm32-wasip1',
          'x86_64-unknown-linux-gnu',
        ],
        wasm: {
          browser: {
            buffer: true,
            fs: false,
          },
        },
      },
    }

    try {
      await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      const packageManifestPath = join(
        tmpDir,
        'npm',
        'wasm32-wasip1',
        'package.json',
      )
      const threadedManifestPath = join(
        tmpDir,
        'npm',
        'wasm32-wasi',
        'package.json',
      )
      const nativeManifestPath = join(
        tmpDir,
        'npm',
        'linux-x64-gnu',
        'package.json',
      )
      const directThreadlessManifest = JSON.parse(
        await readFile(packageManifestPath, 'utf8'),
      )
      const directThreadedManifest = JSON.parse(
        await readFile(threadedManifestPath, 'utf8'),
      )
      const directNativeManifest = JSON.parse(
        await readFile(nativeManifestPath, 'utf8'),
      )
      t.is(directThreadlessManifest.dependencies.buffer, '^6.0.3')
      t.is(directThreadedManifest.dependencies.buffer, '^6.0.3')
      t.is(directNativeManifest.dependencies?.buffer, undefined)

      packageJson.napi.wasm.browser.fs = true
      await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      const fsBufferManifest = JSON.parse(
        await readFile(packageManifestPath, 'utf8'),
      )
      const threadedFsBufferManifest = JSON.parse(
        await readFile(threadedManifestPath, 'utf8'),
      )
      const nativeFsBufferManifest = JSON.parse(
        await readFile(nativeManifestPath, 'utf8'),
      )
      t.is(fsBufferManifest.dependencies.buffer, '^6.0.3')
      t.is(threadedFsBufferManifest.dependencies.buffer, undefined)
      t.is(nativeFsBufferManifest.dependencies?.buffer, undefined)
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'untyped threadless WASI package packs with strict workerd types and Wasm exports',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageName = 'test-wasm-pack-install'
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        napi: {
          binaryName: packageName,
          targets: ['wasm32-wasip1'],
        },
      }),
    )

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })
      const packageDir = join(tmpDir, 'npm', 'wasm32-wasip1')
      const manifestPath = join(packageDir, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      for (const file of manifest.files) {
        await writeFile(
          join(packageDir, file),
          file.endsWith('.wasm')
            ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
            : file.endsWith('.wasm.d.ts')
              ? createWasmModuleTypeDef()
              : file.endsWith('.d.cts')
                ? 'declare const binding: Record<string, unknown>\nexport = binding\n'
                : file.endsWith('-deferred.js')
                  ? createWasiDeferredBrowserBinding(packageName, 1, 2)
                  : file.endsWith('-deferred.d.ts')
                    ? createWasiDeferredBindingTypeDef(packageName, false)
                    : file.endsWith('.cjs')
                      ? 'module.exports = {}\n'
                      : '',
        )
      }
      // Keep this test hermetic: it validates the generated package boundary,
      // not the external dependency registry.
      manifest.dependencies = {}
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

      const npmCli = resolveNpmCli()
      const { stdout } = await execFileAsync(
        process.execPath,
        [npmCli, 'pack', '--json', '--pack-destination', tmpDir],
        { cwd: packageDir },
      )
      const [{ filename }] = JSON.parse(stdout)
      const consumerDir = join(tmpDir, 'consumer')
      await mkdir(consumerDir)
      await writeFile(
        join(consumerDir, 'package.json'),
        JSON.stringify({
          name: 'consumer',
          private: true,
          type: 'module',
          optionalDependencies: {
            [manifest.name]: `file:${join(tmpDir, filename)}`,
          },
        }),
      )
      await execFileAsync(
        process.execPath,
        [
          npmCli,
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-package-lock',
        ],
        { cwd: consumerDir },
      )
      const wasmRuntimeDir = join(
        consumerDir,
        'node_modules',
        '@napi-rs',
        'wasm-runtime',
      )
      const emnapiRuntimeDir = join(
        consumerDir,
        'node_modules',
        '@emnapi',
        'runtime',
      )
      await mkdir(wasmRuntimeDir, { recursive: true })
      await mkdir(emnapiRuntimeDir, { recursive: true })
      await writeFile(
        join(wasmRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@napi-rs/wasm-runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(wasmRuntimeDir, 'index.js'),
        `export class WASI {}
export async function instantiateNapiModule(module) {
  if (!(module instanceof WebAssembly.Module)) {
    throw new TypeError('Invalid wasm module')
  }
  return { napiModule: { exports: { marker: 'workerd-export' } } }
}
`,
      )
      await writeFile(
        join(emnapiRuntimeDir, 'package.json'),
        JSON.stringify({
          name: '@emnapi/runtime',
          type: 'module',
          exports: './index.js',
        }),
      )
      await writeFile(
        join(emnapiRuntimeDir, 'index.js'),
        `export { createContext } from ${JSON.stringify(import.meta.resolve('@emnapi/runtime'))}
`,
      )
      const result = await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module'; import { createInstance } from '${packageName}-wasm32-wasip1/workerd'; const require = createRequire(import.meta.url); const initialListeners = new Set(process.rawListeners('beforeExit')); const countOwnedListeners = () => process.rawListeners('beforeExit').filter((listener) => !initialListeners.has(listener)).length; const wasm = readFileSync(require.resolve('${packageName}-wasm32-wasip1/wasm')); const wranglerWasm = readFileSync(require.resolve('${packageName}-wasm32-wasip1/wasm.wasm')); const module = new WebAssembly.Module(wasm); const instances = await Promise.all(Array.from({ length: 20 }, () => createInstance(module))); const liveListeners = countOwnedListeners(); const marker = instances[0].exports.marker; for (const instance of instances) instance.dispose(); process.stdout.write(JSON.stringify({ marker, sameWasm: wasm.equals(wranglerWasm), liveListeners, disposedListeners: countOwnedListeners() }))`,
        ],
        { cwd: consumerDir },
      )
      t.deepEqual(JSON.parse(result.stdout), {
        marker: 'workerd-export',
        sameWasm: true,
        liveListeners: 0,
        disposedListeners: 0,
      })
      const typeTestPath = join(consumerDir, 'workerd-export.ts')
      await writeFile(
        typeTestPath,
        `import { createInstance, instantiate } from '${packageName}-wasm32-wasip1/workerd'\nimport wasmModule from '${packageName}-wasm32-wasip1/wasm'\nimport extensionWasmModule from '${packageName}-wasm32-wasip1/wasm.wasm'\nwasmModule satisfies WebAssembly.Module\nextensionWasmModule satisfies WebAssembly.Module\nconst binding = await instantiate(wasmModule)\nbinding satisfies Record<string, unknown>\nconst instance = await createInstance(extensionWasmModule)\ninstance.exports satisfies Record<string, unknown>\ninstance.dispose()\n`,
      )
      await execFileAsync(
        process.execPath,
        [
          require.resolve('typescript/bin/tsc'),
          '--noEmit',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2022',
          '--strict',
          '--skipLibCheck',
          typeTestPath,
        ],
        { cwd: consumerDir },
      )
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'typed threadless WASI flavor is self-contained after direct pack and install',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageName = 'test-wasm-typed-pack-install'
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        napi: {
          binaryName: packageName,
          targets: ['wasm32-wasip1'],
        },
      }),
    )

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })
      const packageDir = join(tmpDir, 'npm', 'wasm32-wasip1')
      const manifestPath = join(packageDir, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      const loaderSpecifier = `./${packageName}.wasip1.cjs`
      for (const file of manifest.files) {
        await writeFile(
          join(packageDir, file),
          file.endsWith('.wasm')
            ? 'wasm-export'
            : file.endsWith('.wasm.d.ts')
              ? createWasmModuleTypeDef()
              : file.endsWith('.d.cts')
                ? 'export declare function sum(a: number, b: number): number\n'
                : file.endsWith('-deferred.js')
                  ? 'export async function instantiate() { return { sum: (a, b) => a + b } }\n'
                  : file.endsWith('-deferred.d.ts')
                    ? createWasiDeferredBindingTypeDef(loaderSpecifier, true)
                    : file.endsWith('.cjs')
                      ? 'module.exports = { sum: (a, b) => a + b }\n'
                      : '',
        )
      }
      const deferredTypeDef = await readFile(
        join(packageDir, `${packageName}.wasip1-deferred.d.ts`),
        'utf8',
      )
      t.true(
        deferredTypeDef.includes(
          `typeof import('./${packageName}.wasip1.cjs')`,
        ),
      )
      t.false(deferredTypeDef.includes("typeof import('./binding.cjs')"))
      manifest.dependencies = {}
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

      const npmCli = resolveNpmCli()
      const { stdout } = await execFileAsync(
        process.execPath,
        [npmCli, 'pack', '--json', '--pack-destination', tmpDir],
        { cwd: packageDir },
      )
      const [packResult] = JSON.parse(stdout)
      t.true(
        packResult.files.some(
          ({ path }: { path: string }) =>
            path === `${packageName}.wasip1.d.cts`,
        ),
      )
      t.true(
        packResult.files.some(
          ({ path }: { path: string }) =>
            path === `${packageName}.wasip1-deferred.d.ts`,
        ),
      )

      const consumerDir = join(tmpDir, 'typed-consumer')
      await mkdir(consumerDir)
      await writeFile(
        join(consumerDir, 'package.json'),
        JSON.stringify({
          name: 'typed-consumer',
          private: true,
          type: 'module',
          dependencies: {
            [manifest.name]: `file:${join(tmpDir, packResult.filename)}`,
          },
        }),
      )
      await execFileAsync(
        process.execPath,
        [
          npmCli,
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-package-lock',
        ],
        { cwd: consumerDir },
      )
      t.false(existsSync(join(consumerDir, 'node_modules', packageName)))

      const typeTestPath = join(consumerDir, 'direct-flavor.ts')
      await writeFile(
        typeTestPath,
        `import { sum } from '${manifest.name}'\nimport { instantiate } from '${manifest.name}/workerd'\ndeclare const wasmModule: WebAssembly.Module\nsum(1, 2) satisfies number\nconst binding = await instantiate(wasmModule)\nbinding.sum(1, 2) satisfies number\n`,
      )
      await execFileAsync(
        process.execPath,
        [
          require.resolve('typescript/bin/tsc'),
          '--noEmit',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2022',
          '--strict',
          typeTestPath,
        ],
        { cwd: consumerDir },
      )
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'should create distinctly named npm dirs for both WASI flavors side by side',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-wasm-flavors',
      version: '1.0.0',
      napi: {
        binaryName: 'test-wasm-flavors',
        targets: ['wasm32-wasip1-threads', 'wasm32-wasip1'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      const threaded = JSON.parse(
        await readFile(
          join(tmpDir, 'npm', 'wasm32-wasi', 'package.json'),
          'utf-8',
        ),
      )
      const single = JSON.parse(
        await readFile(
          join(tmpDir, 'npm', 'wasm32-wasip1', 'package.json'),
          'utf-8',
        ),
      )

      // the threaded flavor keeps every historical (back-compat) name
      t.is(threaded.name, 'test-wasm-flavors-wasm32-wasi')
      t.is(threaded.main, 'test-wasm-flavors.wasi.cjs')
      t.is(threaded.types, 'test-wasm-flavors.wasi.d.cts')
      t.is(threaded.browser, 'test-wasm-flavors.wasi-browser.js')
      t.is(threaded.cpu, undefined)
      t.is(threaded.os, undefined)
      t.is(threaded.exports, undefined)
      t.deepEqual(threaded.files, [
        'test-wasm-flavors.wasm32-wasi.wasm',
        'test-wasm-flavors.wasi.cjs',
        'test-wasm-flavors.wasi.d.cts',
        'test-wasm-flavors.wasi-browser.js',
        'wasi-worker.mjs',
        'wasi-worker-browser.mjs',
      ])

      // the non-threaded flavor gets its own name everywhere
      t.is(single.name, 'test-wasm-flavors-wasm32-wasip1')
      t.is(single.main, 'test-wasm-flavors.wasip1.cjs')
      t.is(single.types, 'test-wasm-flavors.wasip1.d.cts')
      t.is(single.browser, 'test-wasm-flavors.wasip1-browser.js')
      t.is(single.cpu, undefined)
      t.is(single.os, undefined)
      t.deepEqual(single.files, [
        'test-wasm-flavors.wasm32-wasip1.wasm',
        'test-wasm-flavors.wasip1.cjs',
        'test-wasm-flavors.wasip1.d.cts',
        'test-wasm-flavors.wasip1-browser.js',
        'test-wasm-flavors.wasip1-deferred.js',
        'test-wasm-flavors.wasip1-deferred.d.ts',
        'test-wasm-flavors.wasm32-wasip1.wasm.d.ts',
      ])
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'should not include the deferred loader in files for threaded WASM targets',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-wasm-threaded',
      version: '1.0.0',
      napi: {
        binaryName: 'test-wasm-threaded',
        targets: ['wasm32-wasi-preview1-threads'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      const scopedPackageJson = JSON.parse(
        await readFile(
          join(tmpDir, 'npm', 'wasm32-wasi', 'package.json'),
          'utf-8',
        ),
      )

      t.deepEqual(scopedPackageJson.files, [
        'test-wasm-threaded.wasm32-wasi.wasm',
        'test-wasm-threaded.wasi.cjs',
        'test-wasm-threaded.wasi.d.cts',
        'test-wasm-threaded.wasi-browser.js',
        'wasi-worker.mjs',
        'wasi-worker-browser.mjs',
      ])
    } finally {
      await registryServer.close()
    }
  },
)

test('should set @emnapi/core and @emnapi/runtime versions to match emnapi for WASM targets', async (t) => {
  const { tmpDir, packageJsonPath } = t.context

  const packageJson = {
    name: 'test-emnapi-versions',
    version: '1.0.0',
    napi: {
      binaryName: 'test-emnapi-versions',
      targets: ['wasm32-wasi-preview1-threads'],
    },
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  await createNpmDirs({
    cwd: tmpDir,
    packageJsonPath: 'package.json',
  })

  const scopedDir = join(tmpDir, 'npm', 'wasm32-wasi')
  const scopedPackageJson = JSON.parse(
    await readFile(join(scopedDir, 'package.json'), 'utf-8'),
  )

  const emnapiVersion = require('emnapi/package.json').version
  t.is(scopedPackageJson.dependencies['@emnapi/core'], emnapiVersion)
  t.is(scopedPackageJson.dependencies['@emnapi/runtime'], emnapiVersion)
})

test('rejects symlinked or junction npm target directories before mutation', async (t) => {
  const projectDir = join(t.context.tmpDir, 'symlink-project')
  const outsideDir = join(t.context.tmpDir, 'outside-target')
  const npmDir = join(projectDir, 'npm')
  const targetDir = join(npmDir, 'linux-x64-gnu')
  const sentinel = join(outsideDir, 'sentinel.txt')
  await Promise.all([
    mkdir(npmDir, { recursive: true }),
    mkdir(outsideDir, { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'test-target-link',
        version: '1.0.0',
        napi: {
          binaryName: 'test-target-link',
          targets: ['x86_64-unknown-linux-gnu'],
        },
      }),
    ),
    writeFile(sentinel, 'preserve'),
  ])
  await symlink(
    outsideDir,
    targetDir,
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  const error = await t.throwsAsync(() =>
    createNpmDirs({
      cwd: projectDir,
      packageJsonPath: 'package.json',
    }),
  )

  t.regex(error.message, /symbolic link or junction/)
  t.is(await readFile(sentinel, 'utf8'), 'preserve')
  t.false(existsSync(join(outsideDir, 'package.json')))
  t.false(existsSync(join(outsideDir, 'README.md')))
  t.false(existsSync(join(projectDir, transactionJournalName)))
})

test('rejects canonical npm output escapes before mutation', async (t) => {
  const projectDir = join(t.context.tmpDir, 'escape-project')
  const outsideDir = join(t.context.tmpDir, 'escape-output')
  const sentinel = join(outsideDir, 'sentinel.txt')
  await Promise.all([
    mkdir(projectDir, { recursive: true }),
    mkdir(outsideDir, { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'test-output-escape',
        version: '1.0.0',
        napi: {
          binaryName: 'test-output-escape',
          targets: ['x86_64-unknown-linux-gnu'],
        },
      }),
    ),
    writeFile(sentinel, 'preserve'),
  ])

  const error = await t.throwsAsync(() =>
    createNpmDirs({
      cwd: projectDir,
      npmDir: '../escape-output',
      packageJsonPath: 'package.json',
    }),
  )

  t.regex(error.message, /Managed package paths must stay within/)
  t.is(await readFile(sentinel, 'utf8'), 'preserve')
  t.false(existsSync(join(outsideDir, 'linux-x64-gnu')))
  t.false(existsSync(join(projectDir, transactionJournalName)))
})

test.serial(
  'rejects path-like binary names before registry lookup or mutation',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`
    await writeFile(
      packageJsonPath,
      JSON.stringify({
        name: 'test-binary-name-escape',
        version: '1.0.0',
        napi: {
          binaryName: '../escaped',
          targets: ['wasm32-wasip1'],
        },
      }),
    )

    try {
      const error = await t.throwsAsync(() =>
        createNpmDirs({
          cwd: tmpDir,
          packageJsonPath: 'package.json',
        }),
      )
      t.regex(error.message, /must be a single filesystem path segment/)
      t.deepEqual(registryServer.requests, [])
      t.false(existsSync(join(tmpDir, 'npm')))
      t.false(existsSync(join(tmpDir, transactionJournalName)))
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'shares the workspace reconciliation boundary and reads config after overlap',
  async (t) => {
    const workspaceRoot = t.context.tmpDir
    const packageRoot = join(workspaceRoot, 'packages', 'addon')
    const packageJsonPath = join(packageRoot, 'package.json')
    const npmDir = join(workspaceRoot, 'npm')
    const packageJson = {
      name: 'test-create-npm-dirs-overlap',
      version: '1.0.0',
      napi: {
        binaryName: 'test-create-npm-dirs-overlap',
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }
    await mkdir(packageRoot, { recursive: true })
    await Promise.all([
      writeFile(
        join(workspaceRoot, 'package.json'),
        JSON.stringify({ private: true, workspaces: ['packages/*'] }),
      ),
      writeFile(packageJsonPath, JSON.stringify(packageJson)),
    ])
    const paths = resolvePackageReconciliationPaths(
      workspaceRoot,
      join('packages', 'addon', 'package.json'),
      ['npm'],
    )
    let releaseLock!: () => void
    let markLockReady!: () => void
    const lockRelease = new Promise<void>((resolveRelease) => {
      releaseLock = resolveRelease
    })
    const lockReady = new Promise<void>((resolveReady) => {
      markLockReady = resolveReady
    })
    const holder = withFileSystemReconciliation(paths.boundary, async () => {
      markLockReady()
      await lockRelease
    })
    await lockReady

    let creationSettled = false
    const creation = createNpmDirs({
      cwd: workspaceRoot,
      npmDir: 'npm',
      packageJsonPath: join('packages', 'addon', 'package.json'),
    }).finally(() => {
      creationSettled = true
    })
    await delay(100)
    const settledWhileLocked = creationSettled
    const wroteWhileLocked = existsSync(
      join(npmDir, 'linux-x64-gnu', 'package.json'),
    )
    packageJson.version = '2.0.0'
    await writeFile(packageJsonPath, JSON.stringify(packageJson))
    releaseLock()
    await Promise.all([holder, creation])

    t.false(settledWhileLocked)
    t.false(wroteWhileLocked)
    t.is(
      await readPackageVersion(join(npmDir, 'linux-x64-gnu', 'package.json')),
      '2.0.0',
    )
  },
)

test.serial(
  'rolls back the complete metadata result when a late publication fails',
  async (t) => {
    t.timeout(120_000)
    const { tmpDir, packageJsonPath } = t.context
    const targets = createNativeTargets(128, 'rollback')
    const packageJson = {
      name: 'test-create-npm-dirs-rollback',
      version: '1.0.0',
      napi: {
        binaryName: 'test-create-npm-dirs-rollback',
        targets: targets.map(({ triple }) => triple),
      },
    }
    await writeFile(packageJsonPath, JSON.stringify(packageJson))
    await createNpmDirs({ cwd: tmpDir })

    const firstManifest = join(
      tmpDir,
      'npm',
      targets[0].platformArchABI,
      'package.json',
    )
    const sabotagedDestination = join(
      tmpDir,
      'npm',
      targets.at(-1)!.platformArchABI,
      'README.md',
    )
    await rm(sabotagedDestination)
    packageJson.version = '2.0.0'
    await writeFile(packageJsonPath, JSON.stringify(packageJson))

    const sabotage = (async () => {
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        try {
          if ((await readPackageVersion(firstManifest)) === '2.0.0') {
            await mkdir(sabotagedDestination)
            return
          }
        } catch {}
        await delay(1)
      }
      throw new Error('Timed out waiting for partial metadata publication')
    })()
    const failure = t.throwsAsync(() => createNpmDirs({ cwd: tmpDir }))
    await Promise.all([failure, sabotage])
    await rm(sabotagedDestination, { recursive: true })

    const { boundary } = resolvePackageReconciliationPaths(
      tmpDir,
      'package.json',
      ['npm'],
    )
    await withFileSystemReconciliation(boundary, async () => {})

    const versions = await Promise.all(
      targets.map(({ platformArchABI }) =>
        readPackageVersion(
          join(tmpDir, 'npm', platformArchABI, 'package.json'),
        ),
      ),
    )
    t.deepEqual([...new Set(versions)], ['1.0.0'])
    t.false(existsSync(sabotagedDestination))
    t.false(existsSync(join(tmpDir, transactionJournalName)))
  },
)

crashRecoveryTest(
  'recovers a process killed after partial metadata publication',
  async (t) => {
    t.timeout(180_000)
    const { tmpDir, packageJsonPath } = t.context
    const targets = createNativeTargets(160, 'crash')
    const packageJson = {
      name: 'test-create-npm-dirs-crash',
      version: '1.0.0',
      napi: {
        binaryName: 'test-create-npm-dirs-crash',
        targets: targets.map(({ triple }) => triple),
      },
    }
    await writeFile(packageJsonPath, JSON.stringify(packageJson))
    await createNpmDirs({ cwd: tmpDir })

    const firstManifest = join(
      tmpDir,
      'npm',
      targets[0].platformArchABI,
      'package.json',
    )
    const lastManifest = join(
      tmpDir,
      'npm',
      targets.at(-1)!.platformArchABI,
      'package.json',
    )
    packageJson.version = '2.0.0'
    await writeFile(packageJsonPath, JSON.stringify(packageJson))

    const workerPath = join(tmpDir, 'create-npm-dirs-crash-worker.mjs')
    const watcherSource = `
const { readFileSync } = require('node:fs')
const { parentPort, workerData } = require('node:worker_threads')
const wait = new Int32Array(new SharedArrayBuffer(4))
const version = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).version
  } catch {
    return undefined
  }
}
parentPort.postMessage('ready')
while (true) {
  if (
    version(workerData.firstManifest) === '2.0.0' &&
    version(workerData.lastManifest) === '1.0.0'
  ) {
    process.kill(workerData.pid, 'SIGKILL')
  }
  Atomics.wait(wait, 0, 0, 1)
}
`
    await writeFile(
      workerPath,
      `import { once } from 'node:events'
import { Worker } from 'node:worker_threads'
import { createNpmDirs } from ${JSON.stringify(
        new URL('../create-npm-dirs.ts', import.meta.url).href,
      )}

const [cwd, firstManifest, lastManifest] = process.argv.slice(2)
const watcher = new Worker(${JSON.stringify(watcherSource)}, {
  eval: true,
  workerData: {
    firstManifest,
    lastManifest,
    pid: process.pid,
  },
})
await once(watcher, 'message')
try {
  await createNpmDirs({ cwd })
} finally {
  await watcher.terminate()
}
throw new Error('Metadata publication completed before the crash observer')
`,
    )

    const child = spawn(
      process.execPath,
      [
        '--import',
        '@oxc-node/core/register',
        workerPath,
        tmpDir,
        firstManifest,
        lastManifest,
      ],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    )
    t.teardown(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    })
    const [code, signal] = await once(child, 'close')

    t.is(code, null)
    t.is(signal, 'SIGKILL')
    t.is(await readPackageVersion(firstManifest), '2.0.0')
    t.is(await readPackageVersion(lastManifest), '1.0.0')

    await createNpmDirs({ cwd: tmpDir })

    const versions = await Promise.all(
      targets.map(({ platformArchABI }) =>
        readPackageVersion(
          join(tmpDir, 'npm', platformArchABI, 'package.json'),
        ),
      ),
    )
    t.deepEqual([...new Set(versions)], ['2.0.0'])
    t.false(existsSync(join(tmpDir, transactionJournalName)))
  },
)

test.serial(
  'removes only proven generated WASI files and preserves unknown entries',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`
    const npmDir = join(tmpDir, 'npm')
    const staleThreadedDir = join(npmDir, 'wasm32-wasi')
    const staleThreadlessDir = join(npmDir, 'wasm32-wasip1')
    const unrelatedDir = join(npmDir, 'user-owned')
    const packageJson = {
      name: 'test-removed-wasi-targets',
      version: '1.0.0',
      napi: {
        binaryName: 'test-removed-wasi-targets',
        targets: ['wasm32-wasip1-threads', 'wasm32-wasip1'],
      },
    }
    await writeFile(packageJsonPath, JSON.stringify(packageJson))

    try {
      await createNpmDirs({ cwd: tmpDir })
      const threadedManifest = JSON.parse(
        await readFile(join(staleThreadedDir, 'package.json'), 'utf8'),
      )
      const threadlessManifest = JSON.parse(
        await readFile(join(staleThreadlessDir, 'package.json'), 'utf8'),
      )
      await mkdir(unrelatedDir)
      await Promise.all([
        ...threadedManifest.files.map((file: string) =>
          writeFile(join(staleThreadedDir, file), 'generated'),
        ),
        ...threadlessManifest.files.map((file: string) =>
          writeFile(join(staleThreadlessDir, file), 'generated'),
        ),
        writeFile(join(staleThreadedDir, 'user-notes.txt'), 'preserve'),
        writeFile(join(staleThreadlessDir, 'user-notes.txt'), 'preserve'),
        writeFile(join(unrelatedDir, 'marker'), 'preserve'),
      ])
      await writeFile(
        join(staleThreadlessDir, 'package.json'),
        JSON.stringify({ userOwned: true }),
      )
      packageJson.napi.targets = ['x86_64-unknown-linux-gnu']
      await writeFile(packageJsonPath, JSON.stringify(packageJson))

      await createNpmDirs({ cwd: tmpDir })

      t.true(existsSync(staleThreadedDir))
      t.false(existsSync(join(staleThreadedDir, 'package.json')))
      t.false(existsSync(join(staleThreadedDir, 'README.md')))
      for (const file of threadedManifest.files) {
        t.false(existsSync(join(staleThreadedDir, file)), file)
      }
      t.is(
        await readFile(join(staleThreadedDir, 'user-notes.txt'), 'utf8'),
        'preserve',
      )

      t.true(existsSync(staleThreadlessDir))
      t.true(existsSync(join(staleThreadlessDir, 'package.json')))
      t.true(existsSync(join(staleThreadlessDir, 'README.md')))
      for (const file of threadlessManifest.files) {
        t.false(existsSync(join(staleThreadlessDir, file)), file)
      }
      t.is(
        await readFile(join(staleThreadlessDir, 'user-notes.txt'), 'utf8'),
        'preserve',
      )
      t.true(existsSync(join(unrelatedDir, 'marker')))
      t.true(existsSync(join(npmDir, 'linux-x64-gnu', 'package.json')))
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'should reject an empty latest dist-tag when resolving wasm runtime metadata',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer({
      'dist-tags': {
        latest: '   ',
      },
    })

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-wasm-empty-latest-tag',
      version: '1.0.0',
      napi: {
        binaryName: 'test-wasm-empty-latest-tag',
        targets: ['wasm32-wasi-preview1-threads'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      const error = await t.throwsAsync(() =>
        createNpmDirs({
          cwd: tmpDir,
          packageJsonPath: 'package.json',
        }),
      )

      t.regex(error.message, /did not include a latest dist-tag/)
      t.deepEqual(registryServer.requests, ['/npm/@napi-rs/wasm-runtime'])
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'should ignore publishConfig.registry when resolving wasm runtime metadata',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    const envRegistryServer = await startRegistryServer()

    process.env.npm_config_registry = `${envRegistryServer.origin}/env`

    const packageJson = {
      name: 'test-wasm-publish-registry',
      version: '1.0.0',
      publishConfig: {
        registry: `${registryServer.origin}/custom`,
      },
      napi: {
        binaryName: 'test-wasm-publish-registry',
        targets: ['wasm32-wasi-preview1-threads'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      t.deepEqual(registryServer.requests, [])
      t.deepEqual(envRegistryServer.requests, ['/env/@napi-rs/wasm-runtime'])
    } finally {
      await registryServer.close()
      await envRegistryServer.close()
    }
  },
)

test.serial(
  'should resolve wasm runtime metadata from npm_config_registry',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-wasm-env-registry',
      version: '1.0.0',
      napi: {
        binaryName: 'test-wasm-env-registry',
        targets: ['wasm32-wasi-preview1-threads'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      t.deepEqual(registryServer.requests, ['/npm/@napi-rs/wasm-runtime'])
    } finally {
      await registryServer.close()
    }
  },
)
