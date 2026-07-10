import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, watch } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename as move,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import ava, { type ExecutionContext, type TestFn } from 'ava'
import { load as yamlLoad } from 'js-yaml'

import {
  createWasmModuleTypeDef,
  getPackageReconciliationRoot,
  readNapiConfig,
  withFileSystemReconciliation,
} from '../../utils/index.js'
import { prePublish } from '../pre-publish.js'
import { renameProject } from '../rename.js'

const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'
const WASI_ROOT_FACADE_MARKER_PREFIX = '// napi-rs-wasi-root-facade:'
const MINIMAL_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
const RECONCILIATION_LOCK_NAME = '.napi-rs-filesystem-reconciliation'
const RECONCILIATION_CANDIDATE_MARKER = '.candidate.'

const test = ava as TestFn<{
  tmpDir: string
}>

test.beforeEach((t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  t.context = {
    tmpDir: join(
      tmpdir(),
      'napi-rs-test',
      `rename-project-${timestamp}-${random}`,
    ),
  }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeout = 30_000,
) {
  const controller = new AbortController()
  try {
    return await Promise.race([
      promise,
      delay(timeout, undefined, { signal: controller.signal }).then(() => {
        throw new Error(message)
      }),
    ])
  } finally {
    controller.abort()
  }
}

async function waitForPath(path: string) {
  while (!existsSync(path)) {
    await delay(10)
  }
}

async function watchForReconciliationAttempt(root: string) {
  const canonicalRoot = await realpath(root)
  const stats = await lstat(canonicalRoot)
  const candidatePrefixes = [canonicalRoot, `inode:${stats.ino}`].map(
    (key) =>
      `${RECONCILIATION_LOCK_NAME}.${createHash('sha256')
        .update(key)
        .digest('hex')}${RECONCILIATION_CANDIDATE_MARKER}`,
  )
  let markAttempted!: () => void
  let failAttempted!: (error: Error) => void
  const attempted = new Promise<void>((resolve, reject) => {
    markAttempted = resolve
    failAttempted = reject
  })
  const watcher = watch(
    dirname(canonicalRoot),
    { persistent: false },
    (_event, filename) => {
      const name = filename?.toString()
      if (
        !name ||
        candidatePrefixes.some((prefix) => name.startsWith(prefix))
      ) {
        markAttempted()
      }
    },
  )
  watcher.once('error', failAttempted)
  return {
    attempted,
    close: () => watcher.close(),
  }
}

async function writeRenameProbeWorker(path: string) {
  await writeFile(
    path,
    `import { writeFile } from 'node:fs/promises'
import { renameProject } from ${JSON.stringify(
      new URL('../rename.ts', import.meta.url).href,
    )}
import { withFileSystemReconciliation } from ${JSON.stringify(
      new URL('../../utils/misc.ts', import.meta.url).href,
    )}

const [
  cwd,
  packageJsonPath,
  npmDir,
  description,
  probeRoot,
  probePath,
  resultPath,
] = process.argv.slice(2)
let result
try {
  result = renameProject({
    cwd,
    packageJsonPath,
    npmDir,
    description,
  }).then(
    () => ({ status: 'fulfilled' }),
    (error) => ({
      status: 'rejected',
      code: error?.code,
      message: error instanceof Error ? error.message : String(error),
    }),
  )
} catch (error) {
  result = Promise.resolve({
    status: 'rejected',
    code: error?.code,
    message: error instanceof Error ? error.message : String(error),
  })
}

await withFileSystemReconciliation(probeRoot, async () => {
  await writeFile(probePath, '')
})
await writeFile(resultPath, JSON.stringify(await result))
`,
  )
}

function spawnTestWorker(workerPath: string, args: string[]) {
  const child = spawn(
    process.execPath,
    ['--import', '@oxc-node/core/register', workerPath, ...args],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `Test worker exited with ${signal ?? code}: ${stderr.trim()}`,
          ),
        )
      }
    })
  })
  return {
    completed,
    terminate: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
      await completed.catch(() => {})
    },
  }
}

async function createFixtureProject(
  cwd: string,
  options: {
    packageJson: Record<string, unknown>
    cargoPackageName: string
    configPath?: string
    configData?: Record<string, unknown>
  },
) {
  await mkdir(join(cwd, '.github', 'workflows'), { recursive: true })

  await writeFile(
    join(cwd, 'package.json'),
    `${JSON.stringify(options.packageJson, null, 2)}\n`,
  )
  await writeFile(
    join(cwd, 'Cargo.toml'),
    `[package]\nname = "${options.cargoPackageName}"\n`,
  )
  await writeFile(
    join(cwd, '.github', 'workflows', 'CI.yml'),
    'env:\n  APP_NAME: foo\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
  )
  await writeFile(
    join(cwd, '.gitattributes'),
    'foo.wasi-browser.js linguist-generated=true\nfoo.wasi.cjs linguist-generated=true\n',
  )
  await writeFile(join(cwd, 'foo.wasi-browser.js'), 'browser binding\n')
  await writeFile(join(cwd, 'foo.wasi.cjs'), 'node binding\n')

  if (options.configPath && options.configData) {
    await writeFile(
      join(cwd, options.configPath),
      `${JSON.stringify(options.configData, null, 2)}\n`,
    )
  }
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, path)))
    } else {
      files.push(path)
    }
  }
  return files
}

async function snapshotFiles(directory: string) {
  return Object.fromEntries(
    await Promise.all(
      (await listFiles(directory)).sort().map(async (file) => {
        const path = join(directory, file)
        const stats = await lstat(path)
        return [
          file,
          stats.isSymbolicLink()
            ? `symlink:${await readlink(path)}`
            : (await readFile(path)).toString('base64'),
        ]
      }),
    ),
  )
}

