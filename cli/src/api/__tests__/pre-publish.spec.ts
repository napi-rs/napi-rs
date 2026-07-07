import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import ava, { type TestFn } from 'ava'

import { createWasmModuleTypeDef } from '../../utils/index.js'
import { createWasiDeferredBindingTypeDef } from '../build.js'
import { prePublish } from '../pre-publish.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const test = ava as TestFn<{ tmpDir: string }>
const MINIMAL_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
const emnapiVersion = require('emnapi/package.json').version
const wasmRuntimeVersion =
  require('../../../../wasm-runtime/package.json').version
const directBufferDependency = '^6.0.3'
const wasiRootFacadeMarkerPrefix = '// napi-rs-wasi-root-facade:'

async function createTestTempDir() {
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `pre-publish-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(tmpDir, { recursive: true })
  // Vite watches this tree below. Canonicalize aliases such as Windows 8.3
  // paths so libuv receives the same path representation as filesystem events.
  return realpathSync.native(tmpDir)
}

test.beforeEach(async (t) => {
  t.context = { tmpDir: await createTestTempDir() }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('canonicalizes temporary directories before watcher use', (t) => {
  t.is(t.context.tmpDir, realpathSync.native(t.context.tmpDir))
})

async function setupThreadlessPackage(
  tmpDir: string,
  options: {
    omitFile?: string
    omitWorkerdExport?: boolean
    rootExports?: unknown
    rootFiles?: string[] | null
    publishConfig?: Record<string, unknown>
    wasmBrowser?: {
      fs?: boolean
      buffer?: boolean
    }
  } = {},
) {
  const binaryName = 'pre-publish-wasi'
  const rootFiles = options.rootFiles ?? ['index.js', 'index.mjs', 'index.d.ts']
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      main: 'index.js',
      module: 'index.mjs',
      types: 'index.d.ts',
      ...(options.rootFiles === null ? {} : { files: rootFiles }),
      exports: options.rootExports,
      publishConfig: options.publishConfig,
      napi: {
        binaryName,
        targets: ['wasm32-wasip1'],
        ...(options.wasmBrowser
          ? { wasm: { browser: options.wasmBrowser } }
          : {}),
      },
    }),
  )
  await writeFile(
    join(tmpDir, 'index.js'),
    'module.exports = { entry: "main" }\n',
  )
  await writeFile(
    join(tmpDir, 'index.mjs'),
    'export default { entry: "module" }\n',
  )
  await writeFile(
    join(tmpDir, 'index.d.ts'),
    'export declare const rootBinding: true\n',
  )

  const packageDir = join(tmpDir, 'npm', 'wasm32-wasip1')
  await mkdir(packageDir, { recursive: true })
  const files = [
    `${binaryName}.wasm32-wasip1.wasm`,
    `${binaryName}.wasip1.cjs`,
    `${binaryName}.wasip1.d.cts`,
    `${binaryName}.wasip1-browser.js`,
    `${binaryName}.wasip1-deferred.js`,
    `${binaryName}.wasip1-deferred.d.ts`,
    `${binaryName}.wasm32-wasip1.wasm.d.ts`,
  ]
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: `${binaryName}-wasm32-wasip1`,
      version: '1.0.0',
      type: 'module',
      main: `${binaryName}.wasip1.cjs`,
      types: `${binaryName}.wasip1.d.cts`,
      browser: `${binaryName}.wasip1-browser.js`,
      files,
      dependencies: {
        '@napi-rs/wasm-runtime': `^${wasmRuntimeVersion}`,
        '@emnapi/core': emnapiVersion,
        '@emnapi/runtime': emnapiVersion,
        ...(options.wasmBrowser?.buffer === true &&
        options.wasmBrowser.fs !== true
          ? { buffer: directBufferDependency }
          : {}),
      },
      exports: {
        '.': {
          types: `./${binaryName}.wasip1.d.cts`,
          browser: `./${binaryName}.wasip1-browser.js`,
          require: `./${binaryName}.wasip1.cjs`,
          default: `./${binaryName}.wasip1.cjs`,
        },
        ...(options.omitWorkerdExport
          ? {}
          : {
              './workerd': {
                types: `./${binaryName}.wasip1-deferred.d.ts`,
                default: `./${binaryName}.wasip1-deferred.js`,
              },
            }),
        './wasm': {
          types: `./${binaryName}.wasm32-wasip1.wasm.d.ts`,
          default: `./${binaryName}.wasm32-wasip1.wasm`,
        },
        './wasm.wasm': {
          types: `./${binaryName}.wasm32-wasip1.wasm.d.ts`,
          default: `./${binaryName}.wasm32-wasip1.wasm`,
        },
        './package.json': './package.json',
      },
    }),
  )
  for (const file of files) {
    if (file !== options.omitFile) {
      await writeFile(
        join(packageDir, file),
        file.endsWith('-deferred.js')
          ? 'export const marker = "workerd-export"\n'
          : file.endsWith('-deferred.d.ts')
            ? `${createWasiDeferredBindingTypeDef(`./${binaryName}.wasip1.cjs`, true)}
export declare const marker: "workerd-export"
`
            : file.endsWith('.d.cts')
              ? 'export declare const bindingMarker: "binding-export"\n'
              : file.endsWith('.wasm.d.ts')
                ? createWasmModuleTypeDef()
                : file.endsWith('.wasm')
                  ? MINIMAL_WASM
                  : '',
      )
    }
  }
}

async function setupThreadedPackage(tmpDir: string) {
  const binaryName = 'pre-publish-wasi'
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['wasm32-wasip1-threads'],
      },
    }),
  )
  await writeFile(join(tmpDir, 'index.js'), 'module.exports = {}\n')

  const packageDir = join(tmpDir, 'npm', 'wasm32-wasi')
  await mkdir(packageDir, { recursive: true })
  const files = [
    `${binaryName}.wasm32-wasi.wasm`,
    `${binaryName}.wasi.cjs`,
    `${binaryName}.wasi.d.cts`,
    `${binaryName}.wasi-browser.js`,
    'wasi-worker.mjs',
    'wasi-worker-browser.mjs',
  ]
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: `${binaryName}-wasm32-wasi`,
      version: '1.0.0',
      type: 'module',
      main: `${binaryName}.wasi.cjs`,
      types: `${binaryName}.wasi.d.cts`,
      browser: `${binaryName}.wasi-browser.js`,
      files,
      dependencies: {
        '@napi-rs/wasm-runtime': `^${wasmRuntimeVersion}`,
        '@emnapi/core': emnapiVersion,
        '@emnapi/runtime': emnapiVersion,
      },
    }),
  )
  for (const file of files) {
    await writeFile(
      join(packageDir, file),
      file.endsWith('.wasm')
        ? MINIMAL_WASM
        : file.endsWith('.d.cts')
          ? 'export declare const bindingMarker: true\n'
          : '',
    )
  }
}

async function updateThreadlessFlavorManifest(
  tmpDir: string,
  update: (manifest: Record<string, any>) => void,
) {
  const packageJsonPath = join(tmpDir, 'npm', 'wasm32-wasip1', 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  update(packageJson)
  await writeFile(packageJsonPath, JSON.stringify(packageJson))
}

async function renameThreadlessReleaseBinary(
  tmpDir: string,
  oldBinaryName: string,
  newBinaryName: string,
) {
  const rootPackageJsonPath = join(tmpDir, 'package.json')
  const rootPackageJson = JSON.parse(
    await readFile(rootPackageJsonPath, 'utf8'),
  )
  rootPackageJson.napi.binaryName = newBinaryName
  await writeFile(rootPackageJsonPath, JSON.stringify(rootPackageJson))

  const packageDir = join(tmpDir, 'npm', 'wasm32-wasip1')
  const packageJsonPath = join(packageDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  for (const file of packageJson.files as string[]) {
    const renamedFile = file.replace(oldBinaryName, newBinaryName)
    if (renamedFile !== file) {
      await rename(join(packageDir, file), join(packageDir, renamedFile))
      if (!renamedFile.endsWith('.wasm')) {
        const contents = await readFile(join(packageDir, renamedFile), 'utf8')
        await writeFile(
          join(packageDir, renamedFile),
          contents.replaceAll(oldBinaryName, newBinaryName),
        )
      }
    }
  }
  packageJson.files = packageJson.files.map((file: string) =>
    file.replace(oldBinaryName, newBinaryName),
  )
  for (const field of ['main', 'types', 'browser']) {
    packageJson[field] = packageJson[field].replace(
      oldBinaryName,
      newBinaryName,
    )
  }
  packageJson.exports = replaceStrings(
    packageJson.exports,
    oldBinaryName,
    newBinaryName,
  )
  await writeFile(packageJsonPath, JSON.stringify(packageJson))
}

function replaceStrings(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') {
    return value.replaceAll(from, to)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceStrings(entry, from, to))
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      replaceStrings(entry, from, to),
    ]),
  )
}

function resolvePnpmCli() {
  const launchers =
    process.platform === 'win32'
      ? ['pnpm.cmd', 'corepack.cmd']
      : ['pnpm', 'corepack']

  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    for (const launcher of launchers) {
      const launcherPath = join(pathEntry, launcher)
      if (!existsSync(launcherPath)) {
        continue
      }
      const resolvedLauncherPath = realpathSync(launcherPath)
      if (resolvedLauncherPath.endsWith('pnpm.js')) {
        return resolvedLauncherPath
      }
      const siblingPnpm = join(dirname(resolvedLauncherPath), 'pnpm.js')
      if (existsSync(siblingPnpm)) {
        return siblingPnpm
      }
      for (const packageName of ['pnpm', 'corepack']) {
        try {
          const packageJsonPath = require.resolve(
            `${packageName}/package.json`,
            {
              paths: [
                dirname(resolvedLauncherPath),
                join(dirname(resolvedLauncherPath), '..', 'lib'),
                dirname(process.execPath),
                join(dirname(process.execPath), '..', 'lib'),
              ],
            },
          )
          const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
          const bin =
            typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
          if (typeof bin === 'string') {
            return join(dirname(packageJsonPath), bin)
          }
        } catch {}
      }
    }
  }

  throw new Error('Could not resolve the pnpm Corepack entrypoint from PATH')
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

function resolveNpmCli() {
  const bundledNpmCli = resolveNpmCliFrom(dirname(process.execPath))
  if (bundledNpmCli) {
    return bundledNpmCli
  }

  const npmLauncher = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
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

async function packWithNpm(npmCli: string, cwd: string, destination: string) {
  const before = new Set(await readdir(destination))
  await execFileAsync(
    process.execPath,
    [npmCli, 'pack', '--ignore-scripts', '--pack-destination', destination],
    { cwd },
  )
  const tarball = (await readdir(destination)).find(
    (file) => file.endsWith('.tgz') && !before.has(file),
  )
  if (!tarball) {
    throw new Error(`npm pack did not create a tarball for ${cwd}`)
  }
  return join(destination, tarball)
}

function fileDependency(from: string, path: string) {
  return `file:${relative(from, path).split(sep).join('/')}`
}

async function createLocalPackage(
  rootDir: string,
  name: string,
  version: string,
) {
  const packageDir = join(
    rootDir,
    'local-dependencies',
    name.replaceAll('/', '__'),
  )
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name,
      version,
      main: 'index.js',
      exports: './index.js',
    }),
  )
  await writeFile(join(packageDir, 'index.js'), 'module.exports = {}\n')
  return packageDir
}

test('pre-publish rejects a missing deferred workerd entry', async (t) => {
  const deferred = 'pre-publish-wasi.wasip1-deferred.js'
  await setupThreadlessPackage(t.context.tmpDir, { omitFile: deferred })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, new RegExp(`missing ${deferred}`))
})

test('pre-publish requires the threadless workerd export', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, { omitWorkerdExport: true })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /stale or invalid \.\/workerd export/)
})

test('pre-publish validates a complete threadless package in dry-run mode', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)

  await t.notThrowsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
})

test('pre-publish requires module type for WASI packages', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await updateThreadlessFlavorManifest(t.context.tmpDir, (manifest) => {
    manifest.type = 'commonjs'
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /must declare type module/)
})

test('pre-publish rejects restrictive WASI cpu metadata', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await updateThreadlessFlavorManifest(t.context.tmpDir, (manifest) => {
    manifest.cpu = ['wasm32']
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /must omit cpu/)
})

test('pre-publish rejects restrictive WASI os metadata', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await updateThreadlessFlavorManifest(t.context.tmpDir, (manifest) => {
    manifest.os = ['darwin']
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /must omit os/)
})

test('pre-publish rejects exports that override threaded WASI entries', async (t) => {
  await setupThreadedPackage(t.context.tmpDir)
  const manifestPath = join(
    t.context.tmpDir,
    'npm',
    'wasm32-wasi',
    'package.json',
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.exports = {
    '.': {
      default: `./pre-publish-wasi.wasi-browser.js`,
    },
  }
  await writeFile(manifestPath, JSON.stringify(manifest))

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /must omit exports for its threaded WASI/)
})

for (const dependency of [
  '@napi-rs/wasm-runtime',
  '@emnapi/core',
  '@emnapi/runtime',
]) {
  test(`pre-publish requires WASI dependency ${dependency}`, async (t) => {
    await setupThreadlessPackage(t.context.tmpDir)
    await updateThreadlessFlavorManifest(t.context.tmpDir, (manifest) => {
      delete manifest.dependencies[dependency]
    })

    const error = await t.throwsAsync(() =>
      prePublish({
        cwd: t.context.tmpDir,
        dryRun: true,
        ghRelease: false,
        tagStyle: 'npm',
      }),
    )
    t.regex(error.message, new RegExp(`must declare dependency ${dependency}`))
  })
}

test('pre-publish rejects non-release wasm runtime dependency ranges', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await updateThreadlessFlavorManifest(t.context.tmpDir, (manifest) => {
    manifest.dependencies['@napi-rs/wasm-runtime'] = 'workspace:*'
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /invalid @napi-rs\/wasm-runtime dependency/)
})

test('pre-publish requires emnapi dependency versions to match', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await updateThreadlessFlavorManifest(t.context.tmpDir, (manifest) => {
    manifest.dependencies['@emnapi/runtime'] = '0.0.0'
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /must declare @emnapi\/runtime/)
  t.regex(error.message, /found 0\.0\.0/)
})

test('pre-publish requires buffer for a direct browser import', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    wasmBrowser: { buffer: true },
  })
  await updateThreadlessFlavorManifest(t.context.tmpDir, (manifest) => {
    delete manifest.dependencies.buffer
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /must declare dependency buffer/)
})

test('pre-publish does not require direct buffer when browser fs provides it', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    wasmBrowser: { fs: true, buffer: true },
  })

  await t.notThrowsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
})

test('pre-publish rejects a missing root main entry in dry-run mode', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await rm(join(t.context.tmpDir, 'index.js'))

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.is(error.message, 'Root release package is incomplete: missing index.js')
})

test('pre-publish validates condition-only root exports in dry-run mode', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: {
      browser: './browser.js',
      default: './index.js',
    },
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.is(error.message, 'Root release package is incomplete: missing browser.js')
})

test('pre-publish validates publishConfig root exports in dry-run mode', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    publishConfig: {
      exports: {
        '.': {
          browser: './publish-browser.js',
          default: './index.js',
        },
        './feature': './missing-feature.js',
      },
    },
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.is(
    error.message,
    'Root release package is incomplete: missing publish-browser.js',
  )
})

test('pre-publish validates exact subpath exports in dry-run mode', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: {
      '.': './index.js',
      './feature': './missing-feature.js',
    },
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.is(
    error.message,
    'Root release package is incomplete: missing missing-feature.js',
  )
})

test('pre-publish validates publishConfig exports in dry-run mode', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    publishConfig: {
      exports: {
        '.': './index.js',
        './feature': './missing-feature.js',
      },
    },
  })

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.is(
    error.message,
    'Root release package is incomplete: missing missing-feature.js',
  )
})

test('pre-publish rejects a stale flavor package name', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const manifestPath = join(
    t.context.tmpDir,
    'npm',
    'wasm32-wasip1',
    'package.json',
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.name = 'stale-package-wasm32-wasip1'
  await writeFile(manifestPath, JSON.stringify(manifest))

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /stale package name/)
  t.regex(error.message, /expected pre-publish-wasi-wasm32-wasip1/)
})

test('pre-publish rejects stale flavor entry references', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const manifestPath = join(
    t.context.tmpDir,
    'npm',
    'wasm32-wasip1',
    'package.json',
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.main = 'old-binary.wasip1.cjs'
  await writeFile(manifestPath, JSON.stringify(manifest))

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /stale main entry old-binary\.wasip1\.cjs/)
})

test('pre-publish requires the Wasm artifact in the flavor tarball', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const manifestPath = join(
    t.context.tmpDir,
    'npm',
    'wasm32-wasip1',
    'package.json',
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.files = manifest.files.filter(
    (file: string) => !file.endsWith('.wasm'),
  )
  await writeFile(manifestPath, JSON.stringify(manifest))

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /does not publish required files/)
  t.regex(error.message, /pre-publish-wasi\.wasm32-wasip1\.wasm/)
})

test('pre-publish rejects a stale public Wasm export target', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const manifestPath = join(
    t.context.tmpDir,
    'npm',
    'wasm32-wasip1',
    'package.json',
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.exports['./wasm'].default = './old-binary.wasm32-wasip1.wasm'
  await writeFile(manifestPath, JSON.stringify(manifest))

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /stale or invalid \.\/wasm export/)
})

test('pre-publish synthesizes Node-safe legacy root exports', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootFiles: [
      'dist/index.js',
      'legacy-module.js',
      'index.d.ts',
      'feature.js',
      'nested/package.json',
      'nested/custom.cjs',
      'nested/index.js',
    ],
  })
  const packageJsonPath = join(t.context.tmpDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.main = 'dist'
  packageJson.module = 'legacy-module.js'
  await writeFile(packageJsonPath, JSON.stringify(packageJson))
  await mkdir(join(t.context.tmpDir, 'dist'))
  await writeFile(
    join(t.context.tmpDir, 'dist', 'index.js'),
    'module.exports = { entry: "directory-main" }\n',
  )
  await writeFile(
    join(t.context.tmpDir, 'legacy-module.js'),
    'export default { entry: "legacy-module" }\n',
  )
  await writeFile(
    join(t.context.tmpDir, 'feature.js'),
    'module.exports = { entry: "deep-import" }\n',
  )
  await mkdir(join(t.context.tmpDir, 'nested'))
  await writeFile(
    join(t.context.tmpDir, 'nested', 'package.json'),
    JSON.stringify({ main: 'custom.cjs' }),
  )
  await writeFile(
    join(t.context.tmpDir, 'nested', 'custom.cjs'),
    'module.exports = { entry: "nested-main" }\n',
  )
  await writeFile(
    join(t.context.tmpDir, 'nested', 'index.js'),
    'module.exports = { entry: "nested-index" }\n',
  )

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const publishedManifest = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.deepEqual(publishedManifest.exports['.'], {
    types: './index.d.ts',
    module: './legacy-module.js',
    require: './dist/index.js',
    node: './dist/index.js',
    default: './dist/index.js',
  })
  t.is(publishedManifest.exports['./feature'], './feature.js')
  t.is(publishedManifest.exports['./dist'], './dist/index.js')
  t.is(publishedManifest.exports['./nested'], './nested/custom.cjs')

  const consumerDir = join(t.context.tmpDir, 'legacy-consumer')
  await mkdir(join(consumerDir, 'node_modules'), { recursive: true })
  await symlink(
    t.context.tmpDir,
    join(consumerDir, 'node_modules', 'pre-publish-wasi'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const result = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import root from 'pre-publish-wasi'; import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); process.stdout.write(JSON.stringify([root, require('pre-publish-wasi/feature'), require('pre-publish-wasi/dist'), require('pre-publish-wasi/nested')]))`,
    ],
    { cwd: consumerDir },
  )
  t.deepEqual(JSON.parse(result.stdout), [
    { entry: 'directory-main' },
    { entry: 'deep-import' },
    { entry: 'directory-main' },
    { entry: 'nested-main' },
  ])
})

