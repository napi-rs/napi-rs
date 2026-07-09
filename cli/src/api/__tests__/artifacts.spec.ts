import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { collectArtifacts } from '../artifacts.js'
import { WASI_ARTIFACT_METADATA_PREFIX } from '../build.js'

const test = ava as TestFn<{
  tmpDir: string
}>
const permissionsTest = process.platform === 'win32' ? test.skip : test
const directorySymlinkType = process.platform === 'win32' ? 'junction' : 'dir'

test.beforeEach(async (t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `artifacts-${timestamp}-${random}`,
  )
  await mkdir(tmpDir, { recursive: true })
  t.context = { tmpDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

interface WasiFlavorFixture {
  /** rust triple declared in `napi.targets` */
  target: string
  /** expected `platformArchABI` (npm dir name + wasm artifact suffix) */
  platformArchABI: string
  /** expected loader file suffix (`wasi` | `wasip1`) */
  loaderSuffix: string
  hasThreads: boolean
  withDeferredLoader: boolean
}

async function setupWasiProject(
  tmpDir: string,
  binaryName: string,
  flavors: WasiFlavorFixture[],
  rootEntry: string | null = 'index.js',
) {
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify(
      {
        name: binaryName,
        version: '1.0.0',
        napi: {
          binaryName,
          targets: flavors.map((flavor) => flavor.target),
        },
        ...(rootEntry ? { main: `./${rootEntry}` } : {}),
      },
      null,
      2,
    ),
  )

  // CI artifacts dir with the built wasm binaries
  const artifactsDir = join(tmpDir, 'artifacts')
  await mkdir(artifactsDir, { recursive: true })

  const wasiDirs: string[] = []
  for (const flavor of flavors) {
    // dist dirs normally created by `napi create-npm-dirs`
    const wasiDir = join(tmpDir, 'npm', flavor.platformArchABI)
    await mkdir(wasiDir, { recursive: true })
    wasiDirs.push(wasiDir)

    await writeFile(
      join(artifactsDir, `${binaryName}.${flavor.platformArchABI}.wasm`),
      `wasm ${flavor.platformArchABI}`,
    )

    // loader files emitted next to package.json by the build
    await writeFile(
      join(tmpDir, `${binaryName}.${flavor.loaderSuffix}.cjs`),
      `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
        version: 1,
        rootEntry,
      })}\n// cjs loader ${flavor.platformArchABI}`,
    )
    await writeFile(
      join(tmpDir, `${binaryName}.${flavor.loaderSuffix}.d.cts`),
      `// cjs loader types ${flavor.platformArchABI}`,
    )
    await writeFile(
      join(tmpDir, `${binaryName}.${flavor.loaderSuffix}-browser.js`),
      `// browser loader ${flavor.platformArchABI}`,
    )
    if (flavor.hasThreads) {
      await writeFile(join(tmpDir, 'wasi-worker.mjs'), '// worker')
      await writeFile(
        join(tmpDir, 'wasi-worker-browser.mjs'),
        '// browser worker',
      )
    }
    if (flavor.withDeferredLoader) {
      await writeFile(
        join(tmpDir, `${binaryName}.${flavor.loaderSuffix}-deferred.js`),
        '// deferred loader',
      )
      await writeFile(
        join(tmpDir, `${binaryName}.${flavor.loaderSuffix}-deferred.d.ts`),
        '// deferred loader types',
      )
    }
  }

  await writeFile(join(tmpDir, 'browser.js'), '// root browser')
  if (rootEntry) {
    const rootEntryPath = join(tmpDir, rootEntry)
    await mkdir(dirname(rootEntryPath), { recursive: true })
    await writeFile(rootEntryPath, `// root entry ${rootEntry}`)
  }
  await writeFile(join(tmpDir, 'index.js'), '// root index')
  await writeFile(join(tmpDir, 'browser.js'), '// root browser')

  return wasiDirs
}

test('should copy the deferred loader into the wasm32-wasip1 npm dir when present', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-deferred'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])

  await collectArtifacts({ cwd: tmpDir })

  t.is(
    await readFile(join(wasiDir, `${binaryName}.wasip1-deferred.js`), 'utf-8'),
    '// deferred loader',
  )
  t.is(
    await readFile(
      join(wasiDir, `${binaryName}.wasip1-deferred.d.ts`),
      'utf-8',
    ),
    '// deferred loader types',
  )
  // sibling loaders are still collected
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1.cjs`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1.d.cts`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1-browser.js`)))
  // worker scripts belong to the threaded flavor only
  t.false(existsSync(join(wasiDir, 'wasi-worker.mjs')))
  t.false(existsSync(join(wasiDir, 'wasi-worker-browser.mjs')))
})

test('resolves artifact path options from cwd', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-paths'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  const buildOutputDir = join(tmpDir, 'build-output')
  await mkdir(buildOutputDir)
  for (const suffix of [
    'wasip1.cjs',
    'wasip1.d.cts',
    'wasip1-browser.js',
    'wasip1-deferred.js',
    'wasip1-deferred.d.ts',
  ]) {
    await rename(
      join(tmpDir, `${binaryName}.${suffix}`),
      join(buildOutputDir, `${binaryName}.${suffix}`),
    )
  }
  await rename(join(tmpDir, 'index.js'), join(buildOutputDir, 'index.js'))
  await rename(join(tmpDir, 'browser.js'), join(buildOutputDir, 'browser.js'))

  await collectArtifacts({
    cwd: tmpDir,
    outputDir: join(tmpDir, 'artifacts'),
    npmDir: join(tmpDir, 'npm'),
    buildOutputDir: 'build-output',
  })

  t.true(existsSync(join(wasiDir, `${binaryName}.wasm32-wasip1.wasm`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1.cjs`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1.d.cts`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1-browser.js`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1-deferred.js`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasip1-deferred.d.ts`)))
})