async function createPackageIdentityFixture(
  cwd: string,
  binaryName: string,
  packageName: string,
) {
  const targets = [
    {
      platformArchABI: 'wasm32-wasi',
      triple: 'wasm32-wasip1-threads',
      loaderSuffix: 'wasi',
      threaded: true,
    },
    {
      platformArchABI: 'wasm32-wasip1',
      triple: 'wasm32-wasip1',
      loaderSuffix: 'wasip1',
      threaded: false,
    },
  ]
  const facadePrefix = `${binaryName}.wasm32-wasip1`
  const facadeFiles = [
    `${facadePrefix}.workerd.mjs`,
    `${facadePrefix}.workerd.d.mts`,
    `${facadePrefix}.wasm`,
    `${facadePrefix}.wasm.d.mts`,
  ]
  const flavorPackage = `${packageName}-wasm32-wasip1`
  const facadeMarker = `${WASI_ROOT_FACADE_MARKER_PREFIX}${JSON.stringify({
    version: 1,
    flavorPackage,
    wasmSha256: createHash('sha256').update(MINIMAL_WASM).digest('hex'),
  })}`
  const facadeForwarder = `export * from ${JSON.stringify(`${flavorPackage}/workerd`)}\n`

  await mkdir(cwd, { recursive: true })
  await writeFile(
    join(cwd, 'package.json'),
    `${JSON.stringify(
      {
        name: 'rename-fixture-root',
        version: '1.0.0',
        main: 'index.cjs',
        browser: 'browser.js',
        types: 'index.d.cts',
        files: ['index.cjs', 'browser.js', 'index.d.cts', ...facadeFiles],
        exports: {
          '.': {
            types: './index.d.cts',
            browser: './browser.js',
            require: './index.cjs',
            default: './index.cjs',
          },
          './workerd': {
            types: `./${facadePrefix}.workerd.d.mts`,
            default: `./${facadePrefix}.workerd.mjs`,
          },
          './wasm': {
            types: `./${facadePrefix}.wasm.d.mts`,
            default: `./${facadePrefix}.wasm`,
          },
          './wasm.wasm': {
            types: `./${facadePrefix}.wasm.d.mts`,
            default: `./${facadePrefix}.wasm`,
          },
        },
        optionalDependencies: Object.fromEntries(
          targets.map((target) => [
            `${packageName}-${target.platformArchABI}`,
            '1.0.0',
          ]),
        ),
        napi: {
          binaryName,
          packageName,
          targets: targets.map((target) => target.triple),
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(cwd, 'Cargo.toml'),
    `[package]\nname = "${binaryName}"\n`,
  )
  await writeFile(
    join(cwd, 'index.cjs'),
    targets
      .map(
        (target) =>
          `require.resolve(${JSON.stringify(`${packageName}-${target.platformArchABI}`)})`,
      )
      .join('\n'),
  )
  await writeFile(
    join(cwd, 'browser.js'),
    `export * from ${JSON.stringify(`${packageName}-wasm32-wasip1`)}\n`,
  )
  await writeFile(
    join(cwd, 'index.d.cts'),
    'export declare const value: true\n',
  )
  await writeFile(
    join(cwd, `${facadePrefix}.workerd.mjs`),
    `${facadeMarker}\n${facadeForwarder}`,
  )
  await writeFile(
    join(cwd, `${facadePrefix}.workerd.d.mts`),
    `${facadeMarker}\n${facadeForwarder}`,
  )
  await writeFile(join(cwd, `${facadePrefix}.wasm`), MINIMAL_WASM)
  await writeFile(
    join(cwd, `${facadePrefix}.wasm.d.mts`),
    `${facadeMarker}\n${createWasmModuleTypeDef()}`,
  )

  for (const target of targets) {
    const directory = join(cwd, 'npm', target.platformArchABI)
    await mkdir(directory, { recursive: true })
    const artifact = `${binaryName}.${target.platformArchABI}.wasm`
    const loader = `${binaryName}.${target.loaderSuffix}.cjs`
    const types = `${binaryName}.${target.loaderSuffix}.d.cts`
    const browser = `${binaryName}.${target.loaderSuffix}-browser.js`
    const files = [artifact, loader, types, browser]
    const manifest: Record<string, unknown> = {
      name: `${packageName}-${target.platformArchABI}`,
      version: '1.0.0',
      type: 'module',
      main: loader,
      types,
      browser,
      files,
    }
    if (target.threaded) {
      files.push('wasi-worker.mjs', 'wasi-worker-browser.mjs')
    } else {
      const deferred = `${binaryName}.${target.loaderSuffix}-deferred.js`
      const deferredTypes = `${binaryName}.${target.loaderSuffix}-deferred.d.ts`
      const wasmTypes = `${artifact}.d.ts`
      files.push(deferred, deferredTypes, wasmTypes)
      manifest.exports = {
        '.': {
          types: `./${types}`,
          browser: `./${browser}`,
          require: `./${loader}`,
          default: `./${loader}`,
        },
        './workerd': {
          types: `./${deferredTypes}`,
          default: `./${deferred}`,
        },
        './wasm': {
          types: `./${wasmTypes}`,
          default: `./${artifact}`,
        },
        './wasm.wasm': {
          types: `./${wasmTypes}`,
          default: `./${artifact}`,
        },
        './package.json': './package.json',
      }
    }
    await writeFile(
      join(directory, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    await writeFile(
      join(directory, 'README.md'),
      `# \`${packageName}-${target.platformArchABI}\`\n\nThis is the **${target.triple}** binary for \`${packageName}\`\n`,
    )
    await writeFile(join(directory, artifact), MINIMAL_WASM)
    await writeFile(
      join(directory, loader),
      `module.exports = require(${JSON.stringify(`${packageName}-${target.platformArchABI}`)})\n`,
    )
    await writeFile(
      join(directory, types),
      'declare const binding: Record<string, unknown>\nexport = binding\n',
    )
    await writeFile(
      join(directory, browser),
      `export * from ${JSON.stringify(`${packageName}-${target.platformArchABI}`)}\n`,
    )
    if (target.threaded) {
      await writeFile(join(directory, 'wasi-worker.mjs'), 'export {}\n')
      await writeFile(join(directory, 'wasi-worker-browser.mjs'), 'export {}\n')
    } else {
      await writeFile(
        join(directory, `${binaryName}.${target.loaderSuffix}-deferred.js`),
        'export async function instantiate() {}\n',
      )
      await writeFile(
        join(directory, `${binaryName}.${target.loaderSuffix}-deferred.d.ts`),
        `export type WasiBinding = typeof import('./${loader}')\n`,
      )
      await writeFile(
        join(directory, `${artifact}.d.ts`),
        createWasmModuleTypeDef(),
      )
    }
  }
}

async function assertPackageIdentityFixture(
  t: ExecutionContext,
  cwd: string,
  oldBinaryName: string,
  oldPackageName: string,
  binaryName: string,
  packageName: string,
) {
  const rootManifest = JSON.parse(
    await readFile(join(cwd, 'package.json'), 'utf8'),
  )
  t.is(rootManifest.napi.binaryName, binaryName)
  t.is(rootManifest.napi.packageName, packageName)
  t.deepEqual(rootManifest.optionalDependencies, {
    [`${packageName}-wasm32-wasi`]: '1.0.0',
    [`${packageName}-wasm32-wasip1`]: '1.0.0',
  })

  for (const [platformArchABI, triple, loaderSuffix] of [
    ['wasm32-wasi', 'wasm32-wasip1-threads', 'wasi'],
    ['wasm32-wasip1', 'wasm32-wasip1', 'wasip1'],
  ]) {
    const directory = join(cwd, 'npm', platformArchABI)
    const manifest = JSON.parse(
      await readFile(join(directory, 'package.json'), 'utf8'),
    )
    const flavorPackage = `${packageName}-${platformArchABI}`
    const loader = `${binaryName}.${loaderSuffix}.cjs`
    t.is(manifest.name, flavorPackage)
    t.is(manifest.main, loader)
    t.is(
      await readFile(join(directory, 'README.md'), 'utf8'),
      `# \`${flavorPackage}\`\n\nThis is the **${triple}** binary for \`${packageName}\`\n`,
    )
    const loaderSource = await readFile(join(directory, loader), 'utf8')
    t.true(loaderSource.includes(flavorPackage))
    t.false(loaderSource.includes(oldPackageName))
    t.true(existsSync(join(directory, `${binaryName}.${platformArchABI}.wasm`)))
    if (binaryName !== oldBinaryName) {
      t.false(
        existsSync(join(directory, `${oldBinaryName}.${platformArchABI}.wasm`)),
      )
    }
  }

  for (const entry of ['index.cjs', 'browser.js']) {
    const source = await readFile(join(cwd, entry), 'utf8')
    t.true(source.includes(packageName))
    t.false(source.includes(oldPackageName))
  }
  const facadePrefix = `${binaryName}.wasm32-wasip1`
  const facadeSource = await readFile(
    join(cwd, `${facadePrefix}.workerd.mjs`),
    'utf8',
  )
  t.true(facadeSource.includes(`${packageName}-wasm32-wasip1/workerd`))
  t.false(facadeSource.includes(oldPackageName))
  if (binaryName !== oldBinaryName) {
    t.false(existsSync(join(cwd, `${oldBinaryName}.wasm32-wasip1.workerd.mjs`)))
  }

  await t.notThrowsAsync(() =>
    prePublish({
      cwd,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
}

test('omitting binaryName keeps existing wasi artifact names and binary references', async (t) => {
  const projectPath = join(t.context.tmpDir, 'artifact-rename')

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: projectPath,
    name: 'renamed',
  })

  const packageJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
  )
  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf8')
  const gitAttributes = await readFile(
    join(projectPath, '.gitattributes'),
    'utf8',
  )
  const ciYaml = yamlLoad(
    await readFile(join(projectPath, '.github', 'workflows', 'CI.yml'), 'utf8'),
  ) as any

  t.is(packageJson.name, 'renamed')
  t.is(packageJson.napi.binaryName, 'foo')
  t.is(packageJson.napi.packageName, '@scope/original')
  t.true(cargoToml.includes('name = "foo"'))
  t.true(existsSync(join(projectPath, 'foo.wasi-browser.js')))
  t.true(existsSync(join(projectPath, 'foo.wasi.cjs')))
  t.false(existsSync(join(projectPath, 'undefined.wasi-browser.js')))
  t.false(existsSync(join(projectPath, 'undefined.wasi.cjs')))
  t.true(gitAttributes.includes('foo.wasi-browser.js'))
  t.true(gitAttributes.includes('foo.wasi.cjs'))
  t.false(gitAttributes.includes('undefined.wasi-browser.js'))
  t.false(gitAttributes.includes('undefined.wasi.cjs'))
  t.is(ciYaml.env.APP_NAME, 'foo')
})

test('omitting binaryName preserves separated napi config fields', async (t) => {
  const projectPath = join(t.context.tmpDir, 'config-rename')

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
    },
    cargoPackageName: 'foo',
    configPath: 'napi.json',
    configData: {
      binaryName: 'foo',
      packageName: '@scope/original',
    },
  })

  await renameProject({
    cwd: projectPath,
    configPath: 'napi.json',
    name: 'renamed',
  })

  const config = JSON.parse(
    await readFile(join(projectPath, 'napi.json'), 'utf8'),
  )

  t.is(config.binaryName, 'foo')
  t.is(config.packageName, '@scope/original')
  t.true(existsSync(join(projectPath, 'foo.wasi-browser.js')))
  t.true(existsSync(join(projectPath, 'foo.wasi.cjs')))
  t.false(existsSync(join(projectPath, 'undefined.wasi-browser.js')))
  t.false(existsSync(join(projectPath, 'undefined.wasi.cjs')))
})