test('pre-publish does not require the legacy default when exports define the root', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: './entry.js',
  })
  const packageJsonPath = join(t.context.tmpDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  delete packageJson.main
  delete packageJson.module
  delete packageJson.types
  packageJson.files = ['entry.js']
  await writeFile(packageJsonPath, JSON.stringify(packageJson))
  await writeFile(join(t.context.tmpDir, 'entry.js'), 'module.exports = 1\n')
  await Promise.all(
    ['index.js', 'index.mjs', 'index.d.ts'].map((file) =>
      rm(join(t.context.tmpDir, file)),
    ),
  )

  await t.notThrowsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
})

test('pre-publish does not impose WASI root validation on native packages', async (t) => {
  const binaryName = 'pre-publish-native'
  await writeFile(
    join(t.context.tmpDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '1.0.0',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }),
  )
  const packageDir = join(t.context.tmpDir, 'npm', 'linux-x64-gnu')
  await mkdir(packageDir, { recursive: true })
  const artifact = `${binaryName}.linux-x64-gnu.node`
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: `${binaryName}-linux-x64-gnu`,
      version: '1.0.0',
      main: artifact,
      files: [artifact],
    }),
  )
  await writeFile(join(packageDir, artifact), '')

  await t.notThrowsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
})

test('pre-publish adds root WASI facades without replacing existing exports', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: {
      '.': './index.js',
      './feature': './feature.js',
    },
    rootFiles: ['index.js', 'index.mjs', 'index.d.ts', 'feature.js'],
  })
  await writeFile(join(t.context.tmpDir, 'feature.js'), 'module.exports = 1\n')

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const packageJson = JSON.parse(
    await readFile(join(t.context.tmpDir, 'package.json'), 'utf8'),
  )
  t.is(packageJson.exports['.'], './index.js')
  t.is(packageJson.exports['./feature'], './feature.js')
  t.deepEqual(packageJson.exports['./workerd'], {
    types: './pre-publish-wasi.wasm32-wasip1.workerd.d.mts',
    default: './pre-publish-wasi.wasm32-wasip1.workerd.mjs',
  })
  t.deepEqual(packageJson.exports['./wasm'], {
    types: './pre-publish-wasi.wasm32-wasip1.wasm.d.mts',
    default: './pre-publish-wasi.wasm32-wasip1.wasm',
  })
  t.deepEqual(packageJson.exports['./wasm.wasm'], {
    types: './pre-publish-wasi.wasm32-wasip1.wasm.d.mts',
    default: './pre-publish-wasi.wasm32-wasip1.wasm',
  })
  t.true(
    packageJson.files.includes('pre-publish-wasi.wasm32-wasip1.workerd.mjs'),
  )
  t.true(
    packageJson.files.includes('pre-publish-wasi.wasm32-wasip1.workerd.d.mts'),
  )
  t.true(packageJson.files.includes('pre-publish-wasi.wasm32-wasip1.wasm'))
  t.true(
    packageJson.files.includes('pre-publish-wasi.wasm32-wasip1.wasm.d.mts'),
  )
  const workerdFacade = await readFile(
    join(t.context.tmpDir, 'pre-publish-wasi.wasm32-wasip1.workerd.mjs'),
    'utf8',
  )
  const workerdTypeFacade = await readFile(
    join(t.context.tmpDir, 'pre-publish-wasi.wasm32-wasip1.workerd.d.mts'),
    'utf8',
  )
  const markerLine = workerdFacade.slice(0, workerdFacade.indexOf('\n'))
  const marker = JSON.parse(markerLine.slice(wasiRootFacadeMarkerPrefix.length))
  t.deepEqual(marker, {
    version: 1,
    flavorPackage: 'pre-publish-wasi-wasm32-wasip1',
    wasmSha256: createHash('sha256').update(MINIMAL_WASM).digest('hex'),
  })
  t.is(
    workerdFacade,
    `${markerLine}\nexport * from "pre-publish-wasi-wasm32-wasip1/workerd"\n`,
  )
  t.is(workerdTypeFacade, workerdFacade)
  t.deepEqual(
    await readFile(
      join(t.context.tmpDir, 'pre-publish-wasi.wasm32-wasip1.wasm'),
    ),
    MINIMAL_WASM,
  )
  t.is(
    await readFile(
      join(t.context.tmpDir, 'pre-publish-wasi.wasm32-wasip1.wasm.d.mts'),
      'utf8',
    ),
    `${markerLine}\n${createWasmModuleTypeDef()}`,
  )
})