test('collects a custom nested --js entry from WASI build metadata', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-custom-entry'
  const rootEntry = join('dist', 'binding.cjs')
  await setupWasiProject(
    tmpDir,
    binaryName,
    [
      {
        target: 'wasm32-wasip1',
        platformArchABI: 'wasm32-wasip1',
        loaderSuffix: 'wasip1',
        hasThreads: false,
        withDeferredLoader: true,
      },
    ],
    rootEntry,
  )
  const buildOutputDir = join(tmpDir, 'build-output')
  await mkdir(join(buildOutputDir, 'dist'), { recursive: true })
  for (const fileName of [
    `${binaryName}.wasip1.cjs`,
    `${binaryName}.wasip1.d.cts`,
    `${binaryName}.wasip1-browser.js`,
    `${binaryName}.wasip1-deferred.js`,
    `${binaryName}.wasip1-deferred.d.ts`,
    'browser.js',
    rootEntry,
  ]) {
    await rename(join(tmpDir, fileName), join(buildOutputDir, fileName))
  }
  await writeFile(join(tmpDir, 'index.js'), '// unrelated checked-in entry')

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(
    await readFile(join(tmpDir, rootEntry), 'utf8'),
    `// root entry ${rootEntry}`,
  )
  t.is(
    await readFile(join(tmpDir, 'index.js'), 'utf8'),
    '// unrelated checked-in entry',
  )
})

for (const missingRootEntry of ['index.js', 'browser.js']) {
  test(`rejects a selected WASI artifact source without ${missingRootEntry}`, async (t) => {
    const { tmpDir } = t.context
    const binaryName = `test-artifacts-missing-${missingRootEntry.replace('.', '-')}`
    await setupWasiProject(tmpDir, binaryName, [
      {
        target: 'wasm32-wasip1',
        platformArchABI: 'wasm32-wasip1',
        loaderSuffix: 'wasip1',
        hasThreads: false,
        withDeferredLoader: true,
      },
    ])
    const buildOutputDir = join(tmpDir, 'build-output')
    await mkdir(buildOutputDir)
    for (const suffix of [
      'wasip1.cjs',
      'wasip1.d.cts',
      'wasip1-browser.js',
      'wasip1-deferred.js',
      'wasip1-deferred.d.ts',
    ]) {
      await rename(
        join(tmpDir, `${binaryName}.${suffix}`),
        join(buildOutputDir, `${binaryName}.${suffix}`),
      )
    }

    const staleRootEntries = {
      'index.js': '// stale root index',
      'browser.js': '// stale root browser',
    }
    for (const [rootEntry, content] of Object.entries(staleRootEntries)) {
      await writeFile(join(tmpDir, rootEntry), content)
      if (rootEntry !== missingRootEntry) {
        await writeFile(
          join(buildOutputDir, rootEntry),
          `// fresh ${rootEntry}`,
        )
      }
    }

    const error = await t.throwsAsync(() =>
      collectArtifacts({
        cwd: tmpDir,
        buildOutputDir: 'build-output',
      }),
    )
    t.true(error.message.includes(buildOutputDir))
    t.true(
      error.message.includes(`missing required root entry ${missingRootEntry}`),
    )
    for (const [rootEntry, content] of Object.entries(staleRootEntries)) {
      t.is(
        await readFile(join(tmpDir, rootEntry), 'utf8'),
        content,
        `${rootEntry} must not be partially updated`,
      )
    }
  })
}