test('repository updates package.json when provided', async (t) => {
  const projectPath = join(t.context.tmpDir, 'repository-rename')

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      repository: {
        type: 'git',
        url: 'https://example.com/old.git',
      },
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: projectPath,
    name: 'renamed',
    repository: 'https://example.com/new.git',
  })

  const packageJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
  )

  t.is(packageJson.name, 'renamed')
  t.is(packageJson.repository.url, 'https://example.com/new.git')
  t.is(packageJson.repository.type, 'git')
})

test('binaryName renames every configured WASI artifact and package reference', async (t) => {
  const projectPath = join(t.context.tmpDir, 'wasi-artifact-rename')
  const oldName = 'foo'
  const newName = 'renamed'
  const threadedSuffixes = [
    'wasm32-wasi.wasm',
    'wasm32-wasi.debug.wasm',
    'wasi.cjs',
    'wasi.d.cts',
    'wasi-browser.js',
  ]
  const threadlessSuffixes = [
    'wasm32-wasip1.wasm',
    'wasm32-wasip1.debug.wasm',
    'wasm32-wasip1.wasm.d.ts',
    'wasm32-wasip1.wasm.d.mts',
    'wasm32-wasip1.workerd.mjs',
    'wasm32-wasip1.workerd.d.mts',
    'wasip1.cjs',
    'wasip1.d.cts',
    'wasip1-browser.js',
    'wasip1-deferred.js',
    'wasip1-deferred.d.ts',
  ]
  const managedSuffixes = [
    'wasm',
    'debug.wasm',
    ...threadedSuffixes,
    ...threadlessSuffixes,
  ]
  const oldManagedFiles = managedSuffixes.map(
    (suffix) => `${oldName}.${suffix}`,
  )
  const newManagedFiles = managedSuffixes.map(
    (suffix) => `${newName}.${suffix}`,
  )
  const allOldReferences = oldManagedFiles.join('\n')
  const artifactContent = (file: string) => {
    if (file.endsWith('.wasm')) {
      return 'wasm artifact'
    }
    const metadata = file.endsWith('.cjs')
      ? `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
          version: 2,
          rootEntry: 'index.cjs',
          exports: [],
          managedRootEntries: [
            'browser.js',
            'index.cjs',
            `${oldName}.wasm`,
            `${oldName}.debug.wasm`,
          ],
        })}\n`
      : ''
    return `${metadata}${allOldReferences}\n`
  }

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      main: 'index.cjs',
      browser: 'browser.js',
      files: oldManagedFiles,
      exports: {
        './workerd': `./${oldName}.wasm32-wasip1.workerd.mjs`,
        './wasm': `./${oldName}.wasm32-wasip1.wasm`,
      },
      napi: {
        binaryName: oldName,
        packageName: '@scope/original',
        targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: oldName,
  })

  await Promise.all([
    ...oldManagedFiles.map((file) =>
      writeFile(join(projectPath, file), artifactContent(file)),
    ),
    writeFile(join(projectPath, 'index.cjs'), `${allOldReferences}\n`),
    writeFile(join(projectPath, 'browser.js'), `${allOldReferences}\n`),
    writeFile(
      join(projectPath, '.gitattributes'),
      `${oldManagedFiles
        .map((file) => `${file} linguist-generated=true`)
        .join('\n')}\n`,
    ),
  ])

  for (const platformArchABI of ['wasm32-wasi', 'wasm32-wasip1']) {
    const packageDirectory = join(projectPath, 'npm', platformArchABI)
    await mkdir(packageDirectory, { recursive: true })
    const packageFiles = (
      platformArchABI === 'wasm32-wasi' ? threadedSuffixes : threadlessSuffixes
    ).map((suffix) => `${oldName}.${suffix}`)
    await Promise.all([
      ...packageFiles.map((file) =>
        writeFile(join(packageDirectory, file), artifactContent(file)),
      ),
      writeFile(
        join(packageDirectory, 'package.json'),
        `${JSON.stringify(
          {
            name: `@scope/original-${platformArchABI}`,
            main:
              platformArchABI === 'wasm32-wasi'
                ? `${oldName}.wasi.cjs`
                : `${oldName}.wasip1.cjs`,
            files: packageFiles,
            exports:
              platformArchABI === 'wasm32-wasip1'
                ? {
                    './workerd': `./${oldName}.wasip1-deferred.js`,
                    './wasm': `./${oldName}.wasm32-wasip1.wasm`,
                  }
                : undefined,
          },
          null,
          2,
        )}\n`,
      ),
    ])
  }

  await renameProject({
    cwd: projectPath,
    binaryName: newName,
  })

  const files = await listFiles(projectPath)
  for (const oldFile of oldManagedFiles) {
    t.false(
      files.some((file) => file.split(/[\\/]/).includes(oldFile)),
      `stale filename: ${oldFile}`,
    )
  }
  for (const newFile of newManagedFiles) {
    t.true(existsSync(join(projectPath, newFile)), newFile)
  }
  for (const platformArchABI of ['wasm32-wasi', 'wasm32-wasip1']) {
    const packageDirectory = join(projectPath, 'npm', platformArchABI)
    const suffixes =
      platformArchABI === 'wasm32-wasi' ? threadedSuffixes : threadlessSuffixes
    for (const suffix of suffixes) {
      t.true(
        existsSync(join(packageDirectory, `${newName}.${suffix}`)),
        `${platformArchABI}: ${newName}.${suffix}`,
      )
    }
  }

  for (const file of files) {
    if (file.endsWith('.wasm')) {
      continue
    }
    const content = await readFile(join(projectPath, file), 'utf8')
    for (const oldFile of oldManagedFiles) {
      t.false(content.includes(oldFile), `${file}: ${oldFile}`)
    }
  }
})

test('packageName independently renames every flavor package identity and loader reference', async (t) => {
  const projectPath = join(t.context.tmpDir, 'package-identity-rename')
  const binaryName = 'fixture'
  const oldPackageName = '@old-scope/original'
  const newPackageName = '@new-scope/renamed'

  await createPackageIdentityFixture(projectPath, binaryName, oldPackageName)
  await renameProject({
    cwd: projectPath,
    packageName: newPackageName,
  })

  await assertPackageIdentityFixture(
    t,
    projectPath,
    binaryName,
    oldPackageName,
    binaryName,
    newPackageName,
  )
})

test('combined scoped package and binary rename keeps every WASI flavor publishable', async (t) => {
  const projectPath = join(t.context.tmpDir, 'combined-wasi-rename')
  const oldBinaryName = 'fixture'
  const newBinaryName = 'renamed'
  const oldPackageName = '@old-scope/original'
  const newPackageName = '@new-scope/renamed'

  await createPackageIdentityFixture(projectPath, oldBinaryName, oldPackageName)
  await renameProject({
    cwd: projectPath,
    binaryName: newBinaryName,
    packageName: newPackageName,
  })

  await assertPackageIdentityFixture(
    t,
    projectPath,
    oldBinaryName,
    oldPackageName,
    newBinaryName,
    newPackageName,
  )
})

test('packageName-only rename preserves Cargo.toml byte-for-byte', async (t) => {
  const projectPath = join(t.context.tmpDir, 'cargo-preservation')
  const cargoToml = `[package]
# This comment and layout are project-owned.
name="fixture" # keep this inline comment

[package.metadata.custom]
value = "unchanged"
`
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'fixture',
        packageName: '@old-scope/original',
        targets: ['wasm32-wasip1'],
      },
    },
    cargoPackageName: 'fixture',
  })
  await writeFile(join(projectPath, 'Cargo.toml'), cargoToml)

  await renameProject({
    cwd: projectPath,
    packageName: '@new-scope/renamed',
  })

  t.is(await readFile(join(projectPath, 'Cargo.toml'), 'utf8'), cargoToml)
})

