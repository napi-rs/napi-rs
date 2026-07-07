import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { Octokit } from '@octokit/rest'
import { Range } from 'semver'

import {
  applyDefaultPrePublishOptions,
  type PrePublishOptions,
} from '../def/pre-publish.js'
import {
  readFileAsync,
  readNapiConfig,
  createWasmModuleTypeDef,
  debugFactory,
  copyFileAsync,
  mkdirAsync,
  updatePackageJson,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  writeFileAsync,
  type CommonPackageJsonFields,
  type Target,
} from '../utils/index.js'

import { version } from './version.js'

const debug = debugFactory('pre-publish')
const THREADLESS_WASI_ROOT_SUBPATHS = new Set([
  './workerd',
  './wasm',
  './wasm.wasm',
])
const MANAGED_WASI_OPTIONAL_DEPENDENCY_SUFFIXES = [
  'wasm32-wasi',
  'wasm32-wasip1',
]
const LEGACY_DEEP_IMPORT_EXTENSIONS = ['.js', '.json', '.node']
const DECLARATION_EXTENSIONS = ['.d.ts', '.d.cts', '.d.mts']
const WASI_ROOT_FACADE_MARKER_PREFIX = '// napi-rs-wasi-root-facade:'
const directBufferDependency = '^6.0.3'
const require = createRequire(import.meta.url)

interface PackageInfo {
  name: string
  version: string
  tag: string
}

export async function prePublish(userOptions: PrePublishOptions) {
  debug('Receive pre-publish options:')
  debug('  %O', userOptions)

  const options = applyDefaultPrePublishOptions(userOptions)

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)

  const { packageJson, targets, packageName, binaryName, npmClient, wasm } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolve(options.cwd, options.configPath) : undefined,
    )
  const rootDir = dirname(packageJsonPath)
  const threadlessWasiTarget = targets.find(
    (target) => target.platform === 'wasi' && !wasiTargetHasThreads(target),
  )

  for (const target of targets) {
    const pkgDir = resolve(options.cwd, options.npmDir, target.platformArchABI)
    await validateReleasePackage({
      pkgDir,
      rootDir,
      packageName,
      binaryName,
      target,
      requireDirectBufferDependency:
        wasm?.browser?.buffer === true && wasm.browser.fs !== true,
      materializeDeclarationDependencies: !options.dryRun,
    })
  }
  if (threadlessWasiTarget) {
    validateRootPackagePaths(
      rootDir,
      collectRootPackagePathReferences(packageJson),
    )
  }
  const rootFacadeReconciliation = reconcileThreadlessWasiRootFacade(
    packageJson,
    rootDir,
    resolve(options.cwd, options.npmDir),
    packageName,
  )
  let reconciledPackageJson = rootFacadeReconciliation.packageJson
  let rootFacade: ThreadlessWasiRootFacade | undefined
  if (threadlessWasiTarget) {
    rootFacade = planThreadlessWasiRootFacade({
      packageJsonPath,
      packageJson: reconciledPackageJson,
      packageName,
      binaryName,
      target: threadlessWasiTarget,
      npmDir: resolve(options.cwd, options.npmDir),
      managedGeneratedFiles: rootFacadeReconciliation.staleGeneratedFiles,
    })
    reconciledPackageJson = applyThreadlessWasiRootFacade(
      reconciledPackageJson,
      rootFacade,
    )
  }

  async function createGhRelease(packageName: string, version: string) {
    if (!options.ghRelease) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }
    const { repo, owner, pkgInfo, octokit } = getRepoInfo(packageName, version)

    if (!repo || !owner) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }

    if (!options.dryRun) {
      try {
        await octokit.repos.createRelease({
          owner,
          repo,
          tag_name: pkgInfo.tag,
          name: options.ghReleaseName,
          prerelease:
            version.includes('alpha') ||
            version.includes('beta') ||
            version.includes('rc'),
        })
      } catch (e) {
        debug(
          `Params: ${JSON.stringify(
            { owner, repo, tag_name: pkgInfo.tag },
            null,
            2,
          )}`,
        )
        console.error(e)
      }
    }
    return { owner, repo, pkgInfo, octokit }
  }

  function getRepoInfo(packageName: string, version: string) {
    const headCommit = execSync('git log -1 --pretty=%B', {
      cwd: options.cwd,
      encoding: 'utf-8',
    }).trim()

    const { GITHUB_REPOSITORY } = process.env
    if (!GITHUB_REPOSITORY) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }
    debug(`Github repository: ${GITHUB_REPOSITORY}`)
    const [owner, repo] = GITHUB_REPOSITORY.split('/')
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    })
    let pkgInfo: PackageInfo | undefined
    if (options.tagStyle === 'lerna') {
      const packagesToPublish = headCommit
        .split('\n')
        .map((line) => line.trim())
        .filter((line, index) => line.length && index)
        .map((line) => line.substring(2))
        .map(parseTag)

      pkgInfo = packagesToPublish.find(
        (pkgInfo) => pkgInfo.name === packageName,
      )

      if (!pkgInfo) {
        throw new TypeError(
          `No release commit found with ${packageName}, original commit info: ${headCommit}`,
        )
      }
    } else {
      pkgInfo = {
        tag: `v${version}`,
        version,
        name: packageName,
      }
    }
    return { owner, repo, pkgInfo, octokit }
  }

  if (!options.dryRun) {
    await version(userOptions)
    const optionalDependencies = {
      ...asRecord(packageJson.optionalDependencies),
    }
    for (const suffix of MANAGED_WASI_OPTIONAL_DEPENDENCY_SUFFIXES) {
      delete optionalDependencies[`${packageName}-${suffix}`]
    }
    for (const target of targets) {
      optionalDependencies[`${packageName}-${target.platformArchABI}`] =
        packageJson.version
    }
    const packageJsonUpdate: Record<string, unknown> = {
      optionalDependencies,
    }
    if (rootFacade) {
      await materializeThreadlessWasiRootFacade(rootDir, rootFacade)
    }
    await updatePackageJson(packageJsonPath, packageJsonUpdate)
    // updatePackageJson recursively merges objects. Facade fields need exact
    // replacement so removed targets and renamed binaries do not leave stale
    // exports or files behind.
    const updatedPackageJson = JSON.parse(
      await readFileAsync(packageJsonPath, 'utf8'),
    )
    updatedPackageJson.optionalDependencies = optionalDependencies
    syncThreadlessWasiRootFacadeManifest(
      updatedPackageJson,
      reconciledPackageJson,
    )
    await writeFileAsync(
      packageJsonPath,
      JSON.stringify(updatedPackageJson, null, 2),
    )
    if (rootFacade) {
      validateRootFacadePacklist(rootDir, [
        ...rootFacade.generatedFiles,
        ...collectRootPackagePathReferences(updatedPackageJson),
      ])
    }
    const generatedFiles = new Set(rootFacade?.generatedFiles ?? [])
    await Promise.all(
      rootFacadeReconciliation.staleGeneratedFiles
        .filter((file) => !generatedFiles.has(file))
        .map((file) =>
          rm(join(dirname(packageJsonPath), file), { force: true }),
        ),
    )
  }

  const { owner, repo, pkgInfo, octokit } = options.ghReleaseId
    ? getRepoInfo(packageName, packageJson.version)
    : await createGhRelease(packageName, packageJson.version)

  for (const target of targets) {
    const pkgDir = resolve(
      options.cwd,
      options.npmDir,
      `${target.platformArchABI}`,
    )
    const ext =
      target.platform === 'wasi' || target.platform === 'wasm' ? 'wasm' : 'node'
    const filename = `${binaryName}.${target.platformArchABI}.${ext}`
    const dstPath = join(pkgDir, filename)

    if (!options.dryRun) {
      if (!existsSync(dstPath)) {
        throw new Error(`Release artifact does not exist: ${dstPath}`)
      }

      if (!options.skipOptionalPublish) {
        try {
          const output = execSync(`${npmClient} publish`, {
            cwd: pkgDir,
            env: process.env,
            stdio: 'pipe',
          })
          process.stdout.write(output)
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.includes(
              'You cannot publish over the previously published versions',
            )
          ) {
            console.info(e.message)
            debug.warn(`${pkgDir} has been published, skipping`)
          } else {
            throw e
          }
        }
      }

      if (options.ghRelease && repo && owner) {
        debug.info(`Creating GitHub release ${pkgInfo.tag}`)
        try {
          const releaseId = options.ghReleaseId
            ? Number(options.ghReleaseId)
            : (
                await octokit!.repos.getReleaseByTag({
                  repo: repo,
                  owner: owner,
                  tag: pkgInfo.tag,
                })
              ).data.id
          const dstFileStats = statSync(dstPath)
          const assetInfo = await octokit!.repos.uploadReleaseAsset({
            owner: owner,
            repo: repo,
            name: filename,
            release_id: releaseId,
            mediaType: { format: 'raw' },
            headers: {
              'content-length': dstFileStats.size,
              'content-type': 'application/octet-stream',
            },
            // @ts-expect-error octokit types are wrong
            data: await readFileAsync(dstPath),
          })
          debug.info(`GitHub release created`)
          debug.info(`Download URL: %s`, assetInfo.data.browser_download_url)
        } catch (e) {
          debug.error(
            `Param: ${JSON.stringify(
              { owner, repo, tag: pkgInfo.tag, filename: dstPath },
              null,
              2,
            )}`,
          )
          debug.error(e)
        }
      }
    }
  }
}