test('collects WASI loaders from target-specific artifact directories', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-download-layout'
  const [singleDir, threadedDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
    {
      target: 'wasm32-wasip1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])
  const artifactsDir = join(tmpDir, 'artifacts')
  const singleArtifactsDir = join(artifactsDir, 'bindings-wasm32-wasip1')
  const threadedArtifactsDir = join(
    artifactsDir,
    'bindings-wasm32-wasip1-threads',
  )
  await mkdir(singleArtifactsDir)
  await mkdir(threadedArtifactsDir)

  for (const [sourceDir, platformArchABI, files] of [
    [
      singleArtifactsDir,
      'wasm32-wasip1',
      [
        `${binaryName}.wasip1.cjs`,
        `${binaryName}.wasip1.d.cts`,
        `${binaryName}.wasip1-browser.js`,
        `${binaryName}.wasip1-deferred.js`,
        `${binaryName}.wasip1-deferred.d.ts`,
      ],
    ],
    [
      threadedArtifactsDir,
      'wasm32-wasi',
      [
        `${binaryName}.wasi.cjs`,
        `${binaryName}.wasi.d.cts`,
        `${binaryName}.wasi-browser.js`,
        'wasi-worker.mjs',
        'wasi-worker-browser.mjs',
      ],
    ],
  ] as const) {
    await rename(
      join(artifactsDir, `${binaryName}.${platformArchABI}.wasm`),
      join(sourceDir, `${binaryName}.${platformArchABI}.wasm`),
    )
    for (const file of files) {
      await rename(join(tmpDir, file), join(sourceDir, file))
    }
    await writeFile(join(sourceDir, 'index.js'), `// index ${platformArchABI}`)
    await writeFile(
      join(sourceDir, 'browser.js'),
      `// browser ${platformArchABI}`,
    )
  }

  await collectArtifacts({ cwd: tmpDir })

  t.true(existsSync(join(singleDir, `${binaryName}.wasip1.cjs`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1.d.cts`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1-deferred.js`)))
  t.true(existsSync(join(threadedDir, `${binaryName}.wasi.cjs`)))
  t.true(existsSync(join(threadedDir, 'wasi-worker.mjs')))
  t.is(await readFile(join(tmpDir, 'index.js'), 'utf8'), '// index wasm32-wasi')
  t.is(
    await readFile(join(tmpDir, 'browser.js'), 'utf8'),
    '// browser wasm32-wasip1',
  )
})

test('selects the threadless browser entry from dual-flavor metadata in one directory', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-shared-browser-source'
  await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
    {
      target: 'wasm32-wasip1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])
  const buildOutputDir = join(tmpDir, 'build-output')
  await mkdir(buildOutputDir)
  for (const fileName of [
    `${binaryName}.wasip1.cjs`,
    `${binaryName}.wasip1.d.cts`,
    `${binaryName}.wasip1-browser.js`,
    `${binaryName}.wasip1-deferred.js`,
    `${binaryName}.wasip1-deferred.d.ts`,
    `${binaryName}.wasi.cjs`,
    `${binaryName}.wasi.d.cts`,
    `${binaryName}.wasi-browser.js`,
    'wasi-worker.mjs',
    'wasi-worker-browser.mjs',
    'index.js',
    'browser.js',
  ]) {
    await rename(join(tmpDir, fileName), join(buildOutputDir, fileName))
  }
  const metadata = (exports: string[]) =>
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 2,
      rootEntry: 'index.js',
      exports,
      managedRootEntries: ['browser.js', 'index.js'],
    })}\n`
  await writeFile(
    join(buildOutputDir, `${binaryName}.wasip1.cjs`),
    `${metadata(['threadlessOnly'])}// threadless loader`,
  )
  await writeFile(
    join(buildOutputDir, `${binaryName}.wasi.cjs`),
    `${metadata(['threadedOnly'])}// threaded loader`,
  )
  await writeFile(
    join(buildOutputDir, 'browser.js'),
    `export * from '${binaryName}-wasm32-wasi'\n`,
  )

  await collectArtifacts({ cwd: tmpDir, buildOutputDir })

  t.is(
    await readFile(join(tmpDir, 'browser.js'), 'utf8'),
    `export * from '${binaryName}-wasm32-wasip1'\n`,
  )
})

test('preserves a native root entry while selecting the WASI browser independently', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-native-root'
  await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  const packageJsonPath = join(tmpDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.napi.targets.unshift('x86_64-unknown-linux-gnu')
  await writeFile(packageJsonPath, JSON.stringify(packageJson))
  await writeFile(
    join(tmpDir, 'artifacts', `${binaryName}.linux-x64-gnu.node`),
    'native binary',
  )
  await writeFile(join(tmpDir, 'index.js'), '// native root entry')

  await collectArtifacts({ cwd: tmpDir })

  t.is(await readFile(join(tmpDir, 'index.js'), 'utf8'), '// native root entry')
  t.is(await readFile(join(tmpDir, 'browser.js'), 'utf8'), '// root browser')
})

test('serializes concurrent dual-flavor artifact reconciliation', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-concurrent-flavors'
  await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
    {
      target: 'wasm32-wasip1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])

  await Promise.all([
    collectArtifacts({ cwd: tmpDir }),
    collectArtifacts({ cwd: tmpDir }),
  ])

  t.is(await readFile(join(tmpDir, 'index.js'), 'utf8'), '// root index')
  t.is(await readFile(join(tmpDir, 'browser.js'), 'utf8'), '// root browser')
  for (const [target, files] of [
    [
      'wasm32-wasip1',
      [
        `${binaryName}.wasip1.cjs`,
        `${binaryName}.wasip1.d.cts`,
        `${binaryName}.wasip1-deferred.js`,
      ],
    ],
    [
      'wasm32-wasi',
      [`${binaryName}.wasi.cjs`, `${binaryName}.wasi.d.cts`, 'wasi-worker.mjs'],
    ],
  ] as const) {
    for (const file of files) {
      t.true(existsSync(join(tmpDir, 'npm', target, file)), `${target}/${file}`)
    }
  }
})