test('rename preserves executable modes across every managed write class', async (t) => {
  const projectPath = join(t.context.tmpDir, 'mode-preservation')
  const oldBinaryName = 'fixture'
  const newBinaryName = 'renamed'
  const oldPackageName = '@old-scope/original'
  const newPackageName = '@new-scope/renamed'
  await createPackageIdentityFixture(projectPath, oldBinaryName, oldPackageName)
  await writeFile(
    join(projectPath, 'napi.json'),
    `${JSON.stringify(
      {
        binaryName: oldBinaryName,
        packageName: oldPackageName,
        targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
      },
      null,
      2,
    )}\n`,
  )
  await mkdir(join(projectPath, '.github', 'workflows'), { recursive: true })
  await writeFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    `env:\n  APP_NAME: ${oldBinaryName}\n`,
  )

  const paths = {
    cargo: join(projectPath, 'Cargo.toml'),
    config: join(projectPath, 'napi.json'),
    flavorManifest: join(projectPath, 'npm', 'wasm32-wasip1', 'package.json'),
    managedRename: join(
      projectPath,
      'npm',
      'wasm32-wasip1',
      `${oldBinaryName}.wasip1.cjs`,
    ),
    managedText: join(projectPath, 'index.cjs'),
    packageManifest: join(projectPath, 'package.json'),
    readme: join(projectPath, 'npm', 'wasm32-wasip1', 'README.md'),
    workflow: join(projectPath, '.github', 'workflows', 'CI.yml'),
  }
  if (process.platform !== 'win32') {
    await Promise.all(Object.values(paths).map((path) => chmod(path, 0o755)))
  }

  await renameProject({
    cwd: projectPath,
    configPath: 'napi.json',
    binaryName: newBinaryName,
    packageName: newPackageName,
  })

  const updatedPaths = {
    ...paths,
    managedRename: join(
      projectPath,
      'npm',
      'wasm32-wasip1',
      `${newBinaryName}.wasip1.cjs`,
    ),
  }
  for (const [description, path] of Object.entries(updatedPaths)) {
    t.true(existsSync(path), description)
    if (process.platform !== 'win32') {
      t.is((await lstat(path)).mode & 0o7777, 0o755, description)
    }
  }
})

test('rename rejects binary path traversal without mutating outside files', async (t) => {
  const projectPath = join(t.context.tmpDir, 'traversal', 'project')
  const outsidePath = join(dirname(projectPath), 'outside.wasi.cjs')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: 'foo',
  })
  await writeFile(outsidePath, 'outside sentinel\n')
  const packageJsonBefore = await readFile(
    join(projectPath, 'package.json'),
    'utf8',
  )
  const cargoTomlBefore = await readFile(
    join(projectPath, 'Cargo.toml'),
    'utf8',
  )

  await t.throwsAsync(
    renameProject({
      cwd: projectPath,
      binaryName: '../outside',
    }),
    { message: /Requested binary name must be a safe filename stem/ },
  )

  t.is(await readFile(outsidePath, 'utf8'), 'outside sentinel\n')
  t.is(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
    packageJsonBefore,
  )
  t.is(await readFile(join(projectPath, 'Cargo.toml'), 'utf8'), cargoTomlBefore)
  t.is(
    await readFile(join(projectPath, 'foo.wasi.cjs'), 'utf8'),
    'node binding\n',
  )
})

test('rename validates configured binary names before mutation', async (t) => {
  const projectPath = join(t.context.tmpDir, 'configured-traversal')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: '../outside',
        packageName: '@scope/original',
      },
    },
    cargoPackageName: 'foo',
  })
  const packageJsonBefore = await readFile(
    join(projectPath, 'package.json'),
    'utf8',
  )

  await t.throwsAsync(
    renameProject({
      cwd: projectPath,
      packageName: '@scope/renamed',
    }),
    { message: /Configured binary name must be a safe filename stem/ },
  )

  t.is(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
    packageJsonBefore,
  )
})

test('rename rejects occupied managed destinations before mutation', async (t) => {
  const projectPath = join(t.context.tmpDir, 'occupied-destination')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: 'foo',
  })
  await writeFile(join(projectPath, 'bar.wasi.cjs'), 'destination sentinel\n')
  const packageJsonBefore = await readFile(
    join(projectPath, 'package.json'),
    'utf8',
  )

  await t.throwsAsync(
    renameProject({
      cwd: projectPath,
      binaryName: 'bar',
    }),
    { message: /destination already exists/ },
  )

  t.is(
    await readFile(join(projectPath, 'foo.wasi.cjs'), 'utf8'),
    'node binding\n',
  )
  t.is(
    await readFile(join(projectPath, 'bar.wasi.cjs'), 'utf8'),
    'destination sentinel\n',
  )
  t.is(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
    packageJsonBefore,
  )
})