interface ThreadlessWasiRootFacadeOptions {
  packageJsonPath: string
  packageJson: CommonPackageJsonFields
  packageName: string
  binaryName: string
  target: Target
  npmDir: string
  managedGeneratedFiles: string[]
}

interface ThreadlessWasiRootFacade {
  exports: Record<string, unknown>
  publishConfigExports?: Record<string, unknown>
  generatedFiles: string[]
  files: ThreadlessWasiRootFacadeFiles
  wasmSourcePath: string
  marker: string
  forwardingModule: string
  packageJsonUpdate: {
    files?: string[]
  }
}

interface ThreadlessWasiRootFacadeFiles {
  workerdEntry: string
  workerdTypeDef: string
  wasmEntry: string
  wasmTypeDef: string
}

interface ThreadlessWasiRootFacadeReconciliation {
  packageJson: CommonPackageJsonFields
  staleGeneratedFiles: string[]
}

interface ThreadlessWasiRootFacadeMarker {
  version: 1
  flavorPackage: string
  wasmSha256: string
}

function reconcileThreadlessWasiRootFacade(
  packageJson: CommonPackageJsonFields,
  rootDir: string,
  npmDir: string,
  packageName: string,
): ThreadlessWasiRootFacadeReconciliation {
  const reconciledPackageJson = { ...packageJson }
  const staleGeneratedFiles = new Set<string>()
  const rootExports = removeThreadlessWasiRootExports(
    packageJson.exports,
    packageJson,
    rootDir,
    npmDir,
    packageName,
  )
  for (const file of rootExports.generatedFiles) {
    staleGeneratedFiles.add(file)
  }
  setOptionalProperty(
    reconciledPackageJson as Record<string, unknown>,
    'exports',
    rootExports.exports,
  )

  const publishConfig = asRecord(packageJson.publishConfig)
  if (
    publishConfig &&
    Object.prototype.hasOwnProperty.call(publishConfig, 'exports')
  ) {
    const publishConfigExports = removeThreadlessWasiRootExports(
      publishConfig.exports as CommonPackageJsonFields['exports'],
      packageJson,
      rootDir,
      npmDir,
      packageName,
    )
    for (const file of publishConfigExports.generatedFiles) {
      staleGeneratedFiles.add(file)
    }
    const reconciledPublishConfig = { ...publishConfig }
    setOptionalProperty(
      reconciledPublishConfig,
      'exports',
      publishConfigExports.exports,
    )
    reconciledPackageJson.publishConfig = reconciledPublishConfig
  }

  if (Array.isArray(packageJson.files)) {
    reconciledPackageJson.files = packageJson.files.filter(
      (file) => !staleGeneratedFiles.has(file),
    )
  }

  return {
    packageJson: reconciledPackageJson,
    staleGeneratedFiles: [...staleGeneratedFiles],
  }
}

function removeThreadlessWasiRootExports(
  currentExports: CommonPackageJsonFields['exports'],
  packageJson: CommonPackageJsonFields,
  rootDir: string,
  npmDir: string,
  packageName: string,
) {
  const exportsMap = asRecord(currentExports)
  const generatedFiles = getManagedThreadlessWasiRootFacadeFiles(
    exportsMap,
    rootDir,
    npmDir,
    packageName,
  )
  if (!exportsMap || !generatedFiles) {
    return { exports: currentExports, generatedFiles: [] }
  }

  const nextExports = { ...exportsMap }
  delete nextExports['./workerd']
  delete nextExports['./wasm']
  delete nextExports['./wasm.wasm']
  const keys = Object.keys(nextExports)
  if (
    Object.prototype.hasOwnProperty.call(nextExports, '.') &&
    nextExports['./*'] === './*' &&
    isDeepStrictEqual(
      nextExports['.'],
      createLegacyRootExport(packageJson, rootDir),
    ) &&
    keys
      .filter((key) => key !== '.' && key !== './*')
      .every((key) => isGeneratedLegacyDeepImportExport(key, nextExports[key]))
  ) {
    return { exports: undefined, generatedFiles: Object.values(generatedFiles) }
  }
  if (keys.length === 1 && keys[0] === '.') {
    return {
      exports: nextExports['.'],
      generatedFiles: Object.values(generatedFiles),
    }
  }
  return {
    exports: keys.length > 0 ? nextExports : undefined,
    generatedFiles: Object.values(generatedFiles),
  }
}