test('does not rescan the npm output subtree when outputDir is its ancestor', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-npm-subtree'
  const outputDir = join(tmpDir, 'artifacts')
  const npmDir = join(outputDir, 'npm')
  const artifactName = `${binaryName}.linux-x64-gnu.node`
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }),
  )
  await mkdir(join(outputDir, 'input'), { recursive: true })
  await writeFile(join(outputDir, 'input', artifactName), 'native binary')

  await collectArtifacts({ cwd: tmpDir, outputDir, npmDir })
  await t.notThrowsAsync(() =>
    collectArtifacts({ cwd: tmpDir, outputDir, npmDir }),
  )
  t.is(
    await readFile(join(npmDir, 'linux-x64-gnu', artifactName), 'utf8'),
    'native binary',
  )
})

for (const layout of ['equal', 'below'] as const) {
  test(`preserves artifact sources when outputDir is ${layout} npmDir`, async (t) => {
    const { tmpDir } = t.context
    const binaryName = `test-artifacts-npm-${layout}`
    const npmDir = join(tmpDir, 'npm')
    const outputDir = layout === 'equal' ? npmDir : join(npmDir, 'incoming')
    const artifactName = `${binaryName}.linux-x64-gnu.node`
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: binaryName,
        version: '1.0.0',
        napi: {
          binaryName,
          targets: ['x86_64-unknown-linux-gnu'],
        },
      }),
    )
    await mkdir(outputDir, { recursive: true })
    const source = join(outputDir, artifactName)
    await writeFile(source, 'native source artifact')

    await collectArtifacts({ cwd: tmpDir, outputDir, npmDir })
    await t.notThrowsAsync(() =>
      collectArtifacts({ cwd: tmpDir, outputDir, npmDir }),
    )

    t.is(await readFile(source, 'utf8'), 'native source artifact')
    t.is(
      await readFile(join(npmDir, 'linux-x64-gnu', artifactName), 'utf8'),
      'native source artifact',
    )
  })
}

test('does not treat npm outputs reached through an outputDir alias as fresh artifacts', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-canonical-output-alias'
  const platformArchABI = 'linux-x64-gnu'
  const artifactName = `${binaryName}.${platformArchABI}.node`
  const npmDir = join(tmpDir, 'npm')
  const targetDir = join(npmDir, platformArchABI)
  const outputDir = join(tmpDir, 'artifact-output-alias')
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }),
  )
  await mkdir(targetDir, { recursive: true })
  await writeFile(join(targetDir, artifactName), 'stale published artifact')
  await symlink(npmDir, outputDir, directorySymlinkType)

  const error = await t.throwsAsync(() =>
    collectArtifacts({ cwd: tmpDir, outputDir, npmDir }),
  )

  t.regex(error.message, /Missing artifacts for configured targets/)
  t.false(existsSync(join(targetDir, artifactName)))
  t.false(existsSync(join(tmpDir, artifactName)))
})

permissionsTest(
  'rolls back earlier artifact writes when a later destination write fails',
  async (t) => {
    const { tmpDir } = t.context
    const binaryName = 'test-artifacts-write-rollback'
    const targets = [
      {
        triple: 'x86_64-unknown-linux-gnu',
        platformArchABI: 'linux-x64-gnu',
      },
      {
        triple: 'aarch64-unknown-linux-gnu',
        platformArchABI: 'linux-arm64-gnu',
      },
    ]
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: binaryName,
        version: '1.0.0',
        napi: {
          binaryName,
          targets: targets.map(({ triple }) => triple),
        },
      }),
    )
    const artifactsDir = join(tmpDir, 'artifacts')
    await mkdir(artifactsDir)

    const priorDestinations = new Map<string, string>()
    for (const { platformArchABI } of targets) {
      const artifactName = `${binaryName}.${platformArchABI}.node`
      const targetDir = join(tmpDir, 'npm', platformArchABI)
      await mkdir(targetDir, { recursive: true })
      await writeFile(
        join(artifactsDir, artifactName),
        `replacement ${platformArchABI}`,
      )
      for (const destination of [
        join(targetDir, artifactName),
        join(tmpDir, artifactName),
      ]) {
        const prior = `prior ${destination}`
        priorDestinations.set(destination, prior)
        await writeFile(destination, prior)
      }
    }

    const lockedTargetDir = join(tmpDir, 'npm', targets[1].platformArchABI)
    await chmod(lockedTargetDir, 0o555)
    let error: Error | undefined
    try {
      error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))
    } finally {
      await chmod(lockedTargetDir, 0o755)
    }
    t.true(
      ['EACCES', 'EPERM'].includes(
        (error as NodeJS.ErrnoException | undefined)?.code ?? '',
      ),
    )

    for (const [destination, prior] of priorDestinations) {
      t.is(await readFile(destination, 'utf8'), prior, destination)
    }
  },
)

permissionsTest(
  'rolls back missing-artifact cleanup when a later removal fails',
  async (t) => {
    const { tmpDir } = t.context
    const binaryName = 'test-artifacts-missing-cleanup-rollback'
    const platformArchABI = 'linux-x64-gnu'
    const artifactName = `${binaryName}.${platformArchABI}.node`
    const artifactsDir = join(tmpDir, 'artifacts')
    const targetDir = join(tmpDir, 'npm', platformArchABI)
    const rootArtifact = join(tmpDir, artifactName)
    const npmArtifact = join(targetDir, artifactName)
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: binaryName,
        version: '1.0.0',
        napi: {
          binaryName,
          targets: ['x86_64-unknown-linux-gnu'],
        },
      }),
    )
    await mkdir(artifactsDir)
    await mkdir(targetDir, { recursive: true })
    await writeFile(rootArtifact, 'stale root artifact')
    await writeFile(npmArtifact, 'stale npm artifact')

    await chmod(targetDir, 0o555)
    let error: Error | undefined
    try {
      error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))
    } finally {
      await chmod(targetDir, 0o755)
    }
    t.true(
      ['EACCES', 'EPERM'].includes(
        (error as NodeJS.ErrnoException | undefined)?.code ?? '',
      ),
    )
    t.is(await readFile(rootArtifact, 'utf8'), 'stale root artifact')
    t.is(await readFile(npmArtifact, 'utf8'), 'stale npm artifact')
  },
)