test('two-phase rename preserves overlapping managed artifact chains', async (t) => {
  const projectPath = join(t.context.tmpDir, 'overlapping-renames')
  const oldBinaryName = 'foo.wasm32-wasi'
  await mkdir(projectPath, { recursive: true })
  await writeFile(
    join(projectPath, 'package.json'),
    `${JSON.stringify(
      {
        name: 'original',
        version: '1.0.0',
        napi: {
          binaryName: oldBinaryName,
          packageName: '@scope/original',
          targets: ['wasm32-wasip1-threads'],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(join(projectPath, 'Cargo.toml'), '[package]\nname = "foo"\n')
  await writeFile(
    join(projectPath, `${oldBinaryName}.wasm32-wasi.wasm`),
    'platform artifact',
  )
  await writeFile(
    join(projectPath, `${oldBinaryName}.wasm`),
    'generic artifact',
  )

  await renameProject({
    cwd: projectPath,
    binaryName: 'foo',
  })

  t.is(
    await readFile(join(projectPath, 'foo.wasm32-wasi.wasm'), 'utf8'),
    'platform artifact',
  )
  t.is(
    await readFile(join(projectPath, 'foo.wasm'), 'utf8'),
    'generic artifact',
  )
  t.false(existsSync(join(projectPath, `${oldBinaryName}.wasm32-wasi.wasm`)))
})

test('case-only managed filename rename preserves requested casing', async (t) => {
  const projectPath = join(t.context.tmpDir, 'case-only-rename')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: projectPath,
    binaryName: 'Foo',
  })

  const entries = await readdir(projectPath)
  t.true(entries.includes('Foo.wasi.cjs'))
  t.true(entries.includes('Foo.wasi-browser.js'))
  t.false(entries.includes('foo.wasi.cjs'))
  t.false(entries.includes('foo.wasi-browser.js'))
  t.is(
    await readFile(join(projectPath, 'Foo.wasi.cjs'), 'utf8'),
    'node binding\n',
  )
})

const caseInsensitiveTest =
  process.platform === 'darwin' || process.platform === 'win32'
    ? test
    : test.skip

caseInsensitiveTest(
  'rename accepts a case-variant package manifest path',
  async (t) => {
    const projectPath = join(t.context.tmpDir, 'case-insensitive-manifest')
    await createFixtureProject(projectPath, {
      packageJson: {
        name: 'original',
        napi: {
          binaryName: 'foo',
          packageName: '@scope/original',
        },
      },
      cargoPackageName: 'foo',
    })
    if (!existsSync(join(projectPath, 'PACKAGE.JSON'))) {
      t.pass()
      return
    }

    await renameProject({
      cwd: projectPath,
      packageJsonPath: 'PACKAGE.JSON',
      description: 'updated through a case variant',
    })

    const packageJson = JSON.parse(
      await readFile(join(projectPath, 'package.json'), 'utf8'),
    )
    t.is(packageJson.description, 'updated through a case variant')
  },
)

caseInsensitiveTest(
  'case-only rename accepts a destination that is the same filesystem entry',
  async (t) => {
    const projectPath = join(t.context.tmpDir, 'case-insensitive-rename')
    await createFixtureProject(projectPath, {
      packageJson: {
        name: 'original',
        napi: {
          binaryName: 'foo',
          packageName: '@scope/original',
          targets: ['wasm32-wasip1-threads'],
        },
      },
      cargoPackageName: 'foo',
    })
    if (!existsSync(join(projectPath, 'Foo.wasi.cjs'))) {
      t.pass()
      return
    }

    await renameProject({
      cwd: projectPath,
      binaryName: 'Foo',
    })

    const entries = await readdir(projectPath)
    t.true(entries.includes('Foo.wasi.cjs'))
    t.false(entries.includes('foo.wasi.cjs'))
  },
)

test('case-sensitive filesystems still reject an occupied case variant', async (t) => {
  const projectPath = join(t.context.tmpDir, 'case-sensitive-collision')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: 'foo',
  })
  const destination = join(projectPath, 'Foo.wasi.cjs')
  try {
    await writeFile(destination, 'occupied case variant\n', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      t.pass()
      return
    }
    throw error
  }

  await t.throwsAsync(
    renameProject({
      cwd: projectPath,
      binaryName: 'Foo',
    }),
    { message: /destination already exists/ },
  )
  t.is(
    await readFile(join(projectPath, 'foo.wasi.cjs'), 'utf8'),
    'node binding\n',
  )
  t.is(await readFile(destination, 'utf8'), 'occupied case variant\n')
})

test('managed rename does not treat a symlink alias as a case-only destination', async (t) => {
  if (process.platform === 'win32') {
    t.pass()
    return
  }
  const projectPath = join(t.context.tmpDir, 'symlink-destination')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: 'foo',
  })
  await symlink('foo.wasi.cjs', join(projectPath, 'Bar.wasi.cjs'), 'file')

  await t.throwsAsync(
    renameProject({
      cwd: projectPath,
      binaryName: 'Bar',
    }),
    { message: /destination already exists/ },
  )
  t.is(
    await readFile(join(projectPath, 'foo.wasi.cjs'), 'utf8'),
    'node binding\n',
  )
})

test('package rename preserves similarly prefixed dependencies and imports', async (t) => {
  const projectPath = join(t.context.tmpDir, 'package-prefix-collision')
  const binaryName = 'fixture'
  const oldPackageName = '@old-scope/original'
  const newPackageName = '@new-scope/renamed'
  const oldFlavor = `${oldPackageName}-wasm32-wasip1`
  const newFlavor = `${newPackageName}-wasm32-wasip1`
  const helperPackage = `${oldFlavor}-helper`
  const flavorPatchLocator = `~/.yarn/patches/${oldFlavor}.patch`
  const helperPatchLocator = `~/.yarn/patches/${helperPackage}.patch`
  const nestedPatchResolution = `@workspace/consumer/${oldFlavor}`

  await createPackageIdentityFixture(projectPath, binaryName, oldPackageName)
  const packageJsonPath = join(projectPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.optionalDependencies[helperPackage] = '1.0.0'
  packageJson.dependencies = {
    'flavor-alias': `npm:${oldFlavor}@1.0.0`,
    'helper-alias': `npm:${helperPackage}@1.0.0`,
  }
  packageJson.dependenciesMeta = {
    [oldFlavor]: {
      note: oldFlavor,
    },
    [helperPackage]: {
      note: oldFlavor,
    },
  }
  packageJson.trustedDependencies = [oldFlavor, helperPackage]
  packageJson.resolutions = {
    [`**/${oldFlavor}`]: `npm:${oldFlavor}@1.0.0`,
    [`**/${helperPackage}`]: `npm:${helperPackage}@1.0.0`,
    'flavor-patch': `patch:${oldFlavor}@npm%3A1.0.0#${flavorPatchLocator}`,
    [nestedPatchResolution]: `patch:${oldFlavor}@npm%3A1.0.0#${flavorPatchLocator}`,
    'helper-patch': `patch:${helperPackage}@npm%3A1.0.0#${helperPatchLocator}`,
    'foreign-patch': `patch:@other/package@npm%3A1.0.0#${flavorPatchLocator}`,
  }
  packageJson.overrides = {
    [`${oldFlavor}@^1`]: {
      [oldFlavor]: `npm:${oldFlavor}@1.0.0`,
      [helperPackage]: `npm:${helperPackage}@1.0.0`,
    },
    [`prefix-${oldFlavor}`]: '1.0.0',
  }
  packageJson.pnpm = {
    onlyBuiltDependencies: [oldFlavor],
    ignoredBuiltDependencies: [oldFlavor, helperPackage],
    ignoredOptionalDependencies: [oldFlavor, helperPackage],
    minimumReleaseAgeExclude: [oldFlavor, helperPackage],
    neverBuiltDependencies: [oldFlavor],
    overrides: {
      [`parent>${oldFlavor}@^1`]: `npm:${oldFlavor}@1.0.0`,
      [`**/${helperPackage}`]: `npm:${helperPackage}@1.0.0`,
      untouched: oldFlavor,
    },
    patchedDependencies: {
      [`${oldFlavor}@1.0.0`]: `patches/${oldFlavor}.patch`,
      [`${helperPackage}@1.0.0`]: `patches/${helperPackage}.patch`,
    },
    packageExtensions: {
      [`${oldFlavor}@^1`]: {
        dependencies: {
          [oldFlavor]: `npm:${oldFlavor}@1.0.0`,
          [helperPackage]: oldFlavor,
        },
        peerDependencies: {
          [oldFlavor]: '^1.0.0',
        },
        peerDependenciesMeta: {
          [oldFlavor]: {
            optional: true,
          },
        },
        description: oldFlavor,
      },
      [`${helperPackage}@^1`]: {
        dependencies: {
          [helperPackage]: '1.0.0',
        },
      },
    },
    allowedDeprecatedVersions: {
      [oldFlavor]: oldFlavor,
      [helperPackage]: oldFlavor,
    },
    allowBuilds: {
      [oldFlavor]: true,
      [helperPackage]: false,
    },
    trustPolicyExclude: [oldFlavor, helperPackage],
    peerDependencyRules: {
      ignoreMissing: [oldFlavor, helperPackage],
      allowAny: [oldFlavor, helperPackage],
      allowedVersions: {
        [oldFlavor]: oldFlavor,
        [helperPackage]: oldFlavor,
      },
      description: oldFlavor,
    },
    updateConfig: {
      ignoreDependencies: [oldFlavor, helperPackage],
      tag: oldFlavor,
    },
    unrelated: oldFlavor,
  }
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
  await writeFile(
    join(projectPath, 'index.cjs'),
    `${await readFile(join(projectPath, 'index.cjs'), 'utf8')}\nrequire(${JSON.stringify(helperPackage)})\n`,
  )

  await renameProject({
    cwd: projectPath,
    packageName: newPackageName,
  })

  const updatedPackageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.is(updatedPackageJson.optionalDependencies[newFlavor], '1.0.0')
  t.is(updatedPackageJson.optionalDependencies[helperPackage], '1.0.0')
  t.false(
    Object.prototype.hasOwnProperty.call(
      updatedPackageJson.optionalDependencies,
      `${newFlavor}-helper`,
    ),
  )
  t.is(
    updatedPackageJson.dependencies['flavor-alias'],
    `npm:${newFlavor}@1.0.0`,
  )
  t.is(
    updatedPackageJson.dependencies['helper-alias'],
    `npm:${helperPackage}@1.0.0`,
  )
  t.deepEqual(updatedPackageJson.dependenciesMeta, {
    [newFlavor]: {
      note: oldFlavor,
    },
    [helperPackage]: {
      note: oldFlavor,
    },
  })
  t.deepEqual(updatedPackageJson.trustedDependencies, [
    newFlavor,
    helperPackage,
  ])
  t.is(
    updatedPackageJson.resolutions[`**/${newFlavor}`],
    `npm:${newFlavor}@1.0.0`,
  )
  t.is(
    updatedPackageJson.resolutions[`**/${helperPackage}`],
    `npm:${helperPackage}@1.0.0`,
  )
  t.is(
    updatedPackageJson.resolutions['flavor-patch'],
    `patch:${newFlavor}@npm%3A1.0.0#${flavorPatchLocator}`,
  )
  t.is(
    updatedPackageJson.resolutions[`@workspace/consumer/${newFlavor}`],
    `patch:${newFlavor}@npm%3A1.0.0#${flavorPatchLocator}`,
  )
  t.is(
    updatedPackageJson.resolutions['helper-patch'],
    `patch:${helperPackage}@npm%3A1.0.0#${helperPatchLocator}`,
  )
  t.is(
    updatedPackageJson.resolutions['foreign-patch'],
    `patch:@other/package@npm%3A1.0.0#${flavorPatchLocator}`,
  )
  t.deepEqual(updatedPackageJson.overrides[`${newFlavor}@^1`], {
    [newFlavor]: `npm:${newFlavor}@1.0.0`,
    [helperPackage]: `npm:${helperPackage}@1.0.0`,
  })
  t.is(updatedPackageJson.overrides[`prefix-${oldFlavor}`], '1.0.0')
  t.is(
    updatedPackageJson.pnpm.overrides[`parent>${newFlavor}@^1`],
    `npm:${newFlavor}@1.0.0`,
  )
  t.is(
    updatedPackageJson.pnpm.overrides[`**/${helperPackage}`],
    `npm:${helperPackage}@1.0.0`,
  )
  t.is(updatedPackageJson.pnpm.overrides.untouched, oldFlavor)
  t.deepEqual(updatedPackageJson.pnpm.onlyBuiltDependencies, [newFlavor])
  t.deepEqual(updatedPackageJson.pnpm.ignoredBuiltDependencies, [
    newFlavor,
    helperPackage,
  ])
  t.deepEqual(updatedPackageJson.pnpm.ignoredOptionalDependencies, [
    newFlavor,
    helperPackage,
  ])
  t.deepEqual(updatedPackageJson.pnpm.minimumReleaseAgeExclude, [
    newFlavor,
    helperPackage,
  ])
  t.deepEqual(updatedPackageJson.pnpm.neverBuiltDependencies, [newFlavor])
  t.is(
    updatedPackageJson.pnpm.patchedDependencies[`${newFlavor}@1.0.0`],
    `patches/${oldFlavor}.patch`,
  )
  t.is(
    updatedPackageJson.pnpm.patchedDependencies[`${helperPackage}@1.0.0`],
    `patches/${helperPackage}.patch`,
  )
  t.deepEqual(updatedPackageJson.pnpm.packageExtensions[`${newFlavor}@^1`], {
    dependencies: {
      [newFlavor]: `npm:${newFlavor}@1.0.0`,
      [helperPackage]: oldFlavor,
    },
    peerDependencies: {
      [newFlavor]: '^1.0.0',
    },
    peerDependenciesMeta: {
      [newFlavor]: {
        optional: true,
      },
    },
    description: oldFlavor,
  })
  t.deepEqual(
    updatedPackageJson.pnpm.packageExtensions[`${helperPackage}@^1`],
    {
      dependencies: {
        [helperPackage]: '1.0.0',
      },
    },
  )
  t.deepEqual(updatedPackageJson.pnpm.allowedDeprecatedVersions, {
    [newFlavor]: oldFlavor,
    [helperPackage]: oldFlavor,
  })
  t.deepEqual(updatedPackageJson.pnpm.allowBuilds, {
    [newFlavor]: true,
    [helperPackage]: false,
  })
  t.deepEqual(updatedPackageJson.pnpm.trustPolicyExclude, [
    newFlavor,
    helperPackage,
  ])
  t.deepEqual(updatedPackageJson.pnpm.peerDependencyRules, {
    ignoreMissing: [newFlavor, helperPackage],
    allowAny: [newFlavor, helperPackage],
    allowedVersions: {
      [newFlavor]: oldFlavor,
      [helperPackage]: oldFlavor,
    },
    description: oldFlavor,
  })
  t.deepEqual(updatedPackageJson.pnpm.updateConfig, {
    ignoreDependencies: [newFlavor, helperPackage],
    tag: oldFlavor,
  })
  t.is(updatedPackageJson.pnpm.unrelated, oldFlavor)
  const rootEntry = await readFile(join(projectPath, 'index.cjs'), 'utf8')
  t.true(rootEntry.includes(newFlavor))
  t.true(rootEntry.includes(helperPackage))
  t.false(rootEntry.includes(`${newFlavor}-helper`))
})