function getManagedThreadlessWasiRootFacadeFiles(
  exportsMap: Record<string, unknown> | undefined,
  rootDir: string,
  npmDir: string,
  packageName: string,
): ThreadlessWasiRootFacadeFiles | undefined {
  if (!exportsMap) {
    return undefined
  }
  const workerdExport = asRecord(exportsMap['./workerd'])
  const workerdEntry =
    typeof workerdExport?.default === 'string'
      ? workerdExport.default.match(
          /^\.\/([^/\\]+\.wasm32-wasip1)\.workerd\.mjs$/,
        )
      : null
  if (!workerdEntry) {
    return undefined
  }
  const generatedPrefix = workerdEntry[1]
  const files: ThreadlessWasiRootFacadeFiles = {
    workerdEntry: `${generatedPrefix}.workerd.mjs`,
    workerdTypeDef: `${generatedPrefix}.workerd.d.mts`,
    wasmEntry: `${generatedPrefix}.wasm`,
    wasmTypeDef: `${generatedPrefix}.wasm.d.mts`,
  }
  const expectedWorkerdExport = {
    types: `./${files.workerdTypeDef}`,
    default: `./${files.workerdEntry}`,
  }
  const expectedWasmExport = {
    types: `./${files.wasmTypeDef}`,
    default: `./${files.wasmEntry}`,
  }
  if (
    !isDeepStrictEqual(workerdExport, expectedWorkerdExport) ||
    !isDeepStrictEqual(exportsMap['./wasm'], expectedWasmExport) ||
    !isDeepStrictEqual(exportsMap['./wasm.wasm'], expectedWasmExport)
  ) {
    return undefined
  }
  const flavorPackage = `${packageName}-wasm32-wasip1`
  if (
    hasManagedThreadlessWasiRootFacadeMarker(rootDir, files, flavorPackage) ||
    hasLegacyThreadlessWasiRootFacade(rootDir, npmDir, files, flavorPackage)
  ) {
    return files
  }
  return undefined
}

function hasManagedThreadlessWasiRootFacadeMarker(
  rootDir: string,
  files: ThreadlessWasiRootFacadeFiles,
  flavorPackage: string,
) {
  const workerdEntry = readRegularFile(join(rootDir, files.workerdEntry))
  const workerdTypeDef = readRegularFile(join(rootDir, files.workerdTypeDef))
  const wasmEntry = readRegularFile(join(rootDir, files.wasmEntry))
  const wasmTypeDef = readRegularFile(join(rootDir, files.wasmTypeDef))
  if (!workerdEntry || !workerdTypeDef || !wasmEntry || !wasmTypeDef) {
    return false
  }

  const markedFiles = [workerdEntry, workerdTypeDef, wasmTypeDef].map((file) =>
    parseThreadlessWasiRootFacadeMarker(file.toString('utf8')),
  )
  if (markedFiles.some((file) => file === undefined)) {
    return false
  }
  const [markedWorkerdEntry, markedWorkerdTypeDef, markedWasmTypeDef] =
    markedFiles as Array<{
      marker: ThreadlessWasiRootFacadeMarker
      markerLine: string
      body: string
    }>
  if (
    markedWorkerdEntry.markerLine !== markedWorkerdTypeDef.markerLine ||
    markedWorkerdEntry.markerLine !== markedWasmTypeDef.markerLine
  ) {
    return false
  }

  const expectedMarker: ThreadlessWasiRootFacadeMarker = {
    version: 1,
    flavorPackage,
    wasmSha256: createHash('sha256').update(wasmEntry).digest('hex'),
  }
  if (!isDeepStrictEqual(markedWorkerdEntry.marker, expectedMarker)) {
    return false
  }
  const forwardingModule =
    createThreadlessWasiRootForwardingModule(flavorPackage)
  return (
    markedWorkerdEntry.body === forwardingModule &&
    markedWorkerdTypeDef.body === forwardingModule &&
    markedWasmTypeDef.body === createWasmModuleTypeDef()
  )
}

function hasLegacyThreadlessWasiRootFacade(
  rootDir: string,
  npmDir: string,
  files: ThreadlessWasiRootFacadeFiles,
  flavorPackage: string,
) {
  const workerdEntry = readRegularFile(join(rootDir, files.workerdEntry))
  const workerdTypeDef = readRegularFile(join(rootDir, files.workerdTypeDef))
  const wasmEntry = readRegularFile(join(rootDir, files.wasmEntry))
  const wasmTypeDef = readRegularFile(join(rootDir, files.wasmTypeDef))
  const flavorWasmEntry = readRegularFile(
    join(npmDir, 'wasm32-wasip1', files.wasmEntry),
  )
  if (
    !workerdEntry ||
    !workerdTypeDef ||
    !wasmEntry ||
    !wasmTypeDef ||
    !flavorWasmEntry
  ) {
    return false
  }

  const forwardingModule =
    createThreadlessWasiRootForwardingModule(flavorPackage)
  return (
    workerdEntry.toString('utf8') === forwardingModule &&
    workerdTypeDef.toString('utf8') === forwardingModule &&
    wasmTypeDef.toString('utf8') === createWasmModuleTypeDef() &&
    wasmEntry.equals(flavorWasmEntry)
  )
}

function readRegularFile(path: string) {
  try {
    if (!lstatSync(path).isFile()) {
      return undefined
    }
    return readFileSync(path)
  } catch {
    return undefined
  }
}

function parseThreadlessWasiRootFacadeMarker(source: string) {
  const markerEnd = source.indexOf('\n')
  if (markerEnd === -1) {
    return undefined
  }
  const markerLine = source.slice(0, markerEnd)
  if (!markerLine.startsWith(WASI_ROOT_FACADE_MARKER_PREFIX)) {
    return undefined
  }

  let marker: unknown
  try {
    marker = JSON.parse(markerLine.slice(WASI_ROOT_FACADE_MARKER_PREFIX.length))
  } catch {
    return undefined
  }
  const markerRecord = asRecord(marker)
  if (
    !markerRecord ||
    !isDeepStrictEqual(Object.keys(markerRecord), [
      'version',
      'flavorPackage',
      'wasmSha256',
    ]) ||
    markerRecord.version !== 1 ||
    typeof markerRecord.flavorPackage !== 'string' ||
    typeof markerRecord.wasmSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(markerRecord.wasmSha256) ||
    markerLine !==
      `${WASI_ROOT_FACADE_MARKER_PREFIX}${JSON.stringify(markerRecord)}`
  ) {
    return undefined
  }
  return {
    marker: markerRecord as unknown as ThreadlessWasiRootFacadeMarker,
    markerLine,
    body: source.slice(markerEnd + 1),
  }
}

function createThreadlessWasiRootFacadeMarker(
  flavorPackage: string,
  wasm: Buffer,
) {
  const marker: ThreadlessWasiRootFacadeMarker = {
    version: 1,
    flavorPackage,
    wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  }
  return `${WASI_ROOT_FACADE_MARKER_PREFIX}${JSON.stringify(marker)}`
}

function createThreadlessWasiRootForwardingModule(flavorPackage: string) {
  return `export * from ${JSON.stringify(`${flavorPackage}/workerd`)}\n`
}

function applyThreadlessWasiRootFacade(
  packageJson: CommonPackageJsonFields,
  rootFacade: ThreadlessWasiRootFacade,
) {
  const updatedPackageJson = {
    ...packageJson,
    exports: rootFacade.exports,
  }
  if (rootFacade.packageJsonUpdate.files) {
    updatedPackageJson.files = rootFacade.packageJsonUpdate.files
  }
  if (rootFacade.publishConfigExports) {
    updatedPackageJson.publishConfig = {
      ...asRecord(packageJson.publishConfig),
      exports: rootFacade.publishConfigExports,
    }
  }
  return updatedPackageJson
}