test('pre-publish accepts the root WASI artifact copied by artifacts', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const rootArtifact = join(
    t.context.tmpDir,
    'pre-publish-wasi.wasm32-wasip1.wasm',
  )
  await writeFile(rootArtifact, MINIMAL_WASM)

  await t.notThrowsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: false,
      ghRelease: false,
      tagStyle: 'npm',
      skipOptionalPublish: true,
    }),
  )

  t.deepEqual(await readFile(rootArtifact), MINIMAL_WASM)
})

test('pre-publish rejects a conflicting root WASI artifact', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const rootArtifact = join(
    t.context.tmpDir,
    'pre-publish-wasi.wasm32-wasip1.wasm',
  )
  await writeFile(rootArtifact, 'user-owned wasm')

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )

  t.regex(error.message, /path already exists and is not owned/)
  t.is(await readFile(rootArtifact, 'utf8'), 'user-owned wasm')
})

test('pre-publish rejects exact-shaped user-owned root facades without mutation', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const customFacades = {
    'pre-publish-wasi.wasm32-wasip1.workerd.mjs':
      'export const userWorkerd = true\n',
    'pre-publish-wasi.wasm32-wasip1.workerd.d.mts':
      'export declare const userWorkerd: true\n',
    'pre-publish-wasi.wasm32-wasip1.wasm': 'user-owned wasm',
    'pre-publish-wasi.wasm32-wasip1.wasm.d.mts':
      'declare const userWasm: unique symbol\nexport default userWasm\n',
  }
  await Promise.all(
    Object.entries(customFacades).map(([file, contents]) =>
      writeFile(join(t.context.tmpDir, file), contents),
    ),
  )
  const packageJsonPath = join(t.context.tmpDir, 'package.json')
  const packageJsonBefore = await readFile(packageJsonPath, 'utf8')

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )

  t.regex(error.message, /path already exists and is not owned/)
  t.is(await readFile(packageJsonPath, 'utf8'), packageJsonBefore)
  for (const [file, contents] of Object.entries(customFacades)) {
    t.is(await readFile(join(t.context.tmpDir, file), 'utf8'), contents)
  }
})

