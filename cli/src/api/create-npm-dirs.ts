import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const directBufferDependency = '^6.0.3'

import {
  applyDefaultCreateNpmDirsOptions,
  type CreateNpmDirsOptions,
} from '../def/create-npm-dirs.js'
import {
  commitFileSystemTransaction,
  createWasmModuleTypeDef,
  debugFactory,
  MINIMUM_WASI_NODE_VERSION,
  parseTriple,
  readNapiConfig,
  pick,
  resolvePackageReconciliationPaths,
  restrictWasiNodeEngine,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  withFileSystemReconciliation,
  type FileSystemTransactionWrite,
  type Target,
  type CommonPackageJsonFields,
} from '../utils/index.js'

const debug = debugFactory('create-npm-dirs')
const MANAGED_WASI_PACKAGE_TARGETS = new Map([
  ['wasm32-wasi', 'wasm32-wasip1-threads'],
  ['wasm32-wasip1', 'wasm32-wasip1'],
])
const MANAGED_WASI_PACKAGE_DIRS = [...MANAGED_WASI_PACKAGE_TARGETS.keys()]

export interface PackageMeta {
  'dist-tags': { [index: string]: string }
}

const WASM_RUNTIME_PACKAGE_NAME = '@napi-rs/wasm-runtime'

interface PendingMetadataWrite {
  content: string
  destination: string
}

interface ManagedPackageDirectory {
  name: string
  path: string
}

interface OwnedWasiPackage {
  binaryName: string
  packageName: string
  target: Target
}

async function getLatestWasmRuntimeVersion() {
  const npmRegistryBase =
    process.env.npm_config_registry?.replace(/\/?$/, '/') ??
    'https://registry.npmjs.org/'
  const packageMetadataUrl = `${npmRegistryBase}${WASM_RUNTIME_PACKAGE_NAME}`
  let response: Response

  try {
    response = await fetch(packageMetadataUrl)
  } catch (error) {
    throw new Error(
      `Failed to fetch ${packageMetadataUrl} while resolving ${WASM_RUNTIME_PACKAGE_NAME}. Check your network connection and npm registry availability.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${packageMetadataUrl} while resolving ${WASM_RUNTIME_PACKAGE_NAME}: npm registry responded with ${response.status} ${response.statusText || 'Unknown Status'}`,
    )
  }

  let packageMeta: PackageMeta

  try {
    packageMeta = (await response.json()) as PackageMeta
  } catch (error) {
    throw new Error(
      `Failed to parse npm registry metadata for ${WASM_RUNTIME_PACKAGE_NAME} from ${packageMetadataUrl}`,
      { cause: error },
    )
  }

  const latestVersion = packageMeta['dist-tags']?.latest

  if (typeof latestVersion !== 'string' || latestVersion.trim().length === 0) {
    throw new Error(
      `npm registry metadata for ${WASM_RUNTIME_PACKAGE_NAME} from ${packageMetadataUrl} did not include a latest dist-tag`,
    )
  }

  return latestVersion.trim()
}

function assertSafeManagedPathSegment(value: string, label: string) {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    isAbsolute(value) ||
    basename(value) !== value
  ) {
    throw new Error(
      `${label} must be a single filesystem path segment: ${value}`,
    )
  }
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function assertSafeTargetDirectory(path: string) {
  const stats = await lstatIfExists(path)
  if (!stats) {
    return
  }
  if (stats.isSymbolicLink()) {
    throw new Error(
      `npm target directory must not be a symbolic link or junction: ${path}`,
    )
  }
  if (!stats.isDirectory()) {
    throw new Error(`npm target path is not a directory: ${path}`)
  }
}

async function resolveManagedPackageDirectories(
  options: ReturnType<typeof applyDefaultCreateNpmDirsOptions>,
  initialPaths: ReturnType<typeof resolvePackageReconciliationPaths>,
  targets: Target[],
) {
  const directoryNames = [
    ...new Set([
      ...targets.map((target) => target.platformArchABI),
      ...MANAGED_WASI_PACKAGE_DIRS,
    ]),
  ]
  for (const directoryName of directoryNames) {
    assertSafeManagedPathSegment(
      directoryName,
      `Target output identity ${directoryName}`,
    )
  }

  const requestedNpmPath = resolve(options.cwd, options.npmDir)
  const requestedTargetPaths = directoryNames.map((directoryName) =>
    join(requestedNpmPath, directoryName),
  )
  await Promise.all(requestedTargetPaths.map(assertSafeTargetDirectory))

  const resolvedPaths = resolvePackageReconciliationPaths(
    options.cwd,
    options.packageJsonPath,
    [options.npmDir, ...requestedTargetPaths],
  )
  if (resolvedPaths.boundary !== initialPaths.boundary) {
    throw new Error(
      `Managed npm target paths changed the reconciliation boundary from ${initialPaths.boundary} to ${resolvedPaths.boundary}`,
    )
  }

  return new Map(
    directoryNames.map((name, index) => [
      name,
      {
        name,
        path: resolvedPaths.managedPaths[index + 1],
      } satisfies ManagedPackageDirectory,
    ]),
  )
}