permissionsTest(
  'rolls back artifact writes and earlier stale removals when a later removal fails',
  async (t) => {
    const { tmpDir } = t.context
    const binaryName = 'test-artifacts-removal-rollback'
    const rootEntry = join('dist', 'binding.cjs')
    const [wasiDir] = await setupWasiProject(
      tmpDir,
      binaryName,
      [
        {
          target: 'wasm32-wasip1',
          platformArchABI: 'wasm32-wasip1',
          loaderSuffix: 'wasip1',
          hasThreads: false,
          withDeferredLoader: true,
        },
      ],
      rootEntry,
    )
    const buildOutputDir = join(tmpDir, 'build-output')
    await mkdir(buildOutputDir)
    for (const fileName of [
      `${binaryName}.wasip1.cjs`,
      `${binaryName}.wasip1.d.cts`,
      `${binaryName}.wasip1-browser.js`,
      `${binaryName}.wasip1-deferred.js`,
      `${binaryName}.wasip1-deferred.d.ts`,
      'browser.js',
      rootEntry,
    ]) {
      const destination = join(buildOutputDir, fileName)
      await mkdir(dirname(destination), { recursive: true })
      await rename(join(tmpDir, fileName), destination)
    }

    const staleRootEntry = join('old', 'binding.cjs')
    const staleRootPath = join(tmpDir, staleRootEntry)
    await mkdir(dirname(staleRootPath), { recursive: true })
    await writeFile(staleRootPath, 'prior stale root entry')
    await writeFile(
      join(tmpDir, `${binaryName}.wasip1.cjs`),
      `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
        version: 2,
        rootEntry,
        managedRootEntries: [staleRootEntry],
      })}\n`,
    )

    const artifactName = `${binaryName}.wasm32-wasip1.wasm`
    const npmArtifact = join(wasiDir, artifactName)
    const rootArtifact = join(tmpDir, artifactName)
    const npmLoader = join(wasiDir, `${binaryName}.wasip1.cjs`)
    const staleCrossFlavor = join(wasiDir, `${binaryName}.wasm32-wasi.wasm`)
    await Promise.all([
      writeFile(npmArtifact, 'prior npm artifact'),
      writeFile(rootArtifact, 'prior root artifact'),
      writeFile(npmLoader, 'prior npm loader'),
      writeFile(staleCrossFlavor, 'prior stale cross-flavor artifact'),
    ])

    const lockedRootEntryDir = dirname(staleRootPath)
    await chmod(lockedRootEntryDir, 0o555)
    let error: Error | undefined
    try {
      error = await t.throwsAsync(() =>
        collectArtifacts({ cwd: tmpDir, buildOutputDir }),
      )
    } finally {
      await chmod(lockedRootEntryDir, 0o755)
    }
    t.true(
      ['EACCES', 'EPERM'].includes(
        (error as NodeJS.ErrnoException | undefined)?.code ?? '',
      ),
    )

    t.is(await readFile(npmArtifact, 'utf8'), 'prior npm artifact')
    t.is(await readFile(rootArtifact, 'utf8'), 'prior root artifact')
    t.is(await readFile(npmLoader, 'utf8'), 'prior npm loader')
    t.is(
      await readFile(staleCrossFlavor, 'utf8'),
      'prior stale cross-flavor artifact',
    )
    t.is(await readFile(staleRootPath, 'utf8'), 'prior stale root entry')
    t.false(existsSync(join(tmpDir, 'browser.js')))
    t.false(existsSync(join(tmpDir, rootEntry)))
  },
)

test('removes a previously managed custom WASI root entry after it changes', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-changed-root'
  const oldRootEntry = join('old', 'binding.cjs')
  const newRootEntry = join('dist', 'binding.cjs')
  await setupWasiProject(
    tmpDir,
    binaryName,
    [
      {
        target: 'wasm32-wasip1',
        platformArchABI: 'wasm32-wasip1',
        loaderSuffix: 'wasip1',
        hasThreads: false,
        withDeferredLoader: true,
      },
    ],
    newRootEntry,
  )
  const buildOutputDir = join(tmpDir, 'build-output')
  await mkdir(join(buildOutputDir, 'dist'), { recursive: true })
  for (const fileName of [
    `${binaryName}.wasip1.cjs`,
    `${binaryName}.wasip1.d.cts`,
    `${binaryName}.wasip1-browser.js`,
    `${binaryName}.wasip1-deferred.js`,
    `${binaryName}.wasip1-deferred.d.ts`,
    'browser.js',
    newRootEntry,
  ]) {
    await rename(join(tmpDir, fileName), join(buildOutputDir, fileName))
  }
  await mkdir(dirname(join(tmpDir, oldRootEntry)), { recursive: true })
  await writeFile(join(tmpDir, oldRootEntry), '// stale managed root')
  await writeFile(
    join(tmpDir, `${binaryName}.wasip1.cjs`),
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 2,
      rootEntry: oldRootEntry,
      managedRootEntries: ['browser.js', oldRootEntry],
    })}\n`,
  )

  await collectArtifacts({ cwd: tmpDir, buildOutputDir })

  t.false(existsSync(join(tmpDir, oldRootEntry)))
  t.is(
    await readFile(join(tmpDir, newRootEntry), 'utf8'),
    `// root entry ${newRootEntry}`,
  )
})