test('pre-publish preserves exact-shaped user-owned root facades when the target is removed', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const customFacades = {
    'pre-publish-wasi.wasm32-wasip1.workerd.mjs':
      'export const userWorkerd = true\n',
    'pre-publish-wasi.wasm32-wasip1.workerd.d.mts':
      'export declare const userWorkerd: true\n',
    'pre-publish-wasi.wasm32-wasip1.wasm': 'user-owned wasm',
    'pre-publish-wasi.wasm32-wasip1.wasm.d.mts':
      'declare const userWasm: unique symbol\nexport default userWasm\n',
  }
  await Promise.all(
    Object.entries(customFacades).map(([file, contents]) =>
      writeFile(join(t.context.tmpDir, file), contents),
    ),
  )
  const packageJsonPath = join(t.context.tmpDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const facadeExports = {
    workerd: packageJson.exports['./workerd'],
    wasm: packageJson.exports['./wasm'],
    wasmExtension: packageJson.exports['./wasm.wasm'],
  }
  packageJson.napi.targets = []
  await writeFile(packageJsonPath, JSON.stringify(packageJson))

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const preservedPackageJson = JSON.parse(
    await readFile(packageJsonPath, 'utf8'),
  )
  t.deepEqual(preservedPackageJson.exports['./workerd'], facadeExports.workerd)
  t.deepEqual(preservedPackageJson.exports['./wasm'], facadeExports.wasm)
  t.deepEqual(
    preservedPackageJson.exports['./wasm.wasm'],
    facadeExports.wasmExtension,
  )
  for (const [file, contents] of Object.entries(customFacades)) {
    t.true(preservedPackageJson.files.includes(file))
    t.is(await readFile(join(t.context.tmpDir, file), 'utf8'), contents)
  }
})

