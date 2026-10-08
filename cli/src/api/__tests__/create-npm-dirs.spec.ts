import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { createNpmDirs } from '../create-npm-dirs.js'
import { MINIMUM_WASI_NODE_VERSION } from '../../utils/index.js'

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

  const scopedPackageJsonSource = await readFile(scopedPackageJsonPath, 'utf-8')
  t.true(scopedPackageJsonSource.endsWith('\n'))
  t.false(scopedPackageJsonSource.endsWith('\n\n'))
  const scopedPackageJson = JSON.parse(scopedPackageJsonSource)

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
    const scopedDir = join(tmpDir, 'npm', 'wasm32-wasip1-threads')
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
      node: '>=24',
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
    await readFile(
      join(tmpDir, 'npm', 'wasm32-wasip1-threads', 'package.json'),
      'utf-8',
    ),
  )

  t.is(scopedPackageJson.engines.node, '>=24')
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
    await readFile(
      join(tmpDir, 'npm', 'wasm32-wasip1-threads', 'package.json'),
      'utf-8',
    ),
  )

  t.is(scopedPackageJson.engines.node, MINIMUM_WASI_NODE_VERSION)
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
    await readFile(
      join(tmpDir, 'npm', 'wasm32-wasip1-threads', 'package.json'),
      'utf-8',
    ),
  )

  t.deepEqual(scopedPackageJson.engines, {
    npm: '>=10',
    node: MINIMUM_WASI_NODE_VERSION,
  })
})

test('should reject an exact node engine below the WASI minimum for WASM targets', async (t) => {
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

  const error = await t.throwsAsync(() =>
    createNpmDirs({
      cwd: tmpDir,
      packageJsonPath: 'package.json',
    }),
  )
  t.true(error.message.includes('"13.0.0"'))
  t.true(error.message.includes(`"${MINIMUM_WASI_NODE_VERSION}"`))
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
    await readFile(
      join(tmpDir, 'npm', 'wasm32-wasip1-threads', 'package.json'),
      'utf-8',
    ),
  )

  t.is(scopedPackageJson.engines.node, MINIMUM_WASI_NODE_VERSION)
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

  const scopedDir = join(tmpDir, 'npm', 'wasm32-wasip1-threads')
  const scopedPackageJson = JSON.parse(
    await readFile(join(scopedDir, 'package.json'), 'utf-8'),
  )

  const emnapiVersion = require('emnapi/package.json').version
  t.is(scopedPackageJson.dependencies['@emnapi/core'], emnapiVersion)
  t.is(scopedPackageJson.dependencies['@emnapi/runtime'], emnapiVersion)
})

test.serial(
  'should keep generated WASM runtime dependencies within the resolved minor',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer({
      'dist-tags': {
        latest: '1.1.6',
      },
    })

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-wasm-runtime-range',
      version: '1.0.0',
      napi: {
        binaryName: 'test-wasm-runtime-range',
        targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      for (const packageDir of ['wasm32-wasi']) {
        const scopedPackageJson = JSON.parse(
          await readFile(
            join(tmpDir, 'npm', packageDir, 'package.json'),
            'utf-8',
          ),
        )

        t.is(scopedPackageJson.dependencies['@napi-rs/wasm-runtime'], '~1.1.6')
      }
      t.deepEqual(registryServer.requests, ['/npm/@napi-rs/wasm-runtime'])
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'should declare @napi-rs/async-runtime when napi.wasm.asyncRuntime is enabled',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer({
      'dist-tags': {
        latest: '0.1.0',
      },
    })

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-async-runtime-dep',
      version: '1.0.0',
      napi: {
        binaryName: 'test-async-runtime-dep',
        targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
        wasm: {
          asyncRuntime: true,
        },
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      for (const packageDir of ['wasm32-wasi']) {
        const scopedPackageJson = JSON.parse(
          await readFile(
            join(tmpDir, 'npm', packageDir, 'package.json'),
            'utf-8',
          ),
        )

        t.is(scopedPackageJson.dependencies['@napi-rs/async-runtime'], '^0.1.0')
      }
      t.deepEqual(registryServer.requests.sort(), [
        '/npm/@napi-rs/async-runtime',
        '/npm/@napi-rs/wasm-runtime',
      ])
    } finally {
      await registryServer.close()
    }
  },
)