test('rejects a partial downloaded loader set instead of using stale local files', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-partial-source'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  const artifactsDir = join(tmpDir, 'artifacts')
  const targetArtifactsDir = join(artifactsDir, 'bindings-wasm32-wasip1')
  await mkdir(targetArtifactsDir)
  await rename(
    join(artifactsDir, `${binaryName}.wasm32-wasip1.wasm`),
    join(targetArtifactsDir, `${binaryName}.wasm32-wasip1.wasm`),
  )
  await writeFile(
    join(targetArtifactsDir, `${binaryName}.wasip1.cjs`),
    '// incomplete downloaded loader',
  )
  await writeFile(
    join(wasiDir, `${binaryName}.wasip1.cjs`),
    '// stale published loader',
  )

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))

  t.regex(error.message, /Incomplete artifact source/)
  t.true(error.message.includes(`${binaryName}.wasip1.d.cts`))
  t.false(existsSync(join(wasiDir, `${binaryName}.wasip1.cjs`)))
  t.false(existsSync(join(wasiDir, `${binaryName}.wasm32-wasip1.wasm`)))
})

test('rejects incomplete-artifact cleanup through a symlinked target directory', async (t) => {
  const { tmpDir } = t.context
  const projectDir = join(tmpDir, 'project')
  const outsideDir = join(tmpDir, 'outside')
  const binaryName = 'test-artifacts-incomplete-symlink-cleanup'
  await mkdir(projectDir)
  const [wasiDir] = await setupWasiProject(projectDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  const artifactName = `${binaryName}.wasm32-wasip1.wasm`
  const artifactsDir = join(projectDir, 'artifacts')
  const targetArtifactsDir = join(artifactsDir, 'bindings-wasm32-wasip1')
  await mkdir(targetArtifactsDir)
  await rename(
    join(artifactsDir, artifactName),
    join(targetArtifactsDir, artifactName),
  )
  await writeFile(
    join(targetArtifactsDir, `${binaryName}.wasip1.cjs`),
    '// incomplete downloaded loader',
  )

  await rm(wasiDir, { recursive: true })
  await mkdir(outsideDir)
  const outsideArtifact = join(outsideDir, artifactName)
  const outsideLoader = join(outsideDir, `${binaryName}.wasip1.cjs`)
  const rootArtifact = join(projectDir, artifactName)
  await writeFile(outsideArtifact, 'outside stale artifact')
  await writeFile(outsideLoader, 'outside stale loader')
  await writeFile(rootArtifact, 'root stale artifact')
  await symlink(outsideDir, wasiDir, directorySymlinkType)

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: projectDir }))

  t.regex(error.message, /Filesystem transaction path escapes/)
  t.is(await readFile(outsideArtifact, 'utf8'), 'outside stale artifact')
  t.is(await readFile(outsideLoader, 'utf8'), 'outside stale loader')
  t.is(await readFile(rootArtifact, 'utf8'), 'root stale artifact')
})

test('rejects duplicate configured WASI artifacts before copying', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-duplicate'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  const artifactName = `${binaryName}.wasm32-wasip1.wasm`
  const duplicateDir = join(tmpDir, 'artifacts', 'duplicate-build')
  await mkdir(duplicateDir)
  await writeFile(join(duplicateDir, artifactName), 'duplicate wasm')

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))
  t.regex(
    error.message,
    /Multiple artifacts found for binary artifact identities/,
  )
  t.true(error.message.includes(artifactName))
  t.true(error.message.includes(join(tmpDir, 'artifacts', artifactName)))
  t.true(error.message.includes(join(duplicateDir, artifactName)))
  t.regex(error.message, /exactly one build.*narrow --output-dir/)
  t.false(existsSync(join(wasiDir, artifactName)))
})

test('rejects duplicate native artifacts before copying', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-native-duplicate'
  const platformArchABI = 'linux-x64-gnu'
  const artifactName = `${binaryName}.${platformArchABI}.node`
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }),
  )
  const distDir = join(tmpDir, 'npm', platformArchABI)
  const firstArtifactDir = join(tmpDir, 'artifacts', 'build-a')
  const secondArtifactDir = join(tmpDir, 'artifacts', 'build-b')
  await mkdir(distDir, { recursive: true })
  await mkdir(firstArtifactDir, { recursive: true })
  await mkdir(secondArtifactDir, { recursive: true })
  const firstArtifact = join(firstArtifactDir, artifactName)
  const secondArtifact = join(secondArtifactDir, artifactName)
  await writeFile(firstArtifact, 'first native artifact')
  await writeFile(secondArtifact, 'second native artifact')

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))
  t.regex(
    error.message,
    /Multiple artifacts found for binary artifact identities/,
  )
  t.true(error.message.includes(artifactName))
  t.true(
    error.message.indexOf(firstArtifact) <
      error.message.indexOf(secondArtifact),
  )
  t.regex(error.message, /exactly one build.*narrow --output-dir/)
  t.false(existsSync(join(distDir, artifactName)))
  t.false(existsSync(join(tmpDir, artifactName)))
})