test('pre-publish migrates legacy unmarked root facades', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const textFacades = [
    'pre-publish-wasi.wasm32-wasip1.workerd.mjs',
    'pre-publish-wasi.wasm32-wasip1.workerd.d.mts',
    'pre-publish-wasi.wasm32-wasip1.wasm.d.mts',
  ]
  for (const file of textFacades) {
    const contents = await readFile(join(t.context.tmpDir, file), 'utf8')
    await writeFile(
      join(t.context.tmpDir, file),
      contents.slice(contents.indexOf('\n') + 1),
    )
  }

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const migratedFacades = await Promise.all(
    textFacades.map((file) => readFile(join(t.context.tmpDir, file), 'utf8')),
  )
  const markerLines = migratedFacades.map((contents) =>
    contents.slice(0, contents.indexOf('\n')),
  )
  t.true(
    markerLines.every((line) => line.startsWith(wasiRootFacadeMarkerPrefix)),
  )
  t.true(markerLines.every((line) => line === markerLines[0]))
})

test('pre-publish removes managed root facades when the threadless target is removed', async (t) => {
  const publishConfigExports = {
    import: './index.mjs',
    default: './index.js',
  }
  await setupThreadlessPackage(t.context.tmpDir, {
    publishConfig: {
      access: 'public',
      exports: publishConfigExports,
    },
  })
  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const packageJsonPath = join(t.context.tmpDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.napi.targets = []
  packageJson.optionalDependencies['user-owned-optional'] = '^1.0.0'
  await writeFile(packageJsonPath, JSON.stringify(packageJson))

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const reconciledPackageJson = JSON.parse(
    await readFile(packageJsonPath, 'utf8'),
  )
  t.deepEqual(reconciledPackageJson.exports, publishConfigExports)
  t.deepEqual(reconciledPackageJson.publishConfig.exports, publishConfigExports)
  t.deepEqual(reconciledPackageJson.files, [
    'index.js',
    'index.mjs',
    'index.d.ts',
  ])
  t.deepEqual(reconciledPackageJson.optionalDependencies, {
    'user-owned-optional': '^1.0.0',
  })
  for (const file of [
    'pre-publish-wasi.wasm32-wasip1.workerd.mjs',
    'pre-publish-wasi.wasm32-wasip1.workerd.d.mts',
    'pre-publish-wasi.wasm32-wasip1.wasm',
    'pre-publish-wasi.wasm32-wasip1.wasm.d.mts',
  ]) {
    t.false(existsSync(join(t.context.tmpDir, file)), `${file} must be removed`)
  }
})

test('pre-publish removes synthesized legacy aliases with the root facades', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootFiles: ['index.js', 'index.mjs', 'index.d.ts', 'feature.js'],
  })
  await writeFile(join(t.context.tmpDir, 'feature.js'), 'module.exports = 1\n')
  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const packageJsonPath = join(t.context.tmpDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  t.is(packageJson.exports['./feature'], './feature.js')
  packageJson.napi.targets = []
  await writeFile(packageJsonPath, JSON.stringify(packageJson))

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const reconciledPackageJson = JSON.parse(
    await readFile(packageJsonPath, 'utf8'),
  )
  t.false(Object.hasOwn(reconciledPackageJson, 'exports'))
})