test('dependency versions preserve matching tags and GitHub shorthands', async (t) => {
  const projectPath = join(t.context.tmpDir, 'dependency-value-selectors')
  const oldPackageName = 'original'
  const newPackageName = 'renamed'
  const oldFlavor = `${oldPackageName}-wasm32-wasip1`
  const newFlavor = `${newPackageName}-wasm32-wasip1`
  const patchLocator = `~/.yarn/patches/${oldFlavor}.patch`
  await createPackageIdentityFixture(projectPath, 'fixture', oldPackageName)
  const packageJsonPath = join(projectPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.dependencies = {
    alias: `npm:${oldFlavor}@1.0.0`,
    tag: oldFlavor,
    github: `${oldFlavor}/repo`,
    patch: `patch:${oldFlavor}@npm%3A1.0.0#${patchLocator}`,
    'patch-prefix': `patch:${oldFlavor}-helper@npm%3A1.0.0#${patchLocator}`,
    'patch-foreign': `patch:other@npm%3A1.0.0#${patchLocator}`,
  }
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  await renameProject({
    cwd: projectPath,
    packageName: newPackageName,
  })

  const updated = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.is(updated.dependencies.alias, `npm:${newFlavor}@1.0.0`)
  t.is(updated.dependencies.tag, oldFlavor)
  t.is(updated.dependencies.github, `${oldFlavor}/repo`)
  t.is(
    updated.dependencies.patch,
    `patch:${newFlavor}@npm%3A1.0.0#${patchLocator}`,
  )
  t.is(
    updated.dependencies['patch-prefix'],
    `patch:${oldFlavor}-helper@npm%3A1.0.0#${patchLocator}`,
  )
  t.is(
    updated.dependencies['patch-foreign'],
    `patch:other@npm%3A1.0.0#${patchLocator}`,
  )
})

test('unscoped package rename preserves scoped selector basenames', async (t) => {
  const projectPath = join(t.context.tmpDir, 'unscoped-selector-boundary')
  const oldPackageName = 'original'
  const newPackageName = 'renamed'
  const oldFlavor = `${oldPackageName}-wasm32-wasip1`
  await createPackageIdentityFixture(projectPath, 'fixture', oldPackageName)
  const packageJsonPath = join(projectPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.dependencies = {
    [`@other-scope/${oldFlavor}`]: '1.0.0',
    alias: `npm:@other-scope/${oldFlavor}@1.0.0`,
  }
  packageJson.resolutions = {
    [`**/@other-scope/${oldFlavor}`]: '1.0.0',
  }
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  await renameProject({
    cwd: projectPath,
    packageName: newPackageName,
  })

  const updated = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.is(updated.dependencies[`@other-scope/${oldFlavor}`], '1.0.0')
  t.is(updated.dependencies.alias, `npm:@other-scope/${oldFlavor}@1.0.0`)
  t.is(updated.resolutions[`**/@other-scope/${oldFlavor}`], '1.0.0')
})

test('rename validates requested and configured npm package names', async (t) => {
  const requestedProject = join(t.context.tmpDir, 'invalid-requested-package')
  await createFixtureProject(requestedProject, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1'],
      },
    },
    cargoPackageName: 'foo',
  })
  const requestedPackageBefore = await readFile(
    join(requestedProject, 'package.json'),
    'utf8',
  )
  await t.throwsAsync(
    renameProject({
      cwd: requestedProject,
      packageName: 'bad"name',
    }),
    { message: /Requested package name is not a valid npm package name/ },
  )
  t.is(
    await readFile(join(requestedProject, 'package.json'), 'utf8'),
    requestedPackageBefore,
  )

  const configuredProject = join(t.context.tmpDir, 'invalid-configured-package')
  await createFixtureProject(configuredProject, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: 'bad"name',
      },
    },
    cargoPackageName: 'foo',
  })
  const configuredPackageBefore = await readFile(
    join(configuredProject, 'package.json'),
    'utf8',
  )
  await t.throwsAsync(
    renameProject({
      cwd: configuredProject,
      name: 'renamed',
    }),
    { message: /Configured package name is not a valid npm package name/ },
  )
  t.is(
    await readFile(join(configuredProject, 'package.json'), 'utf8'),
    configuredPackageBefore,
  )

  await renameProject({
    cwd: requestedProject,
    packageName: '@scope/_renamed',
  })
  t.is(
    JSON.parse(await readFile(join(requestedProject, 'package.json'), 'utf8'))
      .napi.packageName,
    '@scope/_renamed',
  )
})