function syncThreadlessWasiRootFacadeManifest(
  destination: Record<string, unknown>,
  source: CommonPackageJsonFields,
) {
  setOptionalProperty(destination, 'exports', source.exports)
  setOptionalProperty(destination, 'files', source.files)

  const destinationPublishConfig = asRecord(destination.publishConfig)
  const sourcePublishConfig = asRecord(source.publishConfig)
  if (destinationPublishConfig || sourcePublishConfig?.exports !== undefined) {
    const publishConfig = { ...destinationPublishConfig }
    setOptionalProperty(publishConfig, 'exports', sourcePublishConfig?.exports)
    destination.publishConfig = publishConfig
  }
}

function setOptionalProperty(
  object: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value === undefined) {
    delete object[key]
  } else {
    object[key] = value
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function planThreadlessWasiRootFacade({
  packageJsonPath,
  packageJson,
  packageName,
  binaryName,
  target,
  npmDir,
  managedGeneratedFiles,
}: ThreadlessWasiRootFacadeOptions): ThreadlessWasiRootFacade {
  const rootDir = dirname(packageJsonPath)
  const flavorPackageName = `${packageName}-${target.platformArchABI}`
  const wasmFileName = `${binaryName}.${target.platformArchABI}.wasm`
  const generatedPrefix = `${binaryName}.${target.platformArchABI}`
  const files: ThreadlessWasiRootFacadeFiles = {
    workerdEntry: `${generatedPrefix}.workerd.mjs`,
    workerdTypeDef: `${generatedPrefix}.workerd.d.mts`,
    wasmEntry: wasmFileName,
    wasmTypeDef: `${wasmFileName}.d.mts`,
  }
  const publishConfig = asRecord(packageJson.publishConfig)
  const hasPublishConfigExports =
    publishConfig &&
    Object.prototype.hasOwnProperty.call(publishConfig, 'exports')
  const effectiveExports = hasPublishConfigExports
    ? (publishConfig.exports as CommonPackageJsonFields['exports'])
    : packageJson.exports
  const exports = addThreadlessWasiRootExports(
    effectiveExports,
    packageJson,
    files,
    rootDir,
  )
  const publishConfigExports = hasPublishConfigExports ? exports : undefined
  const forwardingModule =
    createThreadlessWasiRootForwardingModule(flavorPackageName)
  const generatedFiles = Object.values(files)
  const managedFiles = new Set(managedGeneratedFiles)
  const wasmSourcePath = join(npmDir, target.platformArchABI, wasmFileName)
  const marker = createThreadlessWasiRootFacadeMarker(
    flavorPackageName,
    readFileSync(wasmSourcePath),
  )
  const conflictingFile = generatedFiles.find((file) => {
    const rootPath = join(rootDir, file)
    if (!existsSync(rootPath) || managedFiles.has(file)) {
      return false
    }
    // `napi artifacts` already copies the flavor artifact into the root
    // package. Treat that exact regular file as managed so the standard
    // artifacts -> pre-publish flow can materialize the root facade.
    return !(
      file === files.wasmEntry &&
      lstatSync(rootPath).isFile() &&
      readFileSync(rootPath).equals(readFileSync(wasmSourcePath))
    )
  })
  if (conflictingFile) {
    throw new Error(
      `Cannot generate the threadless WASI root facade file ${conflictingFile}: the path already exists and is not owned by a managed facade. Remove or rename the existing file before running pre-publish.`,
    )
  }
  const facade: ThreadlessWasiRootFacade = {
    exports,
    publishConfigExports,
    generatedFiles,
    files,
    wasmSourcePath,
    marker,
    forwardingModule,
    packageJsonUpdate: {},
  }
  if (Array.isArray(packageJson.files)) {
    facade.packageJsonUpdate = {
      files: [...new Set([...packageJson.files, ...generatedFiles])],
    }
  }
  return facade
}

async function materializeThreadlessWasiRootFacade(
  rootDir: string,
  facade: ThreadlessWasiRootFacade,
) {
  await copyFileAsync(
    facade.wasmSourcePath,
    join(rootDir, facade.files.wasmEntry),
  )
  await Promise.all([
    writeFileAsync(
      join(rootDir, facade.files.workerdEntry),
      `${facade.marker}\n${facade.forwardingModule}`,
      'utf8',
    ),
    writeFileAsync(
      join(rootDir, facade.files.workerdTypeDef),
      `${facade.marker}\n${facade.forwardingModule}`,
      'utf8',
    ),
    writeFileAsync(
      join(rootDir, facade.files.wasmTypeDef),
      `${facade.marker}\n${createWasmModuleTypeDef()}`,
      'utf8',
    ),
  ])
}

function addThreadlessWasiRootExports(
  currentExports: CommonPackageJsonFields['exports'],
  packageJson: CommonPackageJsonFields,
  files: ThreadlessWasiRootFacadeFiles,
  rootDir: string,
) {
  let exportsMap: Record<string, unknown>
  if (currentExports === undefined) {
    exportsMap = {
      '.': createLegacyRootExport(packageJson, rootDir),
      // Adding an exports map would otherwise encapsulate every historical
      // deep import. The wildcard preserves explicit paths, while exact
      // aliases preserve CommonJS extension and directory-index resolution.
      './*': './*',
      ...createLegacyDeepImportExports(rootDir),
    }
  } else if (
    typeof currentExports === 'object' &&
    currentExports !== null &&
    !Array.isArray(currentExports) &&
    Object.keys(currentExports).some((key) => key.startsWith('.'))
  ) {
    exportsMap = { ...currentExports }
  } else {
    // A string, array, or condition-only object describes the package root.
    exportsMap = { '.': currentExports }
  }

  setThreadlessWasiRootExport(exportsMap, './workerd', {
    types: `./${files.workerdTypeDef}`,
    default: `./${files.workerdEntry}`,
  })
  const wasmExport = {
    types: `./${files.wasmTypeDef}`,
    default: `./${files.wasmEntry}`,
  }
  setThreadlessWasiRootExport(exportsMap, './wasm', wasmExport)
  setThreadlessWasiRootExport(exportsMap, './wasm.wasm', wasmExport)
  return exportsMap
}

function setThreadlessWasiRootExport(
  exportsMap: Record<string, unknown>,
  subpath: string,
  generatedExport: unknown,
) {
  if (!Object.prototype.hasOwnProperty.call(exportsMap, subpath)) {
    exportsMap[subpath] = generatedExport
    return
  }
  if (isDeepStrictEqual(exportsMap[subpath], generatedExport)) {
    return
  }
  throw new Error(
    `Cannot generate the threadless WASI root export ${subpath}: package.json already defines that subpath. Remove or rename the existing export before running pre-publish.`,
  )
}

function createLegacyRootExport(
  packageJson: CommonPackageJsonFields,
  rootDir: string,
) {
  const main = resolveLegacyPackageTarget(
    rootDir,
    packageJson.main ?? 'index.js',
  )
  const rootExport: Record<string, string> = {}
  const legacyPackageJson = packageJson as CommonPackageJsonFields & {
    typings?: unknown
  }
  const typeDef =
    typeof packageJson.types === 'string'
      ? packageJson.types
      : typeof legacyPackageJson.typings === 'string'
        ? legacyPackageJson.typings
        : undefined
  if (typeDef) {
    rootExport.types = resolveLegacyPackageTarget(rootDir, typeDef)
  }
  if (typeof packageJson.browser === 'string') {
    rootExport.browser = resolveLegacyPackageTarget(
      rootDir,
      packageJson.browser,
    )
  }
  if (typeof packageJson.module === 'string') {
    const module = resolveLegacyPackageTarget(rootDir, packageJson.module)
    if (isNodeEsmTarget(module, packageJson.type)) {
      rootExport.import = module
    } else {
      rootExport.module = module
      rootExport.require = main
    }
  } else if (packageJson.type === 'module') {
    rootExport.import = main
  } else {
    rootExport.require = main
  }
  // Node ignores the legacy `module` field. CommonJS resolution reaches the
  // main entry through `node`, while ESM reaches `import` above when present.
  rootExport.node = main
  rootExport.default = main
  return rootExport
}

function normalizePackageTarget(target: string) {
  return target.startsWith('./') ? target : `./${target}`
}

function resolveLegacyPackageTarget(rootDir: string, target: string) {
  try {
    const resolvedTarget = createRequire(join(rootDir, 'package.json')).resolve(
      resolve(rootDir, target),
    )
    const relativeTarget = relative(rootDir, resolvedTarget)
    if (
      relativeTarget.length > 0 &&
      relativeTarget !== '..' &&
      !relativeTarget.startsWith(`..${sep}`) &&
      !resolve(rootDir, relativeTarget).startsWith(
        `${resolve(rootDir)}${sep}node_modules}${sep}`,
      )
    ) {
      return normalizePackageTarget(relativeTarget.split(sep).join('/'))
    }
  } catch {
    // Preserve the legacy value so root validation can report the missing path.
  }
  return normalizePackageTarget(target)
}

function isNodeEsmTarget(
  target: string,
  packageType: CommonPackageJsonFields['type'],
) {
  const extension = extname(target)
  return (
    extension === '.mjs' || (extension === '.js' && packageType === 'module')
  )
}

function createLegacyDeepImportExports(rootDir: string) {
  const packedFiles = readNpmPackFiles(rootDir, 'root package')
  const exportsMap: Record<string, string> = {}
  const matchingFiles = [...packedFiles]
    .filter((file) =>
      LEGACY_DEEP_IMPORT_EXTENSIONS.some((extension) =>
        file.endsWith(extension),
      ),
    )
    .sort()

  for (const extension of LEGACY_DEEP_IMPORT_EXTENSIONS) {
    for (const file of matchingFiles.filter((file) =>
      file.endsWith(extension),
    )) {
      const target = `./${file}`
      const extensionless = `./${file.slice(0, -extension.length)}`
      exportsMap[extensionless] ??= target
    }
  }

  for (const packageManifest of matchingFiles.filter((file) =>
    file.endsWith('/package.json'),
  )) {
    const directory = dirname(packageManifest).split(sep).join('/')
    const target = resolveLegacyPackageTarget(rootDir, directory)
    if (packedFiles.has(target.slice(2))) {
      exportsMap[`./${directory}`] ??= target
    }
  }

  for (const extension of LEGACY_DEEP_IMPORT_EXTENSIONS) {
    for (const file of matchingFiles.filter((file) =>
      file.endsWith(extension),
    )) {
      const indexSuffix = `/index${extension}`
      if (file.endsWith(indexSuffix)) {
        const directory = `./${file.slice(0, -indexSuffix.length)}`
        exportsMap[directory] ??= `./${file}`
      }
    }
  }

  return exportsMap
}

function isGeneratedLegacyDeepImportExport(key: string, value: unknown) {
  if (typeof value !== 'string') {
    return false
  }
  return LEGACY_DEEP_IMPORT_EXTENSIONS.some(
    (extension) =>
      value === `${key}${extension}` ||
      value === `${key}/index${extension}` ||
      (value.startsWith(`${key}/`) &&
        !value.slice(key.length + 1).includes('..')),
  )
}

function collectRootPackagePathReferences(
  packageJson: CommonPackageJsonFields,
) {
  const files = new Set<string>()
  addLegacyPackageFileReference(files, packageJson.main)
  if (packageJson.main === undefined && packageJson.exports === undefined) {
    addLegacyPackageFileReference(files, 'index.js')
  }
  addLegacyPackageFileReference(files, packageJson.module)
  addLegacyPackageFileReference(files, packageJson.types)
  addLegacyPackageFileReference(
    files,
    (packageJson as CommonPackageJsonFields & { typings?: unknown }).typings,
  )
  addLegacyPackageFileReference(files, packageJson.browser)
  collectRootExportFileReferences(files, packageJson.exports)

  const publishConfig = asRecord(packageJson.publishConfig)
  if (
    publishConfig &&
    Object.prototype.hasOwnProperty.call(publishConfig, 'exports')
  ) {
    collectRootExportFileReferences(files, publishConfig.exports)
  }
  return [...files]
}

function addLegacyPackageFileReference(files: Set<string>, target: unknown) {
  if (typeof target === 'string') {
    addPackageFileReference(files, normalizePackageTarget(target))
  }
}

function collectRootExportFileReferences(
  files: Set<string>,
  exportsField: unknown,
) {
  const exportsMap = asRecord(exportsField)
  if (
    exportsMap &&
    Object.keys(exportsMap).some((key) => key.startsWith('.'))
  ) {
    for (const [subpath, target] of Object.entries(exportsMap)) {
      if (
        !subpath.includes('*') &&
        !THREADLESS_WASI_ROOT_SUBPATHS.has(subpath)
      ) {
        collectPackageTargetFileReferences(files, target)
      }
    }
    return
  }
  collectPackageTargetFileReferences(files, exportsField)
}

function collectPackageTargetFileReferences(
  files: Set<string>,
  target: unknown,
) {
  if (typeof target === 'string') {
    addPackageFileReference(files, target)
  } else if (Array.isArray(target)) {
    for (const entry of target) {
      collectPackageTargetFileReferences(files, entry)
    }
  } else if (typeof target === 'object' && target !== null) {
    for (const entry of Object.values(target)) {
      collectPackageTargetFileReferences(files, entry)
    }
  }
}

function addPackageFileReference(files: Set<string>, target: string) {
  if (
    !target.startsWith('./') ||
    target.includes('*') ||
    target.endsWith('/')
  ) {
    return
  }
  const file = target.slice(2).replaceAll('\\', '/')
  if (
    file.length === 0 ||
    file.split('/').some((segment) => segment === '..')
  ) {
    return
  }
  files.add(file)
}

interface PackagePath {
  path: string
  directory: boolean
}

function validateRootPackagePaths(
  rootDir: string,
  files: string[],
): PackagePath[] {
  const paths: PackagePath[] = []
  for (const file of new Set(files)) {
    const path = join(rootDir, file)
    if (!existsSync(path)) {
      throw new Error(`Root release package is incomplete: missing ${file}`)
    }
    paths.push({ path: file, directory: statSync(path).isDirectory() })
  }
  return paths
}

function readNpmPackFiles(packageDir: string, packageDescription: string) {
  try {
    const output = execSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: packageDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const packResult = JSON.parse(output) as {
      files?: { path?: unknown }[]
    }[]
    if (!Array.isArray(packResult) || !Array.isArray(packResult[0]?.files)) {
      throw new Error('npm pack returned an unexpected JSON result')
    }
    return new Set(
      packResult[0].files
        .map(({ path }) => path)
        .filter((path): path is string => typeof path === 'string')
        .map((path) => path.replaceAll('\\', '/').replace(/^\.\//, '')),
    )
  } catch (error) {
    throw new Error(
      `Failed to validate the ${packageDescription} with npm pack --dry-run. Ensure npm is available and the package can be packed.`,
      { cause: error },
    )
  }
}

function validateRootFacadePacklist(
  rootDir: string,
  rootPackageFiles: string[],
) {
  const paths = validateRootPackagePaths(rootDir, rootPackageFiles)
  const packedFiles = readNpmPackFiles(rootDir, 'threadless WASI root package')

  const missingPaths = paths
    .filter(({ path, directory }) => {
      const normalizedPath = path.replaceAll('\\', '/')
      return directory
        ? ![...packedFiles].some((file) =>
            file.startsWith(`${normalizedPath}/`),
          )
        : !packedFiles.has(normalizedPath)
    })
    .map(({ path }) => path)
  if (missingPaths.length > 0) {
    throw new Error(
      `The threadless WASI root package references paths omitted by npm pack: ${missingPaths.join(', ')}. Add them to package.json "files" or remove the matching .npmignore rules.`,
    )
  }
}

interface ReleasePackageValidationOptions {
  pkgDir: string
  rootDir: string
  packageName: string
  binaryName: string
  target: Target
  requireDirectBufferDependency: boolean
  materializeDeclarationDependencies: boolean
}

interface ReleasePackageManifest {
  name?: string
  type?: unknown
  cpu?: unknown
  os?: unknown
  main?: unknown
  types?: unknown
  browser?: unknown
  files?: unknown
  exports?: unknown
  dependencies?: unknown
}

async function validateReleasePackage({
  pkgDir,
  materializeDeclarationDependencies,
  ...options
}: ReleasePackageValidationOptions) {
  const packageJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `Release package manifest does not exist: ${packageJsonPath}`,
    )
  }
  if (materializeDeclarationDependencies) {
    return validateReleasePackageContents({
      ...options,
      pkgDir,
      materializeDeclarationDependencies,
    })
  }

  const stagingRoot = await mkdtemp(
    join(tmpdir(), 'napi-rs-pre-publish-validation-'),
  )
  const stagedPkgDir = join(stagingRoot, 'package')
  try {
    await cp(pkgDir, stagedPkgDir, { recursive: true })
    await validateReleasePackageContents({
      ...options,
      pkgDir: stagedPkgDir,
      materializeDeclarationDependencies: true,
    })
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

async function validateReleasePackageContents({
  pkgDir,
  rootDir,
  packageName,
  binaryName,
  target,
  requireDirectBufferDependency,
  materializeDeclarationDependencies,
}: ReleasePackageValidationOptions) {
  const packageJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `Release package manifest does not exist: ${packageJsonPath}`,
    )
  }

  let packageJson: ReleasePackageManifest
  try {
    packageJson = JSON.parse(await readFileAsync(packageJsonPath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to read release package ${packageJsonPath}`, {
      cause: error,
    })
  }

  const expectedPackageName = `${packageName}-${target.platformArchABI}`
  if (packageJson.name !== expectedPackageName) {
    throw new Error(
      `Release package ${pkgDir} has stale package name ${String(packageJson.name)}; expected ${expectedPackageName}`,
    )
  }

  if (
    !Array.isArray(packageJson.files) ||
    !packageJson.files.every((file): file is string => typeof file === 'string')
  ) {
    throw new Error(
      `Release package ${expectedPackageName} must declare a string files array`,
    )
  }
  const packageFiles = [...new Set(packageJson.files)]

  validateExpectedReleasePackageManifest(
    packageJson,
    packageFiles,
    binaryName,
    target,
    requireDirectBufferDependency,
  )

  for (const file of packageFiles) {
    const path = join(pkgDir, file)
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(
        `Release package ${expectedPackageName} is incomplete: missing ${file}`,
      )
    }
  }

  const declarationFiles = await completeDeclarationDependencyClosure({
    pkgDir,
    rootDir,
    packageName: expectedPackageName,
    packageFiles,
    materialize: materializeDeclarationDependencies,
  })
  if (declarationFiles.length > packageFiles.length) {
    packageFiles.splice(0, packageFiles.length, ...declarationFiles)
    if (materializeDeclarationDependencies) {
      packageJson.files = packageFiles
      await writeFileAsync(
        packageJsonPath,
        `${JSON.stringify(packageJson, null, 2)}\n`,
      )
    }
  }

  const publicFiles = new Set<string>(packageFiles)
  addLegacyPackageFileReference(publicFiles, packageJson.main)
  addLegacyPackageFileReference(publicFiles, packageJson.types)
  addLegacyPackageFileReference(publicFiles, packageJson.browser)
  collectPackageTargetFileReferences(publicFiles, packageJson.exports)
  publicFiles.add('package.json')

  const packedFiles = readNpmPackFiles(
    pkgDir,
    `release package ${expectedPackageName}`,
  )
  const omittedFiles = [...publicFiles].filter(
    (file) => !packedFiles.has(file.replaceAll('\\', '/')),
  )
  if (omittedFiles.length > 0) {
    throw new Error(
      `Release package ${expectedPackageName} references files omitted by npm pack: ${omittedFiles.join(', ')}`,
    )
  }
}

function validateExpectedReleasePackageManifest(
  packageJson: ReleasePackageManifest,
  packageFiles: string[],
  binaryName: string,
  target: Target,
  requireDirectBufferDependency: boolean,
) {
  const isWasm = target.arch === 'wasm32'
  const artifactExtension = isWasm ? 'wasm' : 'node'
  const artifact = `${binaryName}.${target.platformArchABI}.${artifactExtension}`
  const expectedFiles = [artifact]
  const expectedMain = isWasm
    ? `${binaryName}.${wasiLoaderSuffix(target.platformArchABI)}.cjs`
    : artifact

  if (packageJson.main !== expectedMain) {
    throw new Error(
      `Release package ${packageJson.name} has stale main entry ${String(packageJson.main)}; expected ${expectedMain}`,
    )
  }

  if (isWasm) {
    validateWasiReleasePackageManifest(
      packageJson,
      requireDirectBufferDependency,
    )
    const loaderSuffix = wasiLoaderSuffix(target.platformArchABI)
    const expectedTypes = `${binaryName}.${loaderSuffix}.d.cts`
    const expectedBrowser = `${binaryName}.${loaderSuffix}-browser.js`
    expectedFiles.push(expectedMain, expectedTypes, expectedBrowser)
    if (packageJson.types !== expectedTypes) {
      throw new Error(
        `Release package ${packageJson.name} has stale types entry ${String(packageJson.types)}; expected ${expectedTypes}`,
      )
    }
    if (packageJson.browser !== expectedBrowser) {
      throw new Error(
        `Release package ${packageJson.name} has stale browser entry ${String(packageJson.browser)}; expected ${expectedBrowser}`,
      )
    }
    if (wasiTargetHasThreads(target)) {
      expectedFiles.push('wasi-worker.mjs', 'wasi-worker-browser.mjs')
      if (packageJson.exports !== undefined) {
        throw new Error(
          `Release package ${packageJson.name} must omit exports for its threaded WASI legacy entries`,
        )
      }
    } else {
      const deferredEntry = `${binaryName}.${loaderSuffix}-deferred.js`
      const deferredTypeDef = `${binaryName}.${loaderSuffix}-deferred.d.ts`
      const wasmTypeDef = `${artifact}.d.ts`
      expectedFiles.push(deferredEntry, deferredTypeDef, wasmTypeDef)
      const exportsMap = asRecord(packageJson.exports)
      const expectedExports = {
        '.': {
          types: `./${expectedTypes}`,
          browser: `./${expectedBrowser}`,
          require: `./${expectedMain}`,
          default: `./${expectedMain}`,
        },
        './workerd': {
          types: `./${deferredTypeDef}`,
          default: `./${deferredEntry}`,
        },
        './wasm': {
          types: `./${wasmTypeDef}`,
          default: `./${artifact}`,
        },
        './wasm.wasm': {
          types: `./${wasmTypeDef}`,
          default: `./${artifact}`,
        },
        './package.json': './package.json',
      }
      for (const [subpath, expectedExport] of Object.entries(expectedExports)) {
        if (!isDeepStrictEqual(exportsMap?.[subpath], expectedExport)) {
          throw new Error(
            `Release package ${packageJson.name} has a stale or invalid ${subpath} export`,
          )
        }
      }
    }
  }

  const missingExpectedFiles = expectedFiles.filter(
    (file) => !packageFiles.includes(file),
  )
  if (missingExpectedFiles.length > 0) {
    throw new Error(
      `Release package ${packageJson.name} does not publish required files: ${missingExpectedFiles.join(', ')}`,
    )
  }
}

function validateWasiReleasePackageManifest(
  packageJson: ReleasePackageManifest,
  requireDirectBufferDependency: boolean,
) {
  if (packageJson.type !== 'module') {
    throw new Error(
      `Release package ${packageJson.name} must declare type module for its WASI JavaScript loaders`,
    )
  }
  if (packageJson.cpu !== undefined) {
    throw new Error(
      `Release package ${packageJson.name} must omit cpu so WASI can run on any host architecture`,
    )
  }
  if (packageJson.os !== undefined) {
    throw new Error(
      `Release package ${packageJson.name} must omit os so WASI can run on any host operating system`,
    )
  }

  const dependencies = asRecord(packageJson.dependencies)
  if (!dependencies) {
    throw new Error(
      `Release package ${packageJson.name} must declare WASI runtime dependencies`,
    )
  }

  const wasmRuntimeVersion = requireStringDependency(
    packageJson.name,
    dependencies,
    '@napi-rs/wasm-runtime',
  )
  try {
    new Range(wasmRuntimeVersion)
  } catch {
    throw new Error(
      `Release package ${packageJson.name} has invalid @napi-rs/wasm-runtime dependency ${wasmRuntimeVersion}`,
    )
  }

  const emnapiVersion = require('emnapi/package.json').version
  for (const dependency of ['@emnapi/core', '@emnapi/runtime']) {
    const dependencyVersion = requireStringDependency(
      packageJson.name,
      dependencies,
      dependency,
    )
    if (dependencyVersion !== emnapiVersion) {
      throw new Error(
        `Release package ${packageJson.name} must declare ${dependency} ${emnapiVersion}; found ${dependencyVersion}`,
      )
    }
  }

  if (requireDirectBufferDependency) {
    const bufferVersion = requireStringDependency(
      packageJson.name,
      dependencies,
      'buffer',
    )
    if (bufferVersion !== directBufferDependency) {
      throw new Error(
        `Release package ${packageJson.name} must declare buffer ${directBufferDependency}; found ${bufferVersion}`,
      )
    }
  }
}

function requireStringDependency(
  packageName: string | undefined,
  dependencies: Record<string, unknown>,
  dependency: string,
) {
  const version = dependencies[dependency]
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error(
      `Release package ${packageName} must declare dependency ${dependency}`,
    )
  }
  return version.trim()
}

interface DeclarationDependencyClosureOptions {
  pkgDir: string
  rootDir: string
  packageName: string
  packageFiles: string[]
  materialize: boolean
}

async function completeDeclarationDependencyClosure({
  pkgDir,
  rootDir,
  packageName,
  packageFiles,
  materialize,
}: DeclarationDependencyClosureOptions) {
  const includedFiles = new Set(packageFiles)
  const queue = packageFiles.filter(isDeclarationFile)
  const visited = new Set<string>()

  while (queue.length > 0) {
    const declarationFile = queue.shift()!
    if (visited.has(declarationFile)) {
      continue
    }
    visited.add(declarationFile)
    const declaration = await readFileAsync(
      join(pkgDir, declarationFile),
      'utf8',
    )
    for (const specifier of extractRelativeDeclarationSpecifiers(declaration)) {
      const dependency = resolveDeclarationDependency(
        pkgDir,
        declarationFile,
        specifier,
      )
      const sourceDependency =
        dependency ??
        resolveDeclarationDependency(rootDir, declarationFile, specifier)
      if (!sourceDependency) {
        throw new Error(
          `Release package ${packageName} declaration ${declarationFile} references missing ${specifier}`,
        )
      }
      if (!dependency) {
        if (!materialize) {
          throw new Error(
            `Release package ${packageName} is not self-contained: ${declarationFile} depends on ${sourceDependency}`,
          )
        }
        const destination = join(pkgDir, sourceDependency)
        await mkdirAsync(dirname(destination), { recursive: true })
        await copyFileAsync(join(rootDir, sourceDependency), destination)
      }
      if (!includedFiles.has(sourceDependency)) {
        includedFiles.add(sourceDependency)
        if (isDeclarationFile(sourceDependency)) {
          queue.push(sourceDependency)
        }
      }
    }
  }
  return [...includedFiles]
}

function extractRelativeDeclarationSpecifiers(source: string) {
  const specifiers = new Set<string>()
  const { tokens, references } = scanDeclaration(source)

  for (const reference of references) {
    if (reference.startsWith('.')) {
      specifiers.add(reference)
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    let specifier: string | undefined

    if (token.kind === 'identifier' && token.value === 'from') {
      const next = tokens[index + 1]
      if (next?.kind === 'string') {
        specifier = next.value
      }
    } else if (token.kind === 'identifier' && token.value === 'import') {
      const next = tokens[index + 1]
      if (next?.kind === 'string') {
        specifier = next.value
      } else if (
        next?.kind === 'punctuator' &&
        next.value === '(' &&
        tokens[index + 2]?.kind === 'string'
      ) {
        specifier = tokens[index + 2].value
      }
    } else if (
      token.kind === 'identifier' &&
      token.value === 'require' &&
      tokens[index + 1]?.kind === 'punctuator' &&
      tokens[index + 1].value === '(' &&
      tokens[index + 2]?.kind === 'string'
    ) {
      specifier = tokens[index + 2].value
    }

    if (specifier?.startsWith('.')) {
      specifiers.add(specifier)
    }
  }
  return specifiers
}

interface DeclarationToken {
  kind: 'identifier' | 'string' | 'punctuator'
  value: string
}

function scanDeclaration(source: string) {
  const tokens: DeclarationToken[] = []
  const references: string[] = []
  let index = 0
  let onlyWhitespaceOnLine = true
  let allowReferenceDirectives = true

  function addToken(token: DeclarationToken) {
    tokens.push(token)
    allowReferenceDirectives = false
    onlyWhitespaceOnLine = false
  }

  function scanCode(stopAtTemplateExpression = false) {
    let braceDepth = 0

    while (index < source.length) {
      const current = source[index]
      const next = source[index + 1]

      if (current === '\r' || current === '\n') {
        if (current === '\r' && next === '\n') {
          index += 1
        }
        index += 1
        onlyWhitespaceOnLine = true
        continue
      }
      if (
        current === ' ' ||
        current === '\t' ||
        current === '\v' ||
        current === '\f'
      ) {
        index += 1
        continue
      }

      if (current === '/' && next === '/') {
        const commentStartsLine = onlyWhitespaceOnLine
        const commentStart = index
        index += 2
        while (
          index < source.length &&
          source[index] !== '\r' &&
          source[index] !== '\n'
        ) {
          index += 1
        }
        if (allowReferenceDirectives && commentStartsLine) {
          const reference = parseTripleSlashReference(
            source.slice(commentStart, index),
          )
          if (reference) {
            references.push(reference)
          }
        }
        onlyWhitespaceOnLine = false
        continue
      }

      if (current === '/' && next === '*') {
        index += 2
        onlyWhitespaceOnLine = false
        while (index < source.length) {
          if (source[index] === '*' && source[index + 1] === '/') {
            index += 2
            break
          }
          if (source[index] === '\r' || source[index] === '\n') {
            if (source[index] === '\r' && source[index + 1] === '\n') {
              index += 1
            }
            onlyWhitespaceOnLine = true
          }
          index += 1
        }
        onlyWhitespaceOnLine = false
        continue
      }

      if (current === "'" || current === '"') {
        addToken({
          kind: 'string',
          value: readDeclarationString(current),
        })
        continue
      }

      if (current === '`') {
        allowReferenceDirectives = false
        onlyWhitespaceOnLine = false
        scanTemplate()
        continue
      }

      if (isDeclarationIdentifierStart(current)) {
        const start = index
        index += 1
        while (
          index < source.length &&
          isDeclarationIdentifierPart(source[index])
        ) {
          index += 1
        }
        addToken({
          kind: 'identifier',
          value: source.slice(start, index),
        })
        continue
      }

      if (stopAtTemplateExpression && current === '}') {
        if (braceDepth === 0) {
          index += 1
          return
        }
        braceDepth -= 1
      } else if (stopAtTemplateExpression && current === '{') {
        braceDepth += 1
      }

      addToken({ kind: 'punctuator', value: current })
      index += 1
    }
  }

  function readDeclarationString(quote: "'" | '"') {
    let value = ''
    index += 1
    while (index < source.length) {
      const current = source[index]
      if (current === '\\') {
        value += current
        if (index + 1 < source.length) {
          value += source[index + 1]
          index += 2
        } else {
          index += 1
        }
        continue
      }
      if (current === quote) {
        index += 1
        break
      }
      value += current
      index += 1
    }
    return value
  }

  function scanTemplate() {
    index += 1
    while (index < source.length) {
      const current = source[index]
      const next = source[index + 1]
      if (current === '\\') {
        index += Math.min(2, source.length - index)
        continue
      }
      if (current === '`') {
        index += 1
        return
      }
      if (current === '$' && next === '{') {
        index += 2
        scanCode(true)
        continue
      }
      if (current === '\r' || current === '\n') {
        if (current === '\r' && next === '\n') {
          index += 1
        }
        onlyWhitespaceOnLine = true
      } else {
        onlyWhitespaceOnLine = false
      }
      index += 1
    }
  }

  scanCode()
  return { tokens, references }
}

function parseTripleSlashReference(comment: string) {
  const match =
    /^\/\/\/\s*<reference\s+path\s*=\s*(['"])([^'"]+)\1.*?\/>\s*$/.exec(comment)
  return match?.[2]
}

function isDeclarationIdentifierStart(value: string) {
  const code = value.charCodeAt(0)
  return (
    value === '$' ||
    value === '_' ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  )
}

function isDeclarationIdentifierPart(value: string) {
  const code = value.charCodeAt(0)
  return isDeclarationIdentifierStart(value) || (code >= 48 && code <= 57)
}

function resolveDeclarationDependency(
  baseDir: string,
  declarationFile: string,
  specifier: string,
) {
  const unresolved = resolve(dirname(join(baseDir, declarationFile)), specifier)
  const unresolvedRelative = relative(baseDir, unresolved)
  const nodeModulesDir = join(resolve(baseDir), 'node_modules')
  if (
    unresolvedRelative === '..' ||
    unresolvedRelative.startsWith(`..${sep}`) ||
    unresolved === nodeModulesDir ||
    unresolved.startsWith(`${nodeModulesDir}${sep}`)
  ) {
    return undefined
  }

  for (const candidate of declarationDependencyCandidates(unresolved)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(baseDir, candidate).split(sep).join('/')
    }
  }
  return undefined
}

function declarationDependencyCandidates(unresolved: string) {
  if (isDeclarationFile(unresolved)) {
    return [unresolved]
  }
  const extension = extname(unresolved)
  if (extension === '.cjs') {
    return [`${unresolved.slice(0, -extension.length)}.d.cts`]
  }
  if (extension === '.mjs') {
    return [`${unresolved.slice(0, -extension.length)}.d.mts`]
  }
  if (extension === '.js' || extension === '.jsx') {
    return [`${unresolved.slice(0, -extension.length)}.d.ts`]
  }
  if (extension.length > 0) {
    return [unresolved]
  }
  return [
    ...DECLARATION_EXTENSIONS.map((candidate) => `${unresolved}${candidate}`),
    ...DECLARATION_EXTENSIONS.map((candidate) =>
      join(unresolved, `index${candidate}`),
    ),
  ]
}

function isDeclarationFile(file: string) {
  return DECLARATION_EXTENSIONS.some((extension) => file.endsWith(extension))
}

function parseTag(tag: string) {
  const segments = tag.split('@')
  const version = segments.pop()!
  const name = segments.join('@')

  return {
    name,
    version,
    tag,
  }
}