test('rejects unconfigured target artifacts before copying', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-unconfigured'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  const unexpectedArtifact = `${binaryName}.linux-x64-gnu.node`
  await writeFile(
    join(tmpDir, 'artifacts', unexpectedArtifact),
    'stale native artifact',
  )

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))

  t.regex(error.message, /unconfigured targets/)
  t.true(error.message.includes(unexpectedArtifact))
  t.false(existsSync(join(wasiDir, `${binaryName}.wasm32-wasip1.wasm`)))
})

test('missing target artifacts remove stale publishable outputs', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-missing-target'
  const [singleDir, threadedDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
    {
      target: 'wasm32-wasip1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])
  const missingArtifact = `${binaryName}.wasm32-wasip1.wasm`
  await rm(join(tmpDir, 'artifacts', missingArtifact))
  for (const path of [
    join(tmpDir, missingArtifact),
    join(singleDir, missingArtifact),
    join(singleDir, `${binaryName}.wasip1.cjs`),
    join(singleDir, `${binaryName}.wasip1-deferred.js`),
  ]) {
    await writeFile(path, 'stale output')
  }

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))

  t.regex(error.message, /Missing artifacts for configured targets/)
  t.true(error.message.includes(missingArtifact))
  t.false(existsSync(join(tmpDir, missingArtifact)))
  t.false(existsSync(join(singleDir, missingArtifact)))
  t.false(existsSync(join(singleDir, `${binaryName}.wasip1.cjs`)))
  t.false(existsSync(join(singleDir, `${binaryName}.wasip1-deferred.js`)))
  t.false(
    existsSync(join(threadedDir, `${binaryName}.wasm32-wasi.wasm`)),
    'validation must finish before copying any complete target',
  )
})

test('should reject an incomplete threadless artifact set', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-missing-deferred'
  await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: false,
    },
  ])
  const wasiDir = join(tmpDir, 'npm', 'wasm32-wasip1')
  const artifactName = `${binaryName}.wasm32-wasip1.wasm`
  await writeFile(join(wasiDir, artifactName), 'stale wasm')
  await writeFile(join(wasiDir, `${binaryName}.wasip1.cjs`), 'stale loader')

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))
  t.regex(error.message, /wasip1-deferred\.js/)
  t.false(existsSync(join(wasiDir, artifactName)))
  t.false(existsSync(join(wasiDir, `${binaryName}.wasip1.cjs`)))
})

test('rejects artifact metadata that escapes the build output', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-escape'
  await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  await writeFile(
    join(tmpDir, `${binaryName}.wasip1.cjs`),
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 1,
      rootEntry: '../escape.cjs',
    })}\n`,
  )

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))

  t.regex(error.message, /escapes its output directory/)
  t.false(
    existsSync(
      join(tmpDir, 'npm', 'wasm32-wasip1', `${binaryName}.wasm32-wasip1.wasm`),
    ),
  )
})

test('should reject a threadless artifact set without workerd types', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-missing-deferred-types'
  await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  await rm(join(tmpDir, `${binaryName}.wasip1-deferred.d.ts`))

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))
  t.regex(error.message, /wasip1-deferred\.d\.ts/)
})

test('should reject a WASI artifact set without binding types', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-missing-binding-types'
  await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  await rm(join(tmpDir, `${binaryName}.wasip1.d.cts`))

  const error = await t.throwsAsync(() => collectArtifacts({ cwd: tmpDir }))
  t.regex(error.message, /wasip1\.d\.cts/)
})

test('should tolerate a missing deferred loader for threaded WASI builds', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-threaded'
  const [wasiDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasi-preview1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])

  // must not throw even though the deferred loader was never emitted
  await collectArtifacts({ cwd: tmpDir })

  t.false(existsSync(join(wasiDir, `${binaryName}.wasi-deferred.js`)))
  t.true(existsSync(join(wasiDir, `${binaryName}.wasi.cjs`)))
  t.true(existsSync(join(wasiDir, 'wasi-worker.mjs')))
  t.true(existsSync(join(wasiDir, 'wasi-worker-browser.mjs')))
})

test('should route both WASI flavors into their own npm dirs side by side', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-flavors'
  // Declare the NON-threaded flavor first: `wasm32-wasi` is a prefix of
  // `wasm32-wasip1`, so substring dist-dir matching would bind the threaded
  // wasm to the non-threaded dir. Exact basename matching must not.
  const [singleDir, threadedDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
    {
      target: 'wasm32-wasip1-threads',
      platformArchABI: 'wasm32-wasi',
      loaderSuffix: 'wasi',
      hasThreads: true,
      withDeferredLoader: false,
    },
  ])

  await collectArtifacts({ cwd: tmpDir })

  // each flavor's wasm landed in ITS dir (exact-match, not prefix-match)
  t.is(
    await readFile(
      join(threadedDir, `${binaryName}.wasm32-wasi.wasm`),
      'utf-8',
    ),
    'wasm wasm32-wasi',
  )
  t.is(
    await readFile(
      join(singleDir, `${binaryName}.wasm32-wasip1.wasm`),
      'utf-8',
    ),
    'wasm wasm32-wasip1',
  )
  t.false(existsSync(join(singleDir, `${binaryName}.wasm32-wasi.wasm`)))
  t.false(existsSync(join(threadedDir, `${binaryName}.wasm32-wasip1.wasm`)))

  // per-flavor loader sets
  t.true(existsSync(join(threadedDir, `${binaryName}.wasi.cjs`)))
  t.true(existsSync(join(threadedDir, `${binaryName}.wasi.d.cts`)))
  t.true(existsSync(join(threadedDir, `${binaryName}.wasi-browser.js`)))
  t.true(existsSync(join(threadedDir, 'wasi-worker.mjs')))
  t.true(existsSync(join(threadedDir, 'wasi-worker-browser.mjs')))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1.cjs`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1.d.cts`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1-browser.js`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1-deferred.js`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1-deferred.d.ts`)))
  t.false(existsSync(join(singleDir, 'wasi-worker.mjs')))
  t.false(existsSync(join(singleDir, 'wasi-worker-browser.mjs')))
})