test.serial(
  'should not resolve @napi-rs/async-runtime when the flag is unset',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer({
      'dist-tags': {
        latest: '0.1.0',
      },
    })

    process.env.npm_config_registry = `${registryServer.origin}/npm`

    const packageJson = {
      name: 'test-async-runtime-dep-off',
      version: '1.0.0',
      napi: {
        binaryName: 'test-async-runtime-dep-off',
        targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
      },
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    try {
      await createNpmDirs({
        cwd: tmpDir,
        packageJsonPath: 'package.json',
      })

      for (const packageDir of ['wasm32-wasi']) {
        const scopedPackageJson = JSON.parse(
          await readFile(
            join(tmpDir, 'npm', packageDir, 'package.json'),
            'utf-8',
          ),
        )

        t.is(
          scopedPackageJson.dependencies['@napi-rs/async-runtime'],
          undefined,
        )
      }
      t.deepEqual(registryServer.requests, ['/npm/@napi-rs/wasm-runtime'])
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

test.serial(
  'both WASI flavors produce one unified wasm32-wasi package',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`

    await writeFile(
      packageJsonPath,
      JSON.stringify({
        name: '@scope/unified',
        version: '1.0.0',
        napi: {
          binaryName: 'unified',
          // the family name expands to both flavors
          targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasi'],
        },
      }),
    )

    try {
      await createNpmDirs({ cwd: tmpDir, packageJsonPath: 'package.json' })
    } finally {
      await registryServer.close()
    }

    t.true(existsSync(join(tmpDir, 'npm', 'linux-x64-gnu', 'package.json')))
    t.false(existsSync(join(tmpDir, 'npm', 'wasm32-wasip1')))
    t.false(existsSync(join(tmpDir, 'npm', 'wasm32-wasip1-threads')))

    const unifiedDir = join(tmpDir, 'npm', 'wasm32-wasi')
    const manifest = JSON.parse(
      await readFile(join(unifiedDir, 'package.json'), 'utf8'),
    )
    t.is(manifest.name, '@scope/unified-wasm32-wasi')
    t.is(manifest.type, 'module')
    t.is(manifest.cpu, undefined)
    t.is(manifest.os, undefined)
    t.is(manifest.main, 'unified.wasi.cjs')
    t.is(manifest.types, 'unified.wasi.d.cts')
    t.is(manifest.browser, 'unified.wasip1-threads-browser.js')
    t.deepEqual(manifest.exports, {
      '.': {
        types: './unified.wasi.d.cts',
        browser: {
          'wasi-threadless': './unified.wasip1-browser.js',
          default: './unified.wasip1-threads-browser.js',
        },
        'wasi-threadless': './unified.wasip1.cjs',
        default: './unified.wasi.cjs',
      },
      './wasm32-wasip1-threads': {
        types: './unified.wasip1-threads.d.cts',
        browser: './unified.wasip1-threads-browser.js',
        default: './unified.wasip1-threads.cjs',
      },
      './wasm32-wasip1': {
        types: './unified.wasip1.d.cts',
        browser: './unified.wasip1-browser.js',
        default: './unified.wasip1.cjs',
      },
      './workerd': {
        types: './unified.wasip1-deferred.d.ts',
        default: './unified.wasip1-deferred.js',
      },
      './wasm': {
        types: './unified.wasm32-wasip1.wasm.d.ts',
        default: './unified.wasm32-wasip1.wasm',
      },
      './wasm.wasm': {
        types: './unified.wasm32-wasip1.wasm.d.ts',
        default: './unified.wasm32-wasip1.wasm',
      },
      './package.json': './package.json',
    })
    t.deepEqual([...manifest.files].sort(), [
      'unified.wasi.cjs',
      'unified.wasi.d.cts',
      'unified.wasip1-browser.js',
      'unified.wasip1-deferred.d.ts',
      'unified.wasip1-deferred.js',
      'unified.wasip1-threads-browser.js',
      'unified.wasip1-threads.cjs',
      'unified.wasip1-threads.d.cts',
      'unified.wasip1.cjs',
      'unified.wasip1.d.cts',
      'unified.wasm32-wasip1-threads.wasm',
      'unified.wasm32-wasip1.wasm',
      'unified.wasm32-wasip1.wasm.d.ts',
      'wasi-worker-browser.mjs',
      'wasi-worker.mjs',
    ])
    t.is(manifest.engines.node, MINIMUM_WASI_NODE_VERSION)

    // static files owned by create-npm-dirs
    const dispatcher = await readFile(
      join(unifiedDir, 'unified.wasi.cjs'),
      'utf8',
    )
    t.true(dispatcher.includes("require('./unified.wasip1-threads.cjs')"))
    t.true(dispatcher.includes("require('./unified.wasip1.cjs')"))
    const dispatcherTypeDef = await readFile(
      join(unifiedDir, 'unified.wasi.d.cts'),
      'utf8',
    )
    t.true(
      dispatcherTypeDef.includes(
        "export * from './unified.wasip1-threads.cjs'",
      ),
    )
    t.true(
      dispatcherTypeDef.includes(
        "__napiBindingTarget: 'wasm32-wasip1-threads' | 'wasm32-wasip1'",
      ),
    )
    t.true(existsSync(join(unifiedDir, 'unified.wasm32-wasip1.wasm.d.ts')))
    const readme = await readFile(join(unifiedDir, 'README.md'), 'utf8')
    t.true(readme.includes('wasm32-wasip1-threads'))
    t.true(readme.includes('wasi-threadless'))
  },
)

test.serial(
  'a single WASI flavor keeps its flavor-specific package',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`

    await writeFile(
      packageJsonPath,
      JSON.stringify({
        name: 'threaded-only',
        version: '1.0.0',
        napi: { binaryName: 'threaded', targets: ['wasm32-wasip1-threads'] },
      }),
    )
    try {
      await createNpmDirs({ cwd: tmpDir, packageJsonPath: 'package.json' })
    } finally {
      await registryServer.close()
    }

    t.false(existsSync(join(tmpDir, 'npm', 'wasm32-wasi')))
    const manifest = JSON.parse(
      await readFile(
        join(tmpDir, 'npm', 'wasm32-wasip1-threads', 'package.json'),
        'utf8',
      ),
    )
    t.is(manifest.name, 'threaded-only-wasm32-wasip1-threads')
    t.is(manifest.main, 'threaded.wasip1-threads.cjs')
    t.is(manifest.types, 'threaded.wasip1-threads.d.cts')
    t.is(manifest.browser, 'threaded.wasip1-threads-browser.js')
    t.is(manifest.exports, undefined)
    t.deepEqual([...manifest.files].sort(), [
      'threaded.wasip1-threads-browser.js',
      'threaded.wasip1-threads.cjs',
      'threaded.wasip1-threads.d.cts',
      'threaded.wasm32-wasip1-threads.wasm',
      'wasi-worker-browser.mjs',
      'wasi-worker.mjs',
    ])
  },
)

test.serial(
  'moving from the legacy threaded layout to the unified package sweeps the old files',
  async (t) => {
    const { tmpDir, packageJsonPath } = t.context
    const registryServer = await startRegistryServer()
    process.env.npm_config_registry = `${registryServer.origin}/npm`

    // what a previous CLI wrote for `targets: ['wasm32-wasi-preview1-threads']`
    const legacyDir = join(tmpDir, 'npm', 'wasm32-wasi')
    await mkdir(legacyDir, { recursive: true })
    await Promise.all([
      writeFile(
        join(legacyDir, 'package.json'),
        JSON.stringify({
          name: 'legacy-wasm32-wasi',
          version: '0.9.0',
          type: 'module',
          main: 'legacy.wasi.cjs',
          types: 'legacy.wasi.d.cts',
          browser: 'legacy.wasi-browser.js',
          files: [
            'legacy.wasm32-wasi.wasm',
            'legacy.wasi.cjs',
            'legacy.wasi.d.cts',
            'legacy.wasi-browser.js',
            'wasi-worker.mjs',
            'wasi-worker-browser.mjs',
          ],
        }),
      ),
      writeFile(join(legacyDir, 'legacy.wasm32-wasi.wasm'), 'wasm'),
      writeFile(join(legacyDir, 'legacy.wasi.cjs'), 'legacy loader'),
      writeFile(join(legacyDir, 'legacy.wasi.d.cts'), 'legacy types'),
      writeFile(join(legacyDir, 'legacy.wasi-browser.js'), 'legacy browser'),
      writeFile(join(legacyDir, 'wasi-worker.mjs'), 'worker'),
      writeFile(join(legacyDir, 'wasi-worker-browser.mjs'), 'worker'),
      writeFile(join(legacyDir, 'HANDWRITTEN.md'), 'keep me'),
      writeFile(
        join(legacyDir, 'README.md'),
        '# `legacy-wasm32-wasi`\n\nThis is the **wasm32-wasip1-threads** binary for `legacy`\n',
      ),
    ])
    // and a threadless-only package left over from another layout
    const threadlessDir = join(tmpDir, 'npm', 'wasm32-wasip1')
    await mkdir(threadlessDir, { recursive: true })
    await writeFile(
      join(threadlessDir, 'package.json'),
      JSON.stringify({
        name: 'legacy-wasm32-wasip1',
        version: '0.9.0',
        type: 'module',
        main: 'legacy.wasip1.cjs',
        files: ['legacy.wasip1.cjs'],
      }),
    )
    await writeFile(join(threadlessDir, 'legacy.wasip1.cjs'), 'loader')

    await writeFile(
      packageJsonPath,
      JSON.stringify({
        name: 'legacy',
        version: '1.0.0',
        napi: {
          binaryName: 'legacy',
          targets: ['wasm32-wasip1-threads', 'wasm32-wasip1'],
        },
      }),
    )
    try {
      await createNpmDirs({ cwd: tmpDir, packageJsonPath: 'package.json' })
    } finally {
      await registryServer.close()
    }

    // the unified package is written in place; legacy-only files are gone
    t.false(existsSync(join(legacyDir, 'legacy.wasm32-wasi.wasm')))
    t.false(existsSync(join(legacyDir, 'legacy.wasi-browser.js')))
    t.true(existsSync(join(legacyDir, 'HANDWRITTEN.md')))
    t.is(
      await readFile(join(legacyDir, 'legacy.wasi.cjs'), 'utf8').then((s) =>
        s.includes("require('./legacy.wasip1.cjs')"),
      ),
      true,
    )
    const manifest = JSON.parse(
      await readFile(join(legacyDir, 'package.json'), 'utf8'),
    )
    t.is(manifest.version, '1.0.0')
    t.true(manifest.files.includes('legacy.wasm32-wasip1-threads.wasm'))
    // the stale flavor-specific package directory is removed entirely
    t.false(existsSync(threadlessDir))
  },
)