test('binary rename removes legacy inline and separated napi.name overrides', async (t) => {
  const inlineProject = join(t.context.tmpDir, 'legacy-inline-config')
  await createFixtureProject(inlineProject, {
    packageJson: {
      name: 'original',
      napi: {
        name: 'foo',
        packageName: '@scope/original',
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: inlineProject,
    binaryName: 'inline-renamed',
  })

  const inlinePackageJson = JSON.parse(
    await readFile(join(inlineProject, 'package.json'), 'utf8'),
  )
  t.false(Object.prototype.hasOwnProperty.call(inlinePackageJson.napi, 'name'))
  t.is(
    (await readNapiConfig(join(inlineProject, 'package.json'))).binaryName,
    'inline-renamed',
  )

  const separatedProject = join(t.context.tmpDir, 'legacy-separated-config')
  await createFixtureProject(separatedProject, {
    packageJson: {
      name: 'original',
    },
    cargoPackageName: 'foo',
    configPath: 'napi.json',
    configData: {
      name: 'foo',
      packageName: '@scope/original',
    },
  })

  await renameProject({
    cwd: separatedProject,
    configPath: 'napi.json',
    binaryName: 'separated-renamed',
  })

  const separatedConfig = JSON.parse(
    await readFile(join(separatedProject, 'napi.json'), 'utf8'),
  )
  t.false(Object.prototype.hasOwnProperty.call(separatedConfig, 'name'))
  t.is(
    (
      await readNapiConfig(
        join(separatedProject, 'package.json'),
        join(separatedProject, 'napi.json'),
      )
    ).binaryName,
    'separated-renamed',
  )
})

test('rename rejects a symlinked npm root that escapes the project', async (t) => {
  const projectPath = join(t.context.tmpDir, 'symlink-project')
  const outsideNpmPath = join(t.context.tmpDir, 'outside-npm')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1'],
      },
    },
    cargoPackageName: 'foo',
  })
  await mkdir(join(outsideNpmPath, 'wasm32-wasip1'), { recursive: true })
  await writeFile(
    join(outsideNpmPath, 'wasm32-wasip1', 'foo.wasip1.cjs'),
    'outside sentinel\n',
  )
  await symlink(
    outsideNpmPath,
    join(projectPath, 'npm'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const projectBefore = await snapshotFiles(projectPath)
  const outsideBefore = await snapshotFiles(outsideNpmPath)

  await t.throwsAsync(
    renameProject({
      cwd: projectPath,
      binaryName: 'renamed',
    }),
    {
      message:
        /Managed package paths must stay within the project or workspace boundary/,
    },
  )

  t.deepEqual(await snapshotFiles(projectPath), projectBefore)
  t.deepEqual(await snapshotFiles(outsideNpmPath), outsideBefore)
})

test('binary rename does not modify a parent repository workflow', async (t) => {
  const parentPath = join(t.context.tmpDir, 'parent-repository')
  const projectPath = join(parentPath, 'packages', 'nested-project')
  const parentWorkflowPath = join(parentPath, '.github', 'workflows', 'CI.yml')
  await mkdir(dirname(parentWorkflowPath), { recursive: true })
  await writeFile(parentWorkflowPath, 'env:\n  APP_NAME: parent-app\n')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: projectPath,
    binaryName: 'renamed',
  })

  t.is(
    await readFile(parentWorkflowPath, 'utf8'),
    'env:\n  APP_NAME: parent-app\n',
  )
})

test('rename holds filesystem reconciliation across read, plan, and commit', async (t) => {
  const projectPath = join(t.context.tmpDir, 'reconciled-rename')
  await createPackageIdentityFixture(
    projectPath,
    'fixture',
    '@old-scope/original',
  )
  const packageJsonPath = join(projectPath, 'package.json')
  let releaseBlocker!: () => void
  let markBlockerStarted!: () => void
  const blockerStarted = new Promise<void>((resolve) => {
    markBlockerStarted = resolve
  })
  const blockerRelease = new Promise<void>((resolve) => {
    releaseBlocker = resolve
  })
  const blocker = withFileSystemReconciliation(
    getPackageReconciliationRoot(projectPath),
    async () => {
      markBlockerStarted()
      await blockerRelease
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
      packageJson.description = 'written while reconciliation lock was held'
      await writeFile(
        packageJsonPath,
        `${JSON.stringify(packageJson, null, 2)}\n`,
      )
    },
  )
  await blockerStarted

  let renameSettled = false
  const pendingRename = renameProject({
    cwd: projectPath,
    packageName: '@new-scope/renamed',
  }).finally(() => {
    renameSettled = true
  })
  await delay(50)
  t.false(renameSettled)

  releaseBlocker()
  await Promise.all([blocker, pendingRename])
  t.is(
    JSON.parse(await readFile(packageJsonPath, 'utf8')).description,
    'written while reconciliation lock was held',
  )
})

test('rename acquires the workspace boundary before reading a nested package', async (t) => {
  const workspacePath = join(t.context.tmpDir, 'stale-workspace')
  const packagePath = join(workspacePath, 'packages', 'addon')
  const packageJsonPath = join(packagePath, 'package.json')
  const workerPath = join(t.context.tmpDir, 'workspace-lock-worker.mjs')
  const readyPath = join(t.context.tmpDir, 'workspace-lock-ready')
  const releasePath = join(t.context.tmpDir, 'workspace-lock-release')
  await mkdir(workspacePath, { recursive: true })
  await writeFile(
    join(workspacePath, 'package.json'),
    `${JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
  )
  await createPackageIdentityFixture(
    packagePath,
    'fixture',
    '@old-scope/original',
  )
  await move(join(packagePath, 'npm'), join(workspacePath, 'npm'))
  await writeFile(
    workerPath,
    `import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
      new URL('../../utils/misc.ts', import.meta.url).href,
    )}

const [root, packageJsonPath, readyPath, releasePath] = process.argv.slice(2)
await withFileSystemReconciliation(root, async () => {
  await writeFile(readyPath, '')
  while (!existsSync(releasePath)) await delay(10)
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.concurrentField = 'preserved'
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\\n')
})
`,
  )
  const blocker = spawnTestWorker(workerPath, [
    workspacePath,
    packageJsonPath,
    readyPath,
    releasePath,
  ])
  let workspaceAttempt:
    | Awaited<ReturnType<typeof watchForReconciliationAttempt>>
    | undefined
  let pendingRename: ReturnType<typeof renameProject> | undefined
  try {
    await withTimeout(
      Promise.race([
        waitForPath(readyPath),
        blocker.completed.then(() => {
          throw new Error('Workspace lock worker exited before becoming ready')
        }),
      ]),
      'Timed out waiting for the workspace lock worker',
    )

    workspaceAttempt = await watchForReconciliationAttempt(workspacePath)
    pendingRename = renameProject({
      cwd: workspacePath,
      packageJsonPath: join('packages', 'addon', 'package.json'),
      npmDir: 'npm',
      description: 'updated after the workspace lock',
    })
    await withTimeout(
      workspaceAttempt.attempted,
      'Rename did not attempt the workspace reconciliation lock',
    )
    await writeFile(releasePath, '')
    await Promise.all([blocker.completed, pendingRename])
  } finally {
    workspaceAttempt?.close()
    await writeFile(releasePath, '').catch(() => {})
    await blocker.terminate()
    await pendingRename?.catch(() => {})
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.is(packageJson.concurrentField, 'preserved')
  t.is(packageJson.description, 'updated after the workspace lock')
})

test('rename keeps package-to-workspace lock order used by package operations', async (t) => {
  const workspacePath = join(t.context.tmpDir, 'ordered-workspace')
  const packagePath = join(workspacePath, 'packages', 'addon')
  const packageJsonPath = join(packagePath, 'package.json')
  const workerPath = join(t.context.tmpDir, 'package-lock-worker.mjs')
  const renameWorkerPath = join(t.context.tmpDir, 'ordered-rename-worker.mjs')
  const readyPath = join(t.context.tmpDir, 'package-lock-ready')
  const probePath = join(t.context.tmpDir, 'workspace-probe-entered')
  const resultPath = join(t.context.tmpDir, 'ordered-rename-result.json')
  const widenPath = join(t.context.tmpDir, 'package-lock-widen')
  const widenedPath = join(t.context.tmpDir, 'package-lock-widened')
  await mkdir(workspacePath, { recursive: true })
  await writeFile(
    join(workspacePath, 'package.json'),
    `${JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
  )
  await createPackageIdentityFixture(
    packagePath,
    'fixture',
    '@old-scope/original',
  )
  await move(join(packagePath, 'npm'), join(workspacePath, 'npm'))
  await writeRenameProbeWorker(renameWorkerPath)
  await writeFile(
    workerPath,
    `import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
      new URL('../../utils/misc.ts', import.meta.url).href,
    )}

const [
  packageRoot,
  workspaceRoot,
  packageJsonPath,
  readyPath,
  widenPath,
  widenedPath,
] = process.argv.slice(2)
await withFileSystemReconciliation(packageRoot, async () => {
  await writeFile(readyPath, '')
  while (!existsSync(widenPath)) await delay(10)
  await withFileSystemReconciliation(workspaceRoot, async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    packageJson.orderedField = 'preserved'
    await writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + '\\n',
    )
    await writeFile(widenedPath, '')
  })
})
`,
  )
  const blocker = spawnTestWorker(workerPath, [
    packagePath,
    workspacePath,
    packageJsonPath,
    readyPath,
    widenPath,
    widenedPath,
  ])
  let renameWorker: ReturnType<typeof spawnTestWorker> | undefined
  try {
    await withTimeout(
      Promise.race([
        waitForPath(readyPath),
        blocker.completed.then(() => {
          throw new Error('Package lock worker exited before becoming ready')
        }),
      ]),
      'Timed out waiting for the package lock worker',
    )

    renameWorker = spawnTestWorker(renameWorkerPath, [
      workspacePath,
      join('packages', 'addon', 'package.json'),
      'npm',
      'updated after ordered locking',
      workspacePath,
      probePath,
      resultPath,
    ])
    await withTimeout(
      Promise.race([
        waitForPath(probePath),
        renameWorker.completed.then(() => {
          throw new Error(
            'Rename worker exited before its workspace probe entered',
          )
        }),
      ]),
      'Rename queued the workspace lock before the package lock',
    )
    await writeFile(widenPath, '')
    await withTimeout(
      waitForPath(widenedPath),
      'Package operation could not widen to the workspace lock',
    )
    await Promise.all([blocker.completed, renameWorker.completed])
  } finally {
    await writeFile(widenPath, '').catch(() => {})
    await Promise.all([blocker.terminate(), renameWorker?.terminate()])
  }

  const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
    status: string
  }
  t.is(result.status, 'fulfilled')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.is(packageJson.orderedField, 'preserved')
  t.is(packageJson.description, 'updated after ordered locking')
})