test('pre-publish replaces managed root facades when binaryName changes', async (t) => {
  const oldBinaryName = 'pre-publish-wasi'
  const newBinaryName = 'pre-publish-renamed'
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: {
      '.': './index.js',
      './feature': './feature.js',
    },
    rootFiles: ['index.js', 'index.mjs', 'index.d.ts', 'feature.js'],
  })
  await writeFile(join(t.context.tmpDir, 'feature.js'), 'module.exports = 1\n')
  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })
  await renameThreadlessReleaseBinary(
    t.context.tmpDir,
    oldBinaryName,
    newBinaryName,
  )

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const packageJson = JSON.parse(
    await readFile(join(t.context.tmpDir, 'package.json'), 'utf8'),
  )
  t.is(packageJson.exports['.'], './index.js')
  t.is(packageJson.exports['./feature'], './feature.js')
  t.deepEqual(packageJson.exports['./workerd'], {
    types: `./${newBinaryName}.wasm32-wasip1.workerd.d.mts`,
    default: `./${newBinaryName}.wasm32-wasip1.workerd.mjs`,
  })
  t.deepEqual(packageJson.exports['./wasm'], {
    types: `./${newBinaryName}.wasm32-wasip1.wasm.d.mts`,
    default: `./${newBinaryName}.wasm32-wasip1.wasm`,
  })
  for (const suffix of ['workerd.mjs', 'workerd.d.mts', 'wasm', 'wasm.d.mts']) {
    const oldFile = `${oldBinaryName}.wasm32-wasip1.${suffix}`
    const newFile = `${newBinaryName}.wasm32-wasip1.${suffix}`
    t.false(packageJson.files.includes(oldFile))
    t.true(packageJson.files.includes(newFile))
    t.false(existsSync(join(t.context.tmpDir, oldFile)))
    t.true(existsSync(join(t.context.tmpDir, newFile)))
  }
})

test('pre-publish does not overwrite canonical root filenames', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const canonicalFiles = {
    'workerd.mjs': 'user workerd module\n',
    'workerd.d.mts': 'export type UserWorkerd = true\n',
    'wasm.wasm': 'user wasm bytes',
  }
  await Promise.all(
    Object.entries(canonicalFiles).map(([file, content]) =>
      writeFile(join(t.context.tmpDir, file), content),
    ),
  )

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  for (const [file, content] of Object.entries(canonicalFiles)) {
    t.is(await readFile(join(t.context.tmpDir, file), 'utf8'), content)
  }
})

for (const subpath of ['./workerd', './wasm', './wasm.wasm']) {
  test(`pre-publish rejects an existing ${subpath} root export`, async (t) => {
    await setupThreadlessPackage(t.context.tmpDir, {
      rootExports: {
        '.': './index.js',
        [subpath]: './user-owned.js',
      },
    })

    const error = await t.throwsAsync(() =>
      prePublish({
        cwd: t.context.tmpDir,
        dryRun: true,
        ghRelease: false,
        tagStyle: 'npm',
      }),
    )
    t.true(error.message.includes(subpath))
    t.regex(error.message, /already defines that subpath/)
  })
}

test('pre-publish rejects unowned generated facade filenames', async (t) => {
  const generatedFiles = [
    'pre-publish-wasi.wasm32-wasip1.workerd.mjs',
    'pre-publish-wasi.wasm32-wasip1.workerd.d.mts',
    'pre-publish-wasi.wasm32-wasip1.wasm',
    'pre-publish-wasi.wasm32-wasip1.wasm.d.mts',
  ]
  await setupThreadlessPackage(t.context.tmpDir, {
    rootFiles: ['index.js', 'index.mjs', 'index.d.ts', ...generatedFiles],
  })
  await Promise.all(
    generatedFiles.map((file) =>
      writeFile(join(t.context.tmpDir, file), `user-owned ${file}\n`),
    ),
  )

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /path already exists and is not owned/)
  for (const file of generatedFiles) {
    t.is(
      await readFile(join(t.context.tmpDir, file), 'utf8'),
      `user-owned ${file}\n`,
    )
  }
})

test('pre-publish preflights facade conflicts before updating versions', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: {
      '.': './index.js',
      './workerd': './user-owned.js',
    },
  })
  const flavorManifestPath = join(
    t.context.tmpDir,
    'npm',
    'wasm32-wasip1',
    'package.json',
  )
  const flavorManifest = JSON.parse(await readFile(flavorManifestPath, 'utf8'))
  flavorManifest.version = '0.0.0-unpublished'
  await writeFile(flavorManifestPath, JSON.stringify(flavorManifest))

  await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: false,
      ghRelease: false,
      tagStyle: 'npm',
      skipOptionalPublish: true,
    }),
  )
  const unchangedManifest = JSON.parse(
    await readFile(flavorManifestPath, 'utf8'),
  )
  t.is(unchangedManifest.version, '0.0.0-unpublished')
})

test('pre-publish rejects root facades omitted by npm pack', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, { rootFiles: null })
  await writeFile(
    join(t.context.tmpDir, '.npmignore'),
    '*.wasm\n*.wasm.d.mts\n*.workerd.mjs\n*.workerd.d.mts\n',
  )

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: false,
      ghRelease: false,
      tagStyle: 'npm',
      skipOptionalPublish: true,
    }),
  )
  t.regex(error.message, /paths omitted by npm pack/)
  t.regex(error.message, /package\.json "files".*\.npmignore/)
})

test('pre-publish rejects exported directories omitted by npm pack', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: {
      '.': './index.js',
      './feature': './dist',
    },
    rootFiles: null,
  })
  await mkdir(join(t.context.tmpDir, 'dist'))
  await writeFile(join(t.context.tmpDir, 'dist', 'index.js'), 'export {}\n')
  await writeFile(join(t.context.tmpDir, '.npmignore'), 'dist/\n')

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: false,
      ghRelease: false,
      tagStyle: 'npm',
      skipOptionalPublish: true,
    }),
  )
  t.regex(error.message, /paths omitted by npm pack: dist/)
})

test('pre-publish accepts root facades in the npm packlist without a files allowlist', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir, { rootFiles: null })

  await t.notThrowsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: false,
      ghRelease: false,
      tagStyle: 'npm',
      skipOptionalPublish: true,
    }),
  )

  const packageJson = JSON.parse(
    await readFile(join(t.context.tmpDir, 'package.json'), 'utf8'),
  )
  t.false(Object.hasOwn(packageJson, 'files'))
})

test('pre-publish wraps a condition-only root export before adding WASI subpaths', async (t) => {
  const rootExport = {
    browser: './browser.js',
    default: './index.js',
  }
  await setupThreadlessPackage(t.context.tmpDir, {
    rootExports: rootExport,
    rootFiles: ['index.js', 'index.mjs', 'index.d.ts', 'browser.js'],
  })
  await writeFile(join(t.context.tmpDir, 'browser.js'), 'export default {}\n')

  await prePublish({
    cwd: t.context.tmpDir,
    dryRun: false,
    ghRelease: false,
    tagStyle: 'npm',
    skipOptionalPublish: true,
  })

  const packageJson = JSON.parse(
    await readFile(join(t.context.tmpDir, 'package.json'), 'utf8'),
  )
  t.deepEqual(packageJson.exports['.'], rootExport)
  t.false(Object.hasOwn(packageJson.exports, 'browser'))
  t.truthy(packageJson.exports['./workerd'])
})