test('removes stale cross-flavor files from configured npm dirs', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-stale-cross-flavor'
  const [singleDir] = await setupWasiProject(tmpDir, binaryName, [
    {
      target: 'wasm32-wasip1',
      platformArchABI: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      hasThreads: false,
      withDeferredLoader: true,
    },
  ])
  const staleFiles = [
    `${binaryName}.wasm32-wasi.wasm`,
    `${binaryName}.wasi.cjs`,
    `${binaryName}.wasi.d.cts`,
    `${binaryName}.wasi-browser.js`,
    'wasi-worker.mjs',
    'wasi-worker-browser.mjs',
  ]
  await Promise.all(
    staleFiles.map((fileName) =>
      writeFile(join(singleDir, fileName), 'stale cross-flavor output'),
    ),
  )

  await collectArtifacts({ cwd: tmpDir })

  for (const fileName of staleFiles) {
    t.false(existsSync(join(singleDir, fileName)), fileName)
  }
  t.true(existsSync(join(singleDir, `${binaryName}.wasm32-wasip1.wasm`)))
  t.true(existsSync(join(singleDir, `${binaryName}.wasip1.cjs`)))
})

test('preserves unrelated files in native npm dirs', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-native-unrelated'
  const platformArchABI = 'linux-x64-gnu'
  const artifactName = `${binaryName}.${platformArchABI}.node`
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }),
  )
  const artifactsDir = join(tmpDir, 'artifacts')
  const distDir = join(tmpDir, 'npm', platformArchABI)
  await mkdir(artifactsDir)
  await mkdir(distDir, { recursive: true })
  await writeFile(join(artifactsDir, artifactName), 'native artifact')
  await writeFile(join(distDir, 'wasi-worker.mjs'), 'user-owned file')

  await collectArtifacts({ cwd: tmpDir })

  t.is(
    await readFile(join(distDir, 'wasi-worker.mjs'), 'utf8'),
    'user-owned file',
  )
  t.true(existsSync(join(distDir, artifactName)))
})

test('preserves user-owned root binaries and removes stale managed artifacts', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'test-artifacts-root-ownership'
  const platformArchABI = 'linux-x64-gnu'
  const artifactName = `${binaryName}.${platformArchABI}.node`
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }),
  )
  const artifactsDir = join(tmpDir, 'artifacts')
  const distDir = join(tmpDir, 'npm', platformArchABI)
  await mkdir(artifactsDir)
  await mkdir(distDir, { recursive: true })
  await writeFile(join(artifactsDir, artifactName), 'native artifact')

  const userOwnedFiles = [
    'browser.js',
    `${binaryName}.custom.node`,
    `${binaryName}.custom.wasm`,
    `${binaryName}.linux-arm64-gnu.wasm`,
    `${binaryName}.wasm32-wasip1.node`,
  ]
  const staleManagedFiles = [
    `${binaryName}.linux-arm64-gnu.node`,
    `${binaryName}.wasm32-wasip1.wasm`,
  ]
  await Promise.all([
    ...userOwnedFiles.map((fileName) =>
      writeFile(join(tmpDir, fileName), `user-owned ${fileName}`),
    ),
    ...staleManagedFiles.map((fileName) =>
      writeFile(join(tmpDir, fileName), `stale ${fileName}`),
    ),
  ])

  await collectArtifacts({ cwd: tmpDir })

  for (const fileName of userOwnedFiles) {
    t.is(
      await readFile(join(tmpDir, fileName), 'utf8'),
      `user-owned ${fileName}`,
    )
  }
  for (const fileName of staleManagedFiles) {
    t.false(existsSync(join(tmpDir, fileName)), fileName)
  }
  t.is(await readFile(join(tmpDir, artifactName), 'utf8'), 'native artifact')
  t.true(existsSync(join(distDir, artifactName)))
})
