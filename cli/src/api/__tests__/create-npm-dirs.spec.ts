import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { createNpmDirs } from '../create-npm-dirs.js'

const require = createRequire(import.meta.url)

const test = ava as TestFn<{
  tmpDir: string
  packageJsonPath: string
  npmConfigRegistry?: string
}>

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
    node: '>=14.0.0',
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

  t.is(scopedPackageJson.engines.node, '>=14.0.0')
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