test.serial(
  'root package resolves workerd, wasm, types, and Vite SSR with pnpm isolation',
  async (t) => {
    const publishExports = {
      '.': {
        types: './index.d.ts',
        import: './index.mjs',
        require: './index.js',
        default: './index.js',
      },
      './feature': './index.js',
    }
    await setupThreadlessPackage(t.context.tmpDir, {
      publishConfig: {
        access: 'public',
        exports: publishExports,
      },
    })
    await prePublish({
      cwd: t.context.tmpDir,
      dryRun: false,
      ghRelease: false,
      tagStyle: 'npm',
      skipOptionalPublish: true,
    })

    const sourceManifest = JSON.parse(
      await readFile(join(t.context.tmpDir, 'package.json'), 'utf8'),
    )
    t.is(sourceManifest.publishConfig.access, 'public')
    t.deepEqual(sourceManifest.exports['.'], publishExports['.'])
    t.is(sourceManifest.exports['./feature'], publishExports['./feature'])
    t.deepEqual(sourceManifest.publishConfig.exports['.'], publishExports['.'])
    t.is(
      sourceManifest.publishConfig.exports['./feature'],
      publishExports['./feature'],
    )
    for (const subpath of ['./workerd', './wasm', './wasm.wasm']) {
      t.deepEqual(
        sourceManifest.publishConfig.exports[subpath],
        sourceManifest.exports[subpath],
      )
    }

    const pnpmCli = resolvePnpmCli()
    const npmCli = resolveNpmCli()
    const flavorName = 'pre-publish-wasi-wasm32-wasip1'
    const flavorDir = join(t.context.tmpDir, 'npm', 'wasm32-wasip1')
    const flavorTarball = await packWithNpm(npmCli, flavorDir, t.context.tmpDir)
    const rootTarball = await packWithNpm(
      npmCli,
      t.context.tmpDir,
      t.context.tmpDir,
    )

    const consumerDir = join(t.context.tmpDir, 'consumer')
    await mkdir(consumerDir)
    await writeFile(
      join(consumerDir, 'package.json'),
      JSON.stringify({
        name: 'root-only-consumer',
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.10.0',
        dependencies: {
          'pre-publish-wasi': fileDependency(consumerDir, rootTarball),
        },
      }),
    )
    const localDependencies = await Promise.all([
      createLocalPackage(
        t.context.tmpDir,
        '@napi-rs/wasm-runtime',
        wasmRuntimeVersion,
      ),
      createLocalPackage(t.context.tmpDir, '@emnapi/core', emnapiVersion),
      createLocalPackage(t.context.tmpDir, '@emnapi/runtime', emnapiVersion),
    ])
    await writeFile(
      join(consumerDir, 'pnpm-workspace.yaml'),
      `overrides:
  ${JSON.stringify(flavorName)}: ${JSON.stringify(fileDependency(consumerDir, flavorTarball))}
  ${JSON.stringify('@napi-rs/wasm-runtime')}: ${JSON.stringify(fileDependency(consumerDir, localDependencies[0]))}
  ${JSON.stringify('@emnapi/core')}: ${JSON.stringify(fileDependency(consumerDir, localDependencies[1]))}
  ${JSON.stringify('@emnapi/runtime')}: ${JSON.stringify(fileDependency(consumerDir, localDependencies[2]))}
`,
    )
    await execFileAsync(
      process.execPath,
      [
        pnpmCli,
        'install',
        '--ignore-scripts',
        '--offline',
        '--config.node-linker=isolated',
      ],
      {
        cwd: consumerDir,
        env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
      },
    )

    const installedRootDir = realpathSync(
      join(consumerDir, 'node_modules', 'pre-publish-wasi'),
    )
    const installedManifest = JSON.parse(
      await readFile(join(installedRootDir, 'package.json'), 'utf8'),
    )
    t.deepEqual(installedManifest.exports['.'], publishExports['.'])
    t.is(installedManifest.exports['./feature'], publishExports['./feature'])
    for (const subpath of ['./workerd', './wasm', './wasm.wasm']) {
      t.deepEqual(
        installedManifest.exports[subpath],
        sourceManifest.exports[subpath],
      )
    }
    for (const generatedFile of [
      'pre-publish-wasi.wasm32-wasip1.workerd.mjs',
      'pre-publish-wasi.wasm32-wasip1.workerd.d.mts',
      'pre-publish-wasi.wasm32-wasip1.wasm',
      'pre-publish-wasi.wasm32-wasip1.wasm.d.mts',
    ]) {
      t.true(
        existsSync(join(installedRootDir, generatedFile)),
        `${generatedFile} must survive root package packing`,
      )
    }

    t.false(
      existsSync(join(consumerDir, 'node_modules', flavorName)),
      'the flavor package must remain transitive rather than being hoisted',
    )
    const runtimeResult = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import root from 'pre-publish-wasi'; import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module'; import { marker } from 'pre-publish-wasi/workerd'; const require = createRequire(import.meta.url); const feature = require('pre-publish-wasi/feature'); const wasm = readFileSync(require.resolve('pre-publish-wasi/wasm.wasm')).toString('hex'); process.stdout.write(JSON.stringify({ marker, wasm, root, feature }))`,
      ],
      { cwd: consumerDir },
    )
    t.deepEqual(JSON.parse(runtimeResult.stdout), {
      marker: 'workerd-export',
      wasm: MINIMAL_WASM.toString('hex'),
      root: { entry: 'module' },
      feature: { entry: 'main' },
    })

    const manualCompileResult = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const wasmModule = await WebAssembly.compile(readFileSync(require.resolve('pre-publish-wasi/wasm.wasm'))); process.stdout.write(String(wasmModule instanceof WebAssembly.Module))`,
      ],
      { cwd: consumerDir },
    )
    t.is(manualCompileResult.stdout, 'true')

    if (Number(process.versions.node.split('.')[0]) >= 24) {
      const sourcePhaseResult = await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import source wasmModule from 'pre-publish-wasi/wasm.wasm'; process.stdout.write(String(wasmModule instanceof WebAssembly.Module))`,
        ],
        { cwd: consumerDir },
      )
      t.is(sourcePhaseResult.stdout, 'true')
    }

    const viteEntry = join(consumerDir, 'vite-entry.mjs')
    await writeFile(
      viteEntry,
      `import root from 'pre-publish-wasi'\nexport const entry = root.entry\n`,
    )
    const { createServer } = await import('vite')
    const viteServer = await createServer({
      root: consumerDir,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      server: {
        middlewareMode: true,
      },
      ssr: {
        noExternal: ['pre-publish-wasi'],
      },
    })
    try {
      const viteModule = await viteServer.ssrLoadModule('/vite-entry.mjs')
      t.is(viteModule.entry, 'module')
    } finally {
      await viteServer.close()
    }

    const typeTest = join(consumerDir, 'workerd.ts')
    await writeFile(
      typeTest,
      `import { instantiate, marker } from 'pre-publish-wasi/workerd'\nimport wasmModule from 'pre-publish-wasi/wasm'\nimport extensionWasmModule from 'pre-publish-wasi/wasm.wasm'\nmarker satisfies 'workerd-export'\nwasmModule satisfies WebAssembly.Module\nextensionWasmModule satisfies WebAssembly.Module\nconst binding = await instantiate(wasmModule)\nbinding.bindingMarker satisfies 'binding-export'\n`,
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
        typeTest,
      ],
      { cwd: consumerDir },
    )
  },
)