test('rename rejects workspace boundary changes after acquiring its locks', async (t) => {
  const workspacePath = join(t.context.tmpDir, 'changing-workspace')
  const packagePath = join(workspacePath, 'packages', 'addon')
  const workspaceJsonPath = join(workspacePath, 'package.json')
  const packageJsonPath = join(packagePath, 'package.json')
  const blockerPath = join(t.context.tmpDir, 'boundary-blocker.mjs')
  const renameWorkerPath = join(t.context.tmpDir, 'boundary-rename-worker.mjs')
  const readyPath = join(t.context.tmpDir, 'boundary-blocker-ready')
  const releasePath = join(t.context.tmpDir, 'boundary-blocker-release')
  const probePath = join(t.context.tmpDir, 'boundary-workspace-probe')
  const resultPath = join(t.context.tmpDir, 'boundary-rename-result.json')
  await mkdir(workspacePath, { recursive: true })
  await writeFile(
    workspaceJsonPath,
    `${JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
  )
  await createPackageIdentityFixture(
    packagePath,
    'fixture',
    '@old-scope/original',
  )
  await move(join(packagePath, 'npm'), join(workspacePath, 'npm'))
  await writeRenameProbeWorker(renameWorkerPath)
  await writeFile(
    blockerPath,
    `import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
      new URL('../../utils/misc.ts', import.meta.url).href,
    )}

const [packageRoot, readyPath, releasePath] = process.argv.slice(2)
await withFileSystemReconciliation(packageRoot, async () => {
  await writeFile(readyPath, '')
  while (!existsSync(releasePath)) await delay(10)
})
`,
  )
  const blocker = spawnTestWorker(blockerPath, [
    packagePath,
    readyPath,
    releasePath,
  ])
  let renameWorker: ReturnType<typeof spawnTestWorker> | undefined
  try {
    await withTimeout(
      Promise.race([
        waitForPath(readyPath),
        blocker.completed.then(() => {
          throw new Error('Boundary blocker exited before becoming ready')
        }),
      ]),
      'Timed out waiting for the boundary blocker',
    )
    renameWorker = spawnTestWorker(renameWorkerPath, [
      workspacePath,
      join('packages', 'addon', 'package.json'),
      'npm',
      'must not be committed',
      workspacePath,
      probePath,
      resultPath,
    ])
    await withTimeout(
      Promise.race([
        waitForPath(probePath),
        renameWorker.completed.then(() => {
          throw new Error(
            'Rename worker exited before its workspace probe entered',
          )
        }),
      ]),
      'Rename did not queue the package lock before its workspace probe',
    )
    await writeFile(
      workspaceJsonPath,
      `${JSON.stringify({ private: true }, null, 2)}\n`,
    )
    await writeFile(releasePath, '')
    await Promise.all([blocker.completed, renameWorker.completed])
  } finally {
    await writeFile(releasePath, '').catch(() => {})
    await Promise.all([blocker.terminate(), renameWorker?.terminate()])
  }

  const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
    code?: string
    message?: string
    status: string
  }
  t.is(result.status, 'rejected')
  t.is(result.code, 'ESTALE')
  t.regex(
    result.message ?? '',
    /Package reconciliation paths changed after their locks were acquired/,
  )
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.false(Object.hasOwn(packageJson, 'description'))
})

test('package manifest rewriting updates script arguments but not arbitrary text', async (t) => {
  const projectPath = join(t.context.tmpDir, 'script-references')
  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      description: 'node ./foo.wasi.cjs',
      scripts: {
        exact: 'node ./foo.wasi.cjs && node foo.wasm32-wasip1.workerd.mjs',
        quoted: 'node "./foo.wasi.cjs"',
        assignment: 'ENTRY=./foo.wasi.cjs node $ENTRY',
        package: 'node --package=@scope/original-wasm32-wasip1 ./foo.wasi.cjs',
        prefix: 'node ./foo.wasi.cjs.map',
        embedded: 'echo "node ./foo.wasi.cjs"',
      },
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
        targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: projectPath,
    binaryName: 'renamed',
    packageName: '@scope/renamed',
  })

  const packageJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
  )
  t.is(packageJson.description, 'node ./foo.wasi.cjs')
  t.is(
    packageJson.scripts.exact,
    'node ./renamed.wasi.cjs && node renamed.wasm32-wasip1.workerd.mjs',
  )
  t.is(packageJson.scripts.quoted, 'node "./renamed.wasi.cjs"')
  t.is(packageJson.scripts.assignment, 'ENTRY=./renamed.wasi.cjs node $ENTRY')
  t.is(
    packageJson.scripts.package,
    'node --package=@scope/renamed-wasm32-wasip1 ./renamed.wasi.cjs',
  )
  t.is(packageJson.scripts.prefix, 'node ./foo.wasi.cjs.map')
  t.is(packageJson.scripts.embedded, 'echo "node ./foo.wasi.cjs"')
})

test('legacy configured package names can migrate to strict names', async (t) => {
  const projectPath = join(t.context.tmpDir, 'legacy-package-migration')
  const oldPackageName = 'Legacy~Package'
  const newPackageName = 'legacy-package'
  await createPackageIdentityFixture(projectPath, 'fixture', oldPackageName)

  await renameProject({
    cwd: projectPath,
    packageName: newPackageName,
  })

  await assertPackageIdentityFixture(
    t,
    projectPath,
    'fixture',
    oldPackageName,
    'fixture',
    newPackageName,
  )

  await t.throwsAsync(
    renameProject({
      cwd: projectPath,
      packageName: oldPackageName,
    }),
    { message: /Requested package name is not a valid npm package name/ },
  )
})

test('manifest rewriting preserves own __proto__ properties', async (t) => {
  const projectPath = join(t.context.tmpDir, 'proto-manifest')
  const oldBinaryName = 'fixture'
  const newBinaryName = 'renamed'
  const oldPackageName = '@old-scope/original'
  const newPackageName = '@new-scope/renamed'
  await createPackageIdentityFixture(projectPath, oldBinaryName, oldPackageName)
  const packageJsonPath = join(projectPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  Object.defineProperty(packageJson, '__proto__', {
    configurable: true,
    enumerable: true,
    value: {
      description: `${oldPackageName}-wasm32-wasip1`,
      sentinel: true,
    },
    writable: true,
  })
  Object.defineProperty(packageJson.exports, '__proto__', {
    configurable: true,
    enumerable: true,
    value: `./${oldBinaryName}.wasm32-wasip1.workerd.mjs`,
    writable: true,
  })
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  await renameProject({
    cwd: projectPath,
    binaryName: newBinaryName,
    packageName: newPackageName,
  })

  const updated = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.true(Object.prototype.hasOwnProperty.call(updated, '__proto__'))
  t.deepEqual(Reflect.get(updated, '__proto__'), {
    description: `${oldPackageName}-wasm32-wasip1`,
    sentinel: true,
  })
  t.true(Object.prototype.hasOwnProperty.call(updated.exports, '__proto__'))
  t.is(
    Reflect.get(updated.exports, '__proto__'),
    `./${newBinaryName}.wasm32-wasip1.workerd.mjs`,
  )
  t.is(Reflect.get(Object.prototype, 'sentinel'), undefined)
})
