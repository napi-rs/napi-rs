import type { Dirent } from 'node:fs'
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
  getWasiPackageIdentity,
  MINIMUM_WASI_NODE_VERSION,
  parseTriple,
  readNapiConfig,
  pick,
  resolvePackageReconciliationPaths,
  restrictWasiNodeEngine,
  serializeJson,
  WASI_FAMILY_TARGET,
  WASI_PACKAGE_IDENTITIES,
  wasiLoaderSuffix,
  wasiPackageIdentityFlavors,
  wasiTargetHasThreads,
  withFileSystemReconciliation,
  type FileSystemTransactionWrite,
  type Target,
  type CommonPackageJsonFields,
  type WasiPackageIdentity,
} from '../utils/index.js'
import {
  createWasiDispatcher,
  createWasiDispatcherTypeDef,
  WASI_THREADLESS_CONDITION,
  wasiDispatcherFileNames,
} from './templates/index.js'

const debug = debugFactory('create-npm-dirs')
/**
 * Every directory under `npm/` this command may own for WASI: the unified
 * package (both flavors configured) and the two single-flavor packages. All
 * three are swept so a project that moved between layouts leaves nothing
 * behind.
 */
const MANAGED_WASI_PACKAGE_DIRS: readonly WasiPackageIdentity[] =
  WASI_PACKAGE_IDENTITIES
/**
 * Artifact identity the threaded flavor carried before it moved to its
 * canonical triple. An older CLI wrote `<bin>.wasm32-wasi.wasm` and
 * `<bin>.wasi.*` loaders into `npm/wasm32-wasi/`; those names are recognised
 * so they are cleaned up, never written.
 */
const LEGACY_THREADED_WASI_IDENTITY = 'wasm32-wasi'

export interface PackageMeta {
  'dist-tags': { [index: string]: string }
}

const WASM_RUNTIME_PACKAGE_NAME = '@napi-rs/wasm-runtime'
const ASYNC_RUNTIME_PACKAGE_NAME = '@napi-rs/async-runtime'

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
  identity: WasiPackageIdentity
}