test.serial(
  'pre-publish recursively includes relative declaration dependencies',
  async (t) => {
    await setupThreadlessPackage(t.context.tmpDir)
    const packageDir = join(t.context.tmpDir, 'npm', 'wasm32-wasip1')
    await writeFile(
      join(packageDir, 'pre-publish-wasi.wasip1.d.cts'),
      [
        '/// <reference path="./types/reference.d.ts" preserve="true" />',
        '// <reference path="./types/commented-reference.d.ts" />',
        '/* <reference path="./types/block-comment-reference.d.ts" /> */',
        `export type ImportText = "import('./types/string-import.js')"`,
        `export type ReferenceText = "<reference path='./types/string-reference.d.ts' />"`,
        "export type RequireText = `require('./types/template-require.cjs')`",
        `export { value } from './types/one.js'`,
        '',
      ].join('\n'),
    )
    await mkdir(join(t.context.tmpDir, 'types'))
    await writeFile(
      join(t.context.tmpDir, 'types', 'reference.d.ts'),
      'export declare const referenced: true\n',
    )
    await writeFile(
      join(t.context.tmpDir, 'types', 'one.d.ts'),
      [
        `import './side-effect.mjs'`,
        `import required = require('./required.cjs')`,
        `export type Required = typeof required`,
        `export type Imported = import('./query.js').Query`,
        `export { value } from './two.js'`,
        '',
      ].join('\n'),
    )
    await writeFile(
      join(t.context.tmpDir, 'types', 'two.d.ts'),
      'export declare const value: 42\n',
    )
    await writeFile(
      join(t.context.tmpDir, 'types', 'side-effect.d.mts'),
      'export {}\n',
    )
    await writeFile(
      join(t.context.tmpDir, 'types', 'required.d.cts'),
      'declare const required: { readonly required: true }\nexport = required\n',
    )
    await writeFile(
      join(t.context.tmpDir, 'types', 'query.d.ts'),
      'export interface Query { readonly query: true }\n',
    )

    const flavorManifestPath = join(packageDir, 'package.json')
    const flavorManifestBeforeDryRun = await readFile(
      flavorManifestPath,
      'utf8',
    )
    await prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    })
    t.is(await readFile(flavorManifestPath, 'utf8'), flavorManifestBeforeDryRun)
    t.false(existsSync(join(packageDir, 'types')))

    await prePublish({
      cwd: t.context.tmpDir,
      dryRun: false,
      ghRelease: false,
      tagStyle: 'npm',
      skipOptionalPublish: true,
    })

    const flavorManifest = JSON.parse(
      await readFile(join(packageDir, 'package.json'), 'utf8'),
    )
    t.true(flavorManifest.files.includes('types/reference.d.ts'))
    t.true(flavorManifest.files.includes('types/one.d.ts'))
    t.true(flavorManifest.files.includes('types/two.d.ts'))
    t.true(flavorManifest.files.includes('types/side-effect.d.mts'))
    t.true(flavorManifest.files.includes('types/required.d.cts'))
    t.true(flavorManifest.files.includes('types/query.d.ts'))
    t.true(existsSync(join(packageDir, 'types', 'reference.d.ts')))
    t.true(existsSync(join(packageDir, 'types', 'one.d.ts')))
    t.true(existsSync(join(packageDir, 'types', 'two.d.ts')))

    const tarball = await packWithNpm(
      resolveNpmCli(),
      packageDir,
      t.context.tmpDir,
    )
    const consumerDir = join(t.context.tmpDir, 'types-consumer')
    await mkdir(consumerDir)
    await writeFile(
      join(consumerDir, 'package.json'),
      JSON.stringify({
        name: 'types-consumer',
        private: true,
        type: 'module',
        dependencies: {
          [flavorManifest.name]: fileDependency(consumerDir, tarball),
        },
      }),
    )
    await execFileAsync(
      process.execPath,
      [
        resolveNpmCli(),
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-package-lock',
      ],
      { cwd: consumerDir },
    )
    const typeTest = join(consumerDir, 'index.ts')
    await writeFile(
      typeTest,
      `import { value } from '${flavorManifest.name}'\nvalue satisfies 42\n`,
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
        typeTest,
      ],
      { cwd: consumerDir },
    )
  },
)

test('pre-publish rejects missing triple-slash references with attributes', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const packageDir = join(t.context.tmpDir, 'npm', 'wasm32-wasip1')
  await writeFile(
    join(packageDir, 'pre-publish-wasi.wasip1.d.cts'),
    '/// <reference path="./types/missing.d.ts" preserve="true" />\n',
  )

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /references missing \.\/types\/missing\.d\.ts/)
})

test('pre-publish does not copy declaration dependencies from node_modules', async (t) => {
  await setupThreadlessPackage(t.context.tmpDir)
  const packageDir = join(t.context.tmpDir, 'npm', 'wasm32-wasip1')
  await writeFile(
    join(packageDir, 'pre-publish-wasi.wasip1.d.cts'),
    `export { privateValue } from './node_modules/private/index.js'\n`,
  )
  await mkdir(join(t.context.tmpDir, 'node_modules', 'private'), {
    recursive: true,
  })
  await writeFile(
    join(t.context.tmpDir, 'node_modules', 'private', 'index.d.ts'),
    'export declare const privateValue: true\n',
  )

  const error = await t.throwsAsync(() =>
    prePublish({
      cwd: t.context.tmpDir,
      dryRun: true,
      ghRelease: false,
      tagStyle: 'npm',
    }),
  )
  t.regex(error.message, /references missing \.\/node_modules\/private/)
})