function managedWasiGeneratedFiles(binaryName: string, packageDir: string) {
  assertSafeManagedPathSegment(binaryName, 'Configured binary name')
  const targetTriple = MANAGED_WASI_PACKAGE_TARGETS.get(packageDir)
  if (!targetTriple) {
    return new Set<string>()
  }
  const target = parseTriple(targetTriple)
  const loaderSuffix = wasiLoaderSuffix(packageDir)
  const files = new Set([
    `${binaryName}.${packageDir}.wasm`,
    `${binaryName}.${packageDir}.debug.wasm`,
    `${binaryName}.${loaderSuffix}.cjs`,
    `${binaryName}.${loaderSuffix}.d.cts`,
    `${binaryName}.${loaderSuffix}-browser.js`,
  ])
  if (wasiTargetHasThreads(target)) {
    files.add('wasi-worker.mjs')
    files.add('wasi-worker-browser.mjs')
  } else {
    for (const file of [
      `${binaryName}.${packageDir}.wasm.d.ts`,
      `${binaryName}.${packageDir}.wasm.d.mts`,
      `${binaryName}.${packageDir}.workerd.mjs`,
      `${binaryName}.${packageDir}.workerd.d.mts`,
      `${binaryName}.${loaderSuffix}-deferred.js`,
      `${binaryName}.${loaderSuffix}-deferred.d.ts`,
    ]) {
      files.add(file)
    }
  }
  return files
}

function asJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

async function inspectOwnedWasiPackage(
  directory: ManagedPackageDirectory,
): Promise<OwnedWasiPackage | undefined> {
  const targetTriple = MANAGED_WASI_PACKAGE_TARGETS.get(directory.name)
  if (!targetTriple) {
    return
  }
  const manifestPath = join(directory.path, 'package.json')
  const stats = await lstatIfExists(manifestPath)
  if (!stats?.isFile()) {
    return
  }

  let manifest: Record<string, unknown> | undefined
  try {
    manifest = asJsonRecord(JSON.parse(await readFile(manifestPath, 'utf8')))
  } catch {
    return
  }
  if (!manifest || typeof manifest.name !== 'string') {
    return
  }

  const packageNameSuffix = `-${directory.name}`
  if (
    !manifest.name.endsWith(packageNameSuffix) ||
    manifest.name.length === packageNameSuffix.length ||
    typeof manifest.version !== 'string' ||
    typeof manifest.main !== 'string' ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every((file) => typeof file === 'string') ||
    manifest.type !== 'module'
  ) {
    return
  }

  const loaderSuffix = wasiLoaderSuffix(directory.name)
  const mainSuffix = `.${loaderSuffix}.cjs`
  if (
    !manifest.main.endsWith(mainSuffix) ||
    manifest.main.length === mainSuffix.length
  ) {
    return
  }
  const binaryName = manifest.main.slice(0, -mainSuffix.length)
  try {
    assertSafeManagedPathSegment(binaryName, 'Managed WASI binary name')
  } catch {
    return
  }

  const target = parseTriple(targetTriple)
  const requiredFiles = [
    `${binaryName}.${directory.name}.wasm`,
    `${binaryName}.${loaderSuffix}.cjs`,
    `${binaryName}.${loaderSuffix}.d.cts`,
    `${binaryName}.${loaderSuffix}-browser.js`,
    ...(wasiTargetHasThreads(target)
      ? ['wasi-worker.mjs', 'wasi-worker-browser.mjs']
      : [
          `${binaryName}.${loaderSuffix}-deferred.js`,
          `${binaryName}.${loaderSuffix}-deferred.d.ts`,
          `${binaryName}.${directory.name}.wasm.d.ts`,
        ]),
  ]
  const files = new Set(manifest.files)
  if (
    manifest.types !== `${binaryName}.${loaderSuffix}.d.cts` ||
    manifest.browser !== `${binaryName}.${loaderSuffix}-browser.js` ||
    !requiredFiles.every((file) => files.has(file))
  ) {
    return
  }

  return {
    binaryName,
    packageName: manifest.name.slice(0, -packageNameSuffix.length),
    target,
  }
}