async function getLatestPackageVersion(packageName: string) {
  const npmRegistryBase =
    process.env.npm_config_registry?.replace(/\/?$/, '/') ??
    'https://registry.npmjs.org/'
  const packageMetadataUrl = `${npmRegistryBase}${packageName}`
  let response: Response

  try {
    response = await fetch(packageMetadataUrl)
  } catch (error) {
    throw new Error(
      `Failed to fetch ${packageMetadataUrl} while resolving ${packageName}. Check your network connection and npm registry availability.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${packageMetadataUrl} while resolving ${packageName}: npm registry responded with ${response.status} ${response.statusText || 'Unknown Status'}`,
    )
  }

  let packageMeta: PackageMeta

  try {
    packageMeta = (await response.json()) as PackageMeta
  } catch (error) {
    throw new Error(
      `Failed to parse npm registry metadata for ${packageName} from ${packageMetadataUrl}`,
      { cause: error },
    )
  }

  const latestVersion = packageMeta['dist-tags']?.latest

  if (typeof latestVersion !== 'string' || latestVersion.trim().length === 0) {
    throw new Error(
      `npm registry metadata for ${packageName} from ${packageMetadataUrl} did not include a latest dist-tag`,
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

interface WasiFlavorFiles {
  target: Target
  binaryFileName: string
  entry: string
  typeDef: string
  browser: string
  /** Threadless only: deferred (workerd-safe) loader and its declaration. */
  deferredEntry?: string
  deferredTypeDef?: string
  /** Threadless only: declaration for importing the `.wasm` as a module. */
  wasmModuleTypeDef?: string
  files: string[]
}

/** Build outputs of one WASI flavor as they appear inside its npm package. */
function wasiFlavorFiles(binaryName: string, target: Target): WasiFlavorFiles {
  const loaderSuffix = wasiLoaderSuffix(target.platformArchABI)
  const binaryFileName = `${binaryName}.${target.platformArchABI}.wasm`
  const entry = `${binaryName}.${loaderSuffix}.cjs`
  const typeDef = `${binaryName}.${loaderSuffix}.d.cts`
  const browser = `${binaryName}.${loaderSuffix}-browser.js`
  const files = [binaryFileName, entry, typeDef, browser]
  if (wasiTargetHasThreads(target)) {
    // worker scripts are only referenced by the threaded loaders
    files.push('wasi-worker.mjs', 'wasi-worker-browser.mjs')
    return { target, binaryFileName, entry, typeDef, browser, files }
  }
  // the deferred workerd-safe loader is only emitted for non-threaded WASI
  // builds (mirrors `hasThreads` in `writeWasiBinding`)
  const deferredEntry = `${binaryName}.${loaderSuffix}-deferred.js`
  const deferredTypeDef = `${binaryName}.${loaderSuffix}-deferred.d.ts`
  const wasmModuleTypeDef = `${binaryFileName}.d.ts`
  files.push(deferredEntry, deferredTypeDef, wasmModuleTypeDef)
  return {
    target,
    binaryFileName,
    entry,
    typeDef,
    browser,
    deferredEntry,
    deferredTypeDef,
    wasmModuleTypeDef,
    files,
  }
}

/**
 * Every file this command or `napi artifacts` may have written into the
 * package directory of `identity`, including names older CLI versions used,
 * so that stale layouts are swept completely.
 */
function managedWasiGeneratedFiles(
  binaryName: string,
  identity: WasiPackageIdentity,
) {
  assertSafeManagedPathSegment(binaryName, 'Configured binary name')
  const files = new Set<string>()
  for (const flavor of wasiPackageIdentityFlavors(identity)) {
    const flavorTarget = parseTriple(flavor)
    for (const file of wasiFlavorFiles(binaryName, flavorTarget).files) {
      files.add(file)
    }
    files.add(`${binaryName}.${flavor}.debug.wasm`)
    files.add(`${binaryName}.${flavor}.wasm.d.mts`)
    files.add(`${binaryName}.${flavor}.workerd.mjs`)
    files.add(`${binaryName}.${flavor}.workerd.d.mts`)
  }
  if (identity === WASI_FAMILY_TARGET) {
    for (const file of Object.values(wasiDispatcherFileNames(binaryName))) {
      files.add(file)
    }
    const legacySuffix = wasiLoaderSuffix(LEGACY_THREADED_WASI_IDENTITY)
    for (const file of [
      `${binaryName}.${LEGACY_THREADED_WASI_IDENTITY}.wasm`,
      `${binaryName}.${LEGACY_THREADED_WASI_IDENTITY}.debug.wasm`,
      `${binaryName}.${legacySuffix}-browser.js`,
      'wasi-worker.mjs',
      'wasi-worker-browser.mjs',
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

function isWasiPackageIdentity(name: string): name is WasiPackageIdentity {
  return (WASI_PACKAGE_IDENTITIES as readonly string[]).includes(name)
}

/**
 * Recognises a package directory this command wrote — in the current layout
 * or an older one — so its files may be removed. Anything that does not look
 * generated (unknown files, a foreign name, a non-WASI entry) is left alone.
 */
async function inspectOwnedWasiPackage(
  directory: ManagedPackageDirectory,
): Promise<OwnedWasiPackage | undefined> {
  if (!isWasiPackageIdentity(directory.name)) {
    return
  }
  const identity = directory.name
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

  const packageNameSuffix = `-${identity}`
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

  const mainSuffix = `.${wasiLoaderSuffix(identity)}.cjs`
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

  const generatedFiles = managedWasiGeneratedFiles(binaryName, identity)
  if (!manifest.files.every((file) => generatedFiles.has(file))) {
    return
  }

  return {
    binaryName,
    packageName: manifest.name.slice(0, -packageNameSuffix.length),
    identity,
  }
}

/** README texts this command has written for a WASI package over time. */
function wasiReadmeCandidates(
  packageName: string,
  identity: WasiPackageIdentity,
) {
  const candidates = [wasiReadme(packageName, identity)]
  for (const flavor of wasiPackageIdentityFlavors(identity)) {
    candidates.push(
      `# \`${packageName}-${identity}\`\n\nThis is the **${flavor}** binary for \`${packageName}\`\n`,
    )
  }
  return candidates
}

async function readManagedDirectoryEntries(directory: ManagedPackageDirectory) {
  try {
    const entries = await readdir(directory.path, { withFileTypes: true })
    return new Map(entries.map((entry) => [entry.name, entry]))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map<string, Dirent>()
    }
    throw error
  }
}

function assertRegularManagedFile(
  directory: ManagedPackageDirectory,
  entry: Dirent,
) {
  if (!entry.isFile()) {
    throw new Error(
      `Managed WASI package file must be a regular file: ${join(directory.path, entry.name)}`,
    )
  }
}

/** Removals for a WASI package directory the configuration no longer uses. */
async function collectStaleWasiPackageRemovals(
  directory: ManagedPackageDirectory,
  binaryName: string,
) {
  if (!isWasiPackageIdentity(directory.name)) {
    return []
  }
  const entriesByName = await readManagedDirectoryEntries(directory)
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
    assertRegularManagedFile(directory, entry)
    removals.push(join(directory.path, file))
  }

  if (owner) {
    removals.push(join(directory.path, 'package.json'))
    const readmePath = join(directory.path, 'README.md')
    if (
      entriesByName.get('README.md')?.isFile() &&
      wasiReadmeCandidates(owner.packageName, owner.identity).includes(
        await readFile(readmePath, 'utf8'),
      )
    ) {
      removals.push(readmePath)
    }
  }
  return removals
}

/**
 * Removals for a configured WASI package directory: generated files from an
 * older layout (for instance the threaded flavor's former
 * `<bin>.wasm32-wasi.wasm` identity) that the current layout does not write
 * and `napi artifacts` would otherwise leave behind.
 */
async function collectLegacyWasiFileRemovals(
  directory: ManagedPackageDirectory,
  binaryName: string,
  currentFiles: ReadonlySet<string>,
) {
  if (!isWasiPackageIdentity(directory.name)) {
    return []
  }
  const entriesByName = await readManagedDirectoryEntries(directory)
  const removals: string[] = []
  for (const file of managedWasiGeneratedFiles(binaryName, directory.name)) {
    if (currentFiles.has(file)) {
      continue
    }
    const entry = entriesByName.get(file)
    if (!entry) {
      continue
    }
    assertRegularManagedFile(directory, entry)
    removals.push(join(directory.path, file))
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

function basePackageJson(
  packageJson: CommonPackageJsonFields,
  name: string,
): CommonPackageJsonFields {
  const scopedPackageJson: CommonPackageJsonFields = {
    name,
    version: packageJson.version,
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
  return scopedPackageJson
}

function createNativePackageJson(
  packageJson: CommonPackageJsonFields,
  packageName: string,
  binaryName: string,
  target: Target,
) {
  const binaryFileName = `${binaryName}.${target.platformArchABI}.node`
  const scopedPackageJson = basePackageJson(
    packageJson,
    `${packageName}-${target.platformArchABI}`,
  )
  scopedPackageJson.cpu =
    target.arch !== 'universal' ? [target.arch] : undefined
  scopedPackageJson.main = binaryFileName
  scopedPackageJson.files = [binaryFileName]
  scopedPackageJson.os = [target.platform]
  if (target.abi === 'gnu') {
    scopedPackageJson.libc = ['glibc']
  } else if (target.abi === 'musl') {
    scopedPackageJson.libc = ['musl']
  }
  return scopedPackageJson
}

interface WasiPackagePlan {
  packageJson: CommonPackageJsonFields
  /** Static files this command owns besides package.json and README. */
  staticFiles: Map<string, string>
}

/**
 * package.json of the WASI package for `identity`.
 *
 * A single-flavor package keeps the shape that flavor always had. The
 * unified package (`<package>-wasm32-wasi`, both flavors configured) points
 * `main`/`types` at the dispatcher, routes `browser` to the threaded browser
 * loader, and exposes the threadless flavor through the
 * `wasi-threadless` exports condition plus fixed-flavor subpaths.
 */
function createWasiPackagePlan(
  packageJson: CommonPackageJsonFields,
  packageName: string,
  binaryName: string,
  identity: WasiPackageIdentity,
  flavorTargets: Target[],
  wasm: Awaited<ReturnType<typeof readNapiConfig>>['wasm'],
  wasmRuntimeVersion: string | undefined,
  asyncRuntimeVersion: string | undefined,
): WasiPackagePlan {
  const flavors = flavorTargets.map((target) =>
    wasiFlavorFiles(binaryName, target),
  )
  const threaded = flavors.find((flavor) => wasiTargetHasThreads(flavor.target))
  const threadless = flavors.find(
    (flavor) => !wasiTargetHasThreads(flavor.target),
  )
  // WASI modules execute inside a normal host Node/browser/workerd process.
  // Marking them as cpu=wasm32 makes npm reject direct installation and
  // silently skip the package when it is an optional dependency on x64 or
  // arm64 hosts, so `cpu`/`os` stay unset.
  const scopedPackageJson = basePackageJson(
    packageJson,
    `${packageName}-${identity}`,
  )
  scopedPackageJson.type = 'module'
  const staticFiles = new Map<string, string>()
  const files = new Set<string>()
  for (const flavor of flavors) {
    for (const file of flavor.files) {
      files.add(file)
    }
    if (flavor.wasmModuleTypeDef) {
      staticFiles.set(flavor.wasmModuleTypeDef, createWasmModuleTypeDef())
    }
  }

  const threadlessSubpaths = (flavor: WasiFlavorFiles) => ({
    './workerd': {
      types: `./${flavor.deferredTypeDef}`,
      default: `./${flavor.deferredEntry}`,
    },
    './wasm': {
      types: `./${flavor.wasmModuleTypeDef}`,
      default: `./${flavor.binaryFileName}`,
    },
    './wasm.wasm': {
      types: `./${flavor.wasmModuleTypeDef}`,
      default: `./${flavor.binaryFileName}`,
    },
  })

  if (identity === WASI_FAMILY_TARGET) {
    if (!threaded || !threadless) {
      throw new Error(
        `The unified ${WASI_FAMILY_TARGET} package needs both WASI flavors, got ${flavorTargets.map((target) => target.platformArchABI).join(', ')}`,
      )
    }
    const dispatcher = wasiDispatcherFileNames(binaryName)
    staticFiles.set(dispatcher.entry, createWasiDispatcher(binaryName))
    // `napi artifacts` rewrites the declaration when the flavor declarations
    // export by assignment (a build without type definitions)
    staticFiles.set(dispatcher.typeDef, createWasiDispatcherTypeDef(binaryName))
    files.add(dispatcher.entry)
    files.add(dispatcher.typeDef)
    scopedPackageJson.main = dispatcher.entry
    scopedPackageJson.types = dispatcher.typeDef
    // legacy `browser` field agrees with the `exports` default
    scopedPackageJson.browser = threaded.browser
    const fixedFlavorExports = (flavor: WasiFlavorFiles) => ({
      types: `./${flavor.typeDef}`,
      browser: `./${flavor.browser}`,
      default: `./${flavor.entry}`,
    })
    scopedPackageJson.exports = {
      '.': {
        types: `./${dispatcher.typeDef}`,
        browser: {
          [WASI_THREADLESS_CONDITION]: `./${threadless.browser}`,
          default: `./${threaded.browser}`,
        },
        [WASI_THREADLESS_CONDITION]: `./${threadless.entry}`,
        default: `./${dispatcher.entry}`,
      },
      [`./${threaded.target.platformArchABI}`]: fixedFlavorExports(threaded),
      [`./${threadless.target.platformArchABI}`]:
        fixedFlavorExports(threadless),
      ...threadlessSubpaths(threadless),
      './package.json': './package.json',
    }
  } else {
    const [flavor] = flavors
    scopedPackageJson.main = flavor.entry
    scopedPackageJson.types = flavor.typeDef
    scopedPackageJson.browser = flavor.browser
    if (threadless) {
      scopedPackageJson.exports = {
        '.': {
          types: `./${flavor.typeDef}`,
          browser: `./${flavor.browser}`,
          require: `./${flavor.entry}`,
          default: `./${flavor.entry}`,
        },
        ...threadlessSubpaths(threadless),
        './package.json': './package.json',
      }
    }
  }
  scopedPackageJson.files = [...files]
  scopedPackageJson.engines = {
    ...scopedPackageJson.engines,
    node: scopedPackageJson.engines?.node
      ? restrictWasiNodeEngine(scopedPackageJson.engines.node)
      : MINIMUM_WASI_NODE_VERSION,
  }
  const emnapiVersion = require('emnapi/package.json').version
  scopedPackageJson.dependencies = {
    // Runtime minor releases can target a different emnapi generation.
    // Keep generated packages on the resolved minor while allowing fixes.
    '@napi-rs/wasm-runtime': `~${wasmRuntimeVersion}`,
    '@emnapi/core': emnapiVersion,
    '@emnapi/runtime': emnapiVersion,
    // The compatibility axis is the host contract version (4), which is
    // stable across a semver major, so a caret range is correct here.
    ...(asyncRuntimeVersion
      ? { '@napi-rs/async-runtime': `^${asyncRuntimeVersion}` }
      : {}),
    // `buffer` is a direct dependency when any shipped flavor needs it
    ...(wasm?.browser?.buffer === true &&
    flavorTargets.some(
      (target) => wasm.browser?.fs !== true || !wasiTargetHasThreads(target),
    )
      ? { buffer: directBufferDependency }
      : {}),
  }
  return { packageJson: scopedPackageJson, staticFiles }
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
  const nativeTargets = targets.filter((target) => target.arch !== 'wasm32')
  const wasiTargets = targets.filter((target) => target.arch === 'wasm32')
  const wasiPackageIdentity = getWasiPackageIdentity(targets)
  const packageDirectories = await resolveManagedPackageDirectories(
    options,
    initialPaths,
    nativeTargets,
  )
  const staleWasiDirectories = MANAGED_WASI_PACKAGE_DIRS.filter(
    (identity) => identity !== wasiPackageIdentity,
  ).map((identity) => packageDirectories.get(identity)!)
  const staleWasiRemovals = (
    await Promise.all(
      staleWasiDirectories.map((directory) =>
        collectStaleWasiPackageRemovals(directory, binaryName),
      ),
    )
  ).flat()
  const hasWasmTarget = wasiTargets.length > 0
  const [wasmRuntimeVersion, asyncRuntimeVersion] = await Promise.all([
    hasWasmTarget
      ? getLatestPackageVersion(WASM_RUNTIME_PACKAGE_NAME)
      : undefined,
    hasWasmTarget && wasm?.asyncRuntime === true
      ? getLatestPackageVersion(ASYNC_RUNTIME_PACKAGE_NAME)
      : undefined,
  ])
  const pendingWrites: PendingMetadataWrite[] = []

  for (const target of nativeTargets) {
    const targetDir = packageDirectories.get(target.platformArchABI)!.path
    debug('Plan npm package dir: %i', targetDir)
    pendingWrites.push({
      content: serializeJson(
        createNativePackageJson(packageJson, packageName, binaryName, target),
      ),
      destination: join(targetDir, 'package.json'),
    })
    pendingWrites.push({
      content: nativeReadme(packageName, target),
      destination: join(targetDir, 'README.md'),
    })
    debug.info(`${packageName} -${target.platformArchABI} created`)
  }

  if (wasiPackageIdentity) {
    const directory = packageDirectories.get(wasiPackageIdentity)!
    debug('Plan npm package dir: %i', directory.path)
    const plan = createWasiPackagePlan(
      packageJson,
      packageName,
      binaryName,
      wasiPackageIdentity,
      wasiTargets,
      wasm,
      wasmRuntimeVersion,
      asyncRuntimeVersion,
    )
    pendingWrites.push({
      content: serializeJson(plan.packageJson),
      destination: join(directory.path, 'package.json'),
    })
    for (const [file, content] of plan.staticFiles) {
      pendingWrites.push({ content, destination: join(directory.path, file) })
    }
    pendingWrites.push({
      content: wasiReadme(packageName, wasiPackageIdentity),
      destination: join(directory.path, 'README.md'),
    })
    staleWasiRemovals.push(
      ...(await collectLegacyWasiFileRemovals(
        directory,
        binaryName,
        new Set(plan.packageJson.files),
      )),
    )
    debug.info(`${packageName} -${wasiPackageIdentity} created`)
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

function nativeReadme(packageName: string, target: Target) {
  return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`
}

function wasiReadme(packageName: string, identity: WasiPackageIdentity) {
  const flavors = wasiPackageIdentityFlavors(identity)
  if (identity !== WASI_FAMILY_TARGET) {
    return `# \`${packageName}-${identity}\`

This is the **${flavors[0]}** WASI binary for \`${packageName}\`
`
  }
  const [threaded, threadless] = flavors
  return `# \`${packageName}-${identity}\`

This package carries both WASI flavors of \`${packageName}\`:

- **${threaded}**: multi-threaded; needs \`SharedArrayBuffer\` (in browsers: cross-origin isolation). Loaded by default.
- **${threadless}**: single-threaded fallback; also usable in Cloudflare Workers via \`${packageName}-${identity}/workerd\`.

In Node.js the package entry loads **${threaded}** and falls back to **${threadless}** when the threaded flavor fails to load. Pin a flavor with \`NAPI_RS_WASI_FLAVOR=${threaded}\` or \`NAPI_RS_WASI_FLAVOR=${threadless}\`, or resolve the package with the \`${WASI_THREADLESS_CONDITION}\` exports condition (\`node -C ${WASI_THREADLESS_CONDITION}\`; \`resolve.conditionNames\` / \`resolve.conditions\` / \`--conditions\` in bundlers), which also selects the threadless browser loader. Fixed-flavor imports: \`${packageName}-${identity}/${threaded}\` and \`${packageName}-${identity}/${threadless}\`.
`
}