async function collectStaleWasiPackageRemovals(
  directory: ManagedPackageDirectory,
  binaryName: string,
) {
  let entries
  try {
    entries = await readdir(directory.path, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
  const owner = await inspectOwnedWasiPackage(directory)
  const generatedFiles = managedWasiGeneratedFiles(binaryName, directory.name)
  if (owner) {
    for (const file of managedWasiGeneratedFiles(
      owner.binaryName,
      directory.name,
    )) {
      generatedFiles.add(file)
    }
  }

  const removals: string[] = []
  for (const file of generatedFiles) {
    const entry = entriesByName.get(file)
    if (!entry) {
      continue
    }
    if (!entry.isFile()) {
      throw new Error(
        `Managed WASI package file must be a regular file: ${join(directory.path, file)}`,
      )
    }
    removals.push(join(directory.path, file))
  }

  if (owner) {
    removals.push(join(directory.path, 'package.json'))
    const readmePath = join(directory.path, 'README.md')
    if (
      entriesByName.get('README.md')?.isFile() &&
      (await readFile(readmePath, 'utf8')) ===
        readme(owner.packageName, owner.target)
    ) {
      removals.push(readmePath)
    }
  }
  return removals
}

async function publishPackageMetadata(
  reconciliationRoot: string,
  pendingWrites: PendingMetadataWrite[],
  removals: string[],
) {
  const stagingRoot = await mkdtemp(
    join(tmpdir(), 'napi-rs-create-npm-dirs-stage-'),
  )
  try {
    const writes: FileSystemTransactionWrite[] = []
    for (const [index, pendingWrite] of pendingWrites.entries()) {
      const source = join(stagingRoot, String(index))
      await writeFile(source, pendingWrite.content)
      writes.push({
        destination: pendingWrite.destination,
        source,
      })
    }
    if (writes.length > 0 || removals.length > 0) {
      await commitFileSystemTransaction(reconciliationRoot, writes, removals)
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}

async function removeEmptyStalePackageDirectories(
  directories: ManagedPackageDirectory[],
) {
  for (const directory of directories) {
    try {
      await rmdir(directory.path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        debug.warn(
          `Failed to remove empty stale npm package directory ${directory.path}: ${String(error)}`,
        )
      }
    }
  }
}

async function createNpmDirsUnlocked(
  options: ReturnType<typeof applyDefaultCreateNpmDirsOptions>,
  initialPaths: ReturnType<typeof resolvePackageReconciliationPaths>,
) {
  const packageJsonPath = initialPaths.packageJsonPath
  debug(`Read content from [${options.configPath ?? packageJsonPath}]`)

  const { targets, binaryName, packageName, packageJson, wasm } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolve(options.cwd, options.configPath) : undefined,
    )
  assertSafeManagedPathSegment(binaryName, 'Configured binary name')
  const packageDirectories = await resolveManagedPackageDirectories(
    options,
    initialPaths,
    targets,
  )
  const configuredPackageDirs = new Set(
    targets.map((target) => target.platformArchABI),
  )
  const staleWasiDirectories = MANAGED_WASI_PACKAGE_DIRS.filter(
    (packageDir) => !configuredPackageDirs.has(packageDir),
  ).map((packageDir) => packageDirectories.get(packageDir)!)
  const staleWasiRemovals = (
    await Promise.all(
      staleWasiDirectories.map((directory) =>
        collectStaleWasiPackageRemovals(directory, binaryName),
      ),
    )
  ).flat()
  const wasmRuntimeVersion = targets.some((target) => target.arch === 'wasm32')
    ? await getLatestWasmRuntimeVersion()
    : undefined
  const pendingWrites: PendingMetadataWrite[] = []

  for (const target of targets) {
    const targetDir = packageDirectories.get(target.platformArchABI)!.path
    debug('Plan npm package dir: %i', targetDir)

    const binaryFileName =
      target.arch === 'wasm32'
        ? `${binaryName}.${target.platformArchABI}.wasm`
        : `${binaryName}.${target.platformArchABI}.node`
    let wasmModuleTypeDef: string | undefined
    const scopedPackageJson: CommonPackageJsonFields = {
      name: `${packageName}-${target.platformArchABI}`,
      version: packageJson.version,
      // WASI modules execute inside a normal host Node/browser/workerd process.
      // Marking them as cpu=wasm32 makes npm reject direct installation and
      // silently skip the package when it is an optional dependency on x64 or
      // arm64 hosts.
      cpu:
        target.arch !== 'universal' && target.arch !== 'wasm32'
          ? [target.arch]
          : undefined,
      main: binaryFileName,
      files: [binaryFileName],
      ...pick(
        packageJson,
        'description',
        'keywords',
        'author',
        'authors',
        'homepage',
        'license',
        'engines',
        'repository',
        'bugs',
      ),
    }
    if (packageJson.publishConfig) {
      scopedPackageJson.publishConfig = pick(
        packageJson.publishConfig,
        'registry',
        'access',
      )
    }
    if (target.arch !== 'wasm32') {
      scopedPackageJson.os = [target.platform]
    } else {
      const loaderSuffix = wasiLoaderSuffix(target.platformArchABI)
      const entry = `${binaryName}.${loaderSuffix}.cjs`
      const loaderTypeDef = `${binaryName}.${loaderSuffix}.d.cts`
      scopedPackageJson.main = entry
      scopedPackageJson.types = loaderTypeDef
      scopedPackageJson.browser = `${binaryName}.${loaderSuffix}-browser.js`
      scopedPackageJson.type = 'module'
      scopedPackageJson.files?.push(
        entry,
        loaderTypeDef,
        scopedPackageJson.browser,
      )
      if (wasiTargetHasThreads(target)) {
        // worker scripts are only referenced by the threaded loaders
        scopedPackageJson.files?.push(
          `wasi-worker.mjs`,
          `wasi-worker-browser.mjs`,
        )
      } else {
        const deferredEntry = `${binaryName}.${loaderSuffix}-deferred.js`
        const deferredTypeDef = `${binaryName}.${loaderSuffix}-deferred.d.ts`
        wasmModuleTypeDef = `${binaryFileName}.d.ts`
        // the deferred workerd-safe loader is only emitted for non-threaded
        // WASI builds (mirrors `hasThreads` in `writeWasiBinding`)
        scopedPackageJson.files?.push(
          deferredEntry,
          deferredTypeDef,
          wasmModuleTypeDef,
        )
        scopedPackageJson.exports = {
          '.': {
            types: `./${loaderTypeDef}`,
            browser: `./${scopedPackageJson.browser}`,
            require: `./${entry}`,
            default: `./${entry}`,
          },
          './workerd': {
            types: `./${deferredTypeDef}`,
            default: `./${deferredEntry}`,
          },
          './wasm': {
            types: `./${wasmModuleTypeDef}`,
            default: `./${binaryFileName}`,
          },
          './wasm.wasm': {
            types: `./${wasmModuleTypeDef}`,
            default: `./${binaryFileName}`,
          },
          './package.json': './package.json',
        }
      }
      scopedPackageJson.engines = {
        ...scopedPackageJson.engines,
        node: scopedPackageJson.engines?.node
          ? restrictWasiNodeEngine(scopedPackageJson.engines.node)
          : MINIMUM_WASI_NODE_VERSION,
      }
      const emnapiVersion = require('emnapi/package.json').version
      scopedPackageJson.dependencies = {
        '@napi-rs/wasm-runtime': `^${wasmRuntimeVersion}`,
        '@emnapi/core': emnapiVersion,
        '@emnapi/runtime': emnapiVersion,
        ...(wasm?.browser?.buffer === true &&
        (wasm.browser.fs !== true || !wasiTargetHasThreads(target))
          ? { buffer: directBufferDependency }
          : {}),
      }
    }

    if (target.abi === 'gnu') {
      scopedPackageJson.libc = ['glibc']
    } else if (target.abi === 'musl') {
      scopedPackageJson.libc = ['musl']
    }

    const targetPackageJson = join(targetDir, 'package.json')
    pendingWrites.push({
      content: JSON.stringify(scopedPackageJson, null, 2) + '\n',
      destination: targetPackageJson,
    })
    if (wasmModuleTypeDef) {
      pendingWrites.push({
        content: createWasmModuleTypeDef(),
        destination: join(targetDir, wasmModuleTypeDef),
      })
    }
    const targetReadme = join(targetDir, 'README.md')
    pendingWrites.push({
      content: readme(packageName, target),
      destination: targetReadme,
    })

    debug.info(`${packageName} -${target.platformArchABI} created`)
  }

  for (const { content, destination } of pendingWrites) {
    debug('Writing file %i', destination)
    if (options.dryRun) {
      debug(content)
    }
  }
  for (const removal of staleWasiRemovals) {
    debug('Removing stale managed file %i', removal)
  }
  if (options.dryRun) {
    return
  }

  await publishPackageMetadata(
    initialPaths.boundary,
    pendingWrites,
    staleWasiRemovals,
  )
  await removeEmptyStalePackageDirectories(staleWasiDirectories)
}

export async function createNpmDirs(userOptions: CreateNpmDirsOptions) {
  const options = applyDefaultCreateNpmDirsOptions(userOptions)
  const resolvedPaths = resolvePackageReconciliationPaths(
    options.cwd,
    options.packageJsonPath,
    [options.npmDir],
  )
  if (options.dryRun) {
    return createNpmDirsUnlocked(options, resolvedPaths)
  }
  return withFileSystemReconciliation(resolvedPaths.boundary, () =>
    createNpmDirsUnlocked(options, resolvedPaths),
  )
}

function readme(packageName: string, target: Target) {
  return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`
}
