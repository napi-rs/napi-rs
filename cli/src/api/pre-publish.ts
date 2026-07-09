import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdtemp,
  readdir,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
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
  collectRelativeDeclarationSpecifiers,
  commitFileSystemTransaction,
  createWasmModuleTypeDef,
  copyFileAtomic,
  debugFactory,
  MINIMUM_WASI_NODE_VERSION,
  mkdirAsync,
  restrictWasiNodeEngine,
  resolvePackageReconciliationPaths,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  writeFileAtomic,
  withFileSystemReconciliation,
  AVAILABLE_TARGETS,
  parseTriple,
  type CommonPackageJsonFields,
  type FileSystemTransactionWrite,
  type Target,
} from '../utils/index.js'

const debug = debugFactory('pre-publish')
const THREADLESS_WASI_ROOT_SUBPATHS = new Set([
  './workerd',
  './wasm',
  './wasm.wasm',
])
const MANAGED_OPTIONAL_DEPENDENCY_SUFFIXES = new Set(
  AVAILABLE_TARGETS.map((target) => parseTriple(target).platformArchABI),
)
const LEGACY_DEEP_IMPORT_EXTENSIONS = ['.js', '.json', '.node']
const DECLARATION_EXTENSIONS = ['.d.ts', '.d.cts', '.d.mts']
const RECONCILIATION_STATE_PREFIXES = [
  '.napi-rs-filesystem-reconciliation',
  '.napi-rs-filesystem-transaction',
]
const PUBLICATION_CONTEXT_EXCLUDED_NAMES = new Set(['.git'])
const PUBLICATION_CONTEXT_FILES = [
  '.npmrc',
  '.pnp.cjs',
  '.pnp.loader.mjs',
  '.pnpmfile.cjs',
  '.yarnrc',
  '.yarnrc.yml',
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
]
const PUBLICATION_LIFECYCLE_SCRIPTS = [
  'prepublish',
  'prepare',
  'prepublishOnly',
  'prepack',
  'postpack',
  'publish',
  'postpublish',
]
const WASI_ROOT_FACADE_MARKER_PREFIX = '// napi-rs-wasi-root-facade:'
const directBufferDependency = '^6.0.3'
const wasiRuntimeDependencies = [
  '@napi-rs/wasm-runtime',
  '@emnapi/core',
  '@emnapi/runtime',
  'buffer',
]
const require = createRequire(import.meta.url)
type TypeScriptModule = typeof import('typescript')
let loadedTypeScript: TypeScriptModule | undefined

interface PackageInfo {
  name: string
  version: string
  tag: string
}

interface PreparedReleasePackage {
  artifactPath: string
  filename: string
  packageDir: string
}

interface PreparedPrePublish {
  npmClient: string
  packageName: string
  packageVersion: string
  releasePackages: PreparedReleasePackage[]
  workspaceRoot?: string
}

async function removePreparedSnapshot(
  snapshotRoot: string,
  phase: 'preparation' | 'publication',
  primaryFailed: boolean,
  primaryError?: unknown,
) {
  try {
    await removeOwnedTemporaryTree(snapshotRoot)
  } catch (cleanupError) {
    if (primaryFailed) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `Pre-publish ${phase} failed and its prepared snapshot could not be removed from ${snapshotRoot}`,
        { cause: primaryError },
      )
    }
    debug.warn(
      `Pre-publish ${phase} completed, but its prepared snapshot could not be removed from ${snapshotRoot}: ${String(cleanupError)}`,
    )
    return
  }
  if (primaryFailed) {
    throw primaryError
  }
}

async function removeOwnedTemporaryTree(root: string) {
  try {
    await rm(root, { recursive: true, force: true })
    return
  } catch (initialError) {
    if (
      !['EACCES', 'EPERM'].includes(
        (initialError as NodeJS.ErrnoException).code ?? '',
      )
    ) {
      throw initialError
    }
    try {
      await makeOwnedTemporaryDirectoriesWritable(root)
      await rm(root, { recursive: true, force: true })
      return
    } catch (retryError) {
      throw new AggregateError(
        [initialError, retryError],
        `Prepared snapshot could not be removed from ${root} after restoring directory permissions`,
        { cause: initialError },
      )
    }
  }
}

async function makeOwnedTemporaryDirectoriesWritable(root: string) {
  let stats
  try {
    stats = await lstat(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!stats.isDirectory()) {
    throw new Error(`Prepared snapshot path is not a directory: ${root}`)
  }

  try {
    await chmod(root, stats.mode | 0o700)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await makeOwnedTemporaryDirectoriesWritable(join(root, entry.name))
    }
  }
}

async function copyOwnedTemporaryPath(source: string, destination: string) {
  await cp(source, destination, { recursive: true })
  const stats = await lstat(destination)
  if (stats.isDirectory()) {
    await makeOwnedTemporaryDirectoriesWritable(destination)
  }
}

export async function prePublish(userOptions: PrePublishOptions) {
  debug('Receive pre-publish options:')
  debug('  %O', userOptions)

  const options = applyDefaultPrePublishOptions(userOptions)

  const resolvedPaths = resolvePackageReconciliationPaths(
    options.cwd,
    options.packageJsonPath,
    [options.npmDir],
  )
  const {
    boundary: reconciliationRoot,
    packageJsonPath,
    packageRoot: rootDir,
  } = resolvedPaths
  const npmDir = resolvedPaths.managedPaths[0]
  let preparedSnapshotRoot: string | undefined
  let prepared: PreparedPrePublish
  try {
    prepared = await withFileSystemReconciliation(
      reconciliationRoot,
      async () => {
        const {
          packageJson,
          targets,
          packageName,
          binaryName,
          npmClient,
          wasm,
        } = await readNapiConfig(
          packageJsonPath,
          options.configPath
            ? resolve(options.cwd, options.configPath)
            : undefined,
        )
        const threadlessWasiTarget = targets.find(
          (target) =>
            target.platform === 'wasi' && !wasiTargetHasThreads(target),
        )

        let preparedWorkspaceRoot: string | undefined
        if (!options.dryRun) {
          preparedSnapshotRoot = await mkdtemp(
            join(tmpdir(), 'napi-rs-pre-publish-stage-'),
          )
          preparedWorkspaceRoot = join(preparedSnapshotRoot, 'workspace')
        }
        const releasePackagePlans: ReleasePackageMaterializationPlan[] = []
        for (const target of targets) {
          const pkgDir = join(npmDir, target.platformArchABI)
          const validationOptions: ReleasePackageValidationOptions = {
            pkgDir,
            rootDir,
            packageName,
            binaryName,
            target,
            requireDirectBufferDependency:
              wasm?.browser?.buffer === true &&
              (wasm.browser.fs !== true || !wasiTargetHasThreads(target)),
          }
          releasePackagePlans.push(
            preparedWorkspaceRoot
              ? await stageReleasePackage(
                  preparedWorkspaceRoot,
                  reconciliationRoot,
                  packageJson.version,
                  validationOptions,
                )
              : await validateReleasePackage(validationOptions),
          )
        }
        const rootFacadeReconciliation = reconcileThreadlessWasiRootFacade(
          packageJson,
          rootDir,
          npmDir,
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
            npmDir,
            managedGeneratedFiles: rootFacadeReconciliation.staleGeneratedFiles,
          })
          const stagedThreadlessPackage = releasePackagePlans.find(
            (plan) =>
              plan.target.platformArchABI ===
              threadlessWasiTarget.platformArchABI,
          )?.stagedPkgDir
          if (stagedThreadlessPackage) {
            const stagedWasmSourcePath = join(
              stagedThreadlessPackage,
              `${binaryName}.${threadlessWasiTarget.platformArchABI}.wasm`,
            )
            rootFacade = {
              ...rootFacade,
              marker: createThreadlessWasiRootFacadeMarker(
                `${packageName}-${threadlessWasiTarget.platformArchABI}`,
                readFileSync(stagedWasmSourcePath),
              ),
              wasmSourcePath: stagedWasmSourcePath,
            }
          }
          reconciledPackageJson = applyThreadlessWasiRootFacade(
            reconciledPackageJson,
            rootFacade,
          )
        }
        const optionalDependencies = {
          ...asRecord(packageJson.optionalDependencies),
        }
        const managedPackageNames = new Set([packageName])
        for (const flavorPackage of rootFacadeReconciliation.managedFlavorPackages) {
          for (const suffix of MANAGED_OPTIONAL_DEPENDENCY_SUFFIXES) {
            const ending = `-${suffix}`
            if (flavorPackage.endsWith(ending)) {
              managedPackageNames.add(flavorPackage.slice(0, -ending.length))
            }
          }
        }
        for (const managedPackageName of managedPackageNames) {
          for (const suffix of MANAGED_OPTIONAL_DEPENDENCY_SUFFIXES) {
            delete optionalDependencies[`${managedPackageName}-${suffix}`]
          }
        }
        for (const target of targets) {
          optionalDependencies[`${packageName}-${target.platformArchABI}`] =
            packageJson.version
        }
        const nodeEngine =
          targets.length > 0 &&
          targets.every((target) => target.platform === 'wasi')
            ? restrictWasiNodeEngine(
                packageJson.engines?.node ?? MINIMUM_WASI_NODE_VERSION,
              )
            : undefined
        const rootReleasePlan: RootReleaseMaterializationPlan = {
          packageJson: reconciledPackageJson,
          optionalDependencies,
          nodeEngine,
          facade: rootFacade,
          staleGeneratedFiles: rootFacadeReconciliation.staleGeneratedFiles,
        }
        if (preparedWorkspaceRoot) {
          const stagedTransactionRoot = join(
            preparedSnapshotRoot!,
            'transaction-root',
          )
          const stagedRootDir = publicationContextPath(
            preparedWorkspaceRoot,
            reconciliationRoot,
            rootDir,
          )
          await stageRootReleasePlan(
            packageJsonPath,
            rootDir,
            stagedRootDir,
            rootReleasePlan,
          )
          await mkdirAsync(stagedTransactionRoot, { recursive: true })
          const stagedRootManifestPath = join(
            stagedTransactionRoot,
            'package.json',
          )
          await copyFile(
            join(stagedRootDir, 'package.json'),
            stagedRootManifestPath,
            constants.COPYFILE_FICLONE,
          )
          if (releasePackagePlans.length > 0) {
            await stagePublicationContext(
              reconciliationRoot,
              preparedWorkspaceRoot,
              rootDir,
              releasePackagePlans,
            )
            await registerPublicationWorkspaces(
              reconciliationRoot,
              preparedWorkspaceRoot,
              releasePackagePlans.map(({ pkgDir }) => pkgDir),
            )
          }
          await commitPrePublishFileSystemTransaction({
            packageJsonPath,
            transactionRoot: reconciliationRoot,
            releasePackagePlans,
            rootDir,
            rootReleasePlan,
            stagedRootManifestPath,
            stagedRootDir,
          })
        } else if (rootFacade) {
          await validateRootReleasePlan(
            packageJsonPath,
            rootDir,
            rootReleasePlan,
          )
        }

        return {
          npmClient,
          packageName,
          packageVersion: packageJson.version,
          releasePackages: releasePackagePlans.map((plan) =>
            prepareReleasePackage(plan, binaryName),
          ),
          workspaceRoot: preparedWorkspaceRoot,
        }
      },
    )
  } catch (error) {
    if (preparedSnapshotRoot) {
      await removePreparedSnapshot(
        preparedSnapshotRoot,
        'preparation',
        true,
        error,
      )
    }
    throw error
  }

  const {
    npmClient,
    packageName,
    packageVersion,
    releasePackages,
    workspaceRoot,
  } = prepared

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

  let publicationFailed = false
  let publicationError: unknown
  try {
    const { owner, repo, pkgInfo, octokit } = options.ghReleaseId
      ? getRepoInfo(packageName, packageVersion)
      : await createGhRelease(packageName, packageVersion)

    for (const releasePackage of releasePackages) {
      const { artifactPath, filename, packageDir } = releasePackage
      let publicationPackageDir = packageDir
      let publicationArtifactPath = artifactPath
      let publicationExecutionRoot: string | undefined
      let releaseFailed = false
      let releaseError: unknown

      try {
        if (!options.dryRun) {
          if (!existsSync(artifactPath)) {
            throw new Error(`Release artifact does not exist: ${artifactPath}`)
          }

          if (!options.skipOptionalPublish) {
            if (!workspaceRoot) {
              throw new Error(
                'Prepared publication workspace is missing for a real publish',
              )
            }
            const publicationExecution =
              await createPublicationExecutionPackage(workspaceRoot, packageDir)
            publicationExecutionRoot = publicationExecution.root
            publicationPackageDir = publicationExecution.packageDir
            publicationArtifactPath = join(publicationPackageDir, filename)
            try {
              const output = execSync(`${npmClient} publish`, {
                cwd: publicationPackageDir,
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
                debug.warn(`${packageDir} has been published, skipping`)
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
              const artifactStats = statSync(publicationArtifactPath)
              const assetInfo = await octokit!.repos.uploadReleaseAsset({
                owner: owner,
                repo: repo,
                name: filename,
                release_id: releaseId,
                mediaType: { format: 'raw' },
                headers: {
                  'content-length': artifactStats.size,
                  'content-type': 'application/octet-stream',
                },
                // @ts-expect-error octokit types are wrong
                data: await readFileAsync(publicationArtifactPath),
              })
              debug.info(`GitHub release created`)
              debug.info(
                `Download URL: %s`,
                assetInfo.data.browser_download_url,
              )
            } catch (e) {
              debug.error(
                `Param: ${JSON.stringify(
                  {
                    owner,
                    repo,
                    tag: pkgInfo.tag,
                    filename: publicationArtifactPath,
                  },
                  null,
                  2,
                )}`,
              )
              debug.error(e)
            }
          }
        }
      } catch (error) {
        releaseFailed = true
        releaseError = error
      }
      if (publicationExecutionRoot) {
        await removePreparedSnapshot(
          publicationExecutionRoot,
          'publication',
          releaseFailed,
          releaseError,
        )
      }
      if (releaseFailed) {
        throw releaseError
      }
    }
  } catch (error) {
    publicationFailed = true
    publicationError = error
  }
  if (preparedSnapshotRoot) {
    await removePreparedSnapshot(
      preparedSnapshotRoot,
      'publication',
      publicationFailed,
      publicationError,
    )
  }
  if (publicationFailed) {
    throw publicationError
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
  managedFlavorPackages: string[]
  packageJson: CommonPackageJsonFields
  staleGeneratedFiles: string[]
}

interface ManagedThreadlessWasiRootFacade {
  files: ThreadlessWasiRootFacadeFiles
  flavorPackage: string
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
  const managedFlavorPackages = new Set<string>()
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
  if (rootExports.managedFlavorPackage) {
    managedFlavorPackages.add(rootExports.managedFlavorPackage)
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
    if (publishConfigExports.managedFlavorPackage) {
      managedFlavorPackages.add(publishConfigExports.managedFlavorPackage)
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
    managedFlavorPackages: [...managedFlavorPackages],
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
  const managedFacade = getManagedThreadlessWasiRootFacadeFiles(
    exportsMap,
    rootDir,
    npmDir,
    packageName,
  )
  if (!exportsMap || !managedFacade) {
    return {
      exports: currentExports,
      generatedFiles: [],
      managedFlavorPackage: undefined,
    }
  }
  const { files: generatedFiles, flavorPackage: managedFlavorPackage } =
    managedFacade

  const nextExports = { ...exportsMap }
  delete nextExports['./workerd']
  delete nextExports['./wasm']
  delete nextExports['./wasm.wasm']
  const keys = Object.keys(nextExports)
  const generatedLegacyExports = createLegacyDeepImportExports(rootDir)
  if (
    Object.prototype.hasOwnProperty.call(nextExports, '.') &&
    nextExports['./*'] === './*' &&
    isDeepStrictEqual(
      nextExports['.'],
      createLegacyRootExport(packageJson, rootDir),
    ) &&
    keys
      .filter((key) => key !== '.' && key !== './*')
      .every(
        (key) =>
          generatedLegacyExports[key] !== undefined &&
          isDeepStrictEqual(nextExports[key], generatedLegacyExports[key]),
      )
  ) {
    return {
      exports: undefined,
      generatedFiles: Object.values(generatedFiles),
      managedFlavorPackage,
    }
  }
  if (keys.length === 1 && keys[0] === '.') {
    return {
      exports: nextExports['.'],
      generatedFiles: Object.values(generatedFiles),
      managedFlavorPackage,
    }
  }
  return {
    exports: keys.length > 0 ? nextExports : undefined,
    generatedFiles: Object.values(generatedFiles),
    managedFlavorPackage,
  }
}

function getManagedThreadlessWasiRootFacadeFiles(
  exportsMap: Record<string, unknown> | undefined,
  rootDir: string,
  npmDir: string,
  packageName: string,
): ManagedThreadlessWasiRootFacade | undefined {
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
  const managedFlavorPackage =
    getManagedThreadlessWasiRootFacadeMarker(rootDir, files) ??
    getPartialManagedThreadlessWasiRootFacadeMarker(rootDir, npmDir, files) ??
    getLegacyThreadlessWasiRootFacade(rootDir, npmDir, files)
  if (managedFlavorPackage) {
    return { files, flavorPackage: managedFlavorPackage }
  }
  if (
    hasPartialOrCorruptThreadlessWasiRootFacade(rootDir, files, flavorPackage)
  ) {
    throw new Error(
      'The threadless WASI root facade is partial or corrupt and ownership cannot be verified. Restore the generated facade files or remove the generated-shaped exports and files before running pre-publish.',
    )
  }
  return undefined
}

function getManagedThreadlessWasiRootFacadeMarker(
  rootDir: string,
  files: ThreadlessWasiRootFacadeFiles,
) {
  const workerdEntry = readRegularFile(join(rootDir, files.workerdEntry))
  const workerdTypeDef = readRegularFile(join(rootDir, files.workerdTypeDef))
  const wasmEntry = readRegularFile(join(rootDir, files.wasmEntry))
  const wasmTypeDef = readRegularFile(join(rootDir, files.wasmTypeDef))
  if (!workerdEntry || !workerdTypeDef || !wasmEntry || !wasmTypeDef) {
    return undefined
  }

  const markedFiles = [workerdEntry, workerdTypeDef, wasmTypeDef].map((file) =>
    parseThreadlessWasiRootFacadeMarker(file.toString('utf8')),
  )
  if (markedFiles.some((file) => file === undefined)) {
    return undefined
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
    return undefined
  }

  const expectedMarker: ThreadlessWasiRootFacadeMarker = {
    version: 1,
    flavorPackage: markedWorkerdEntry.marker.flavorPackage,
    wasmSha256: createHash('sha256').update(wasmEntry).digest('hex'),
  }
  if (!isDeepStrictEqual(markedWorkerdEntry.marker, expectedMarker)) {
    return undefined
  }
  const forwardingModule = createThreadlessWasiRootForwardingModule(
    markedWorkerdEntry.marker.flavorPackage,
  )
  return markedWorkerdEntry.body === forwardingModule &&
    markedWorkerdTypeDef.body === forwardingModule &&
    markedWasmTypeDef.body === createWasmModuleTypeDef()
    ? markedWorkerdEntry.marker.flavorPackage
    : undefined
}

function getPartialManagedThreadlessWasiRootFacadeMarker(
  rootDir: string,
  npmDir: string,
  files: ThreadlessWasiRootFacadeFiles,
) {
  const availableWasmHashes = new Set<string>()
  for (const wasm of [
    readRegularFile(join(rootDir, files.wasmEntry)),
    readRegularFile(join(npmDir, 'wasm32-wasip1', files.wasmEntry)),
  ]) {
    if (wasm) {
      availableWasmHashes.add(createHash('sha256').update(wasm).digest('hex'))
    }
  }
  if (availableWasmHashes.size === 0) {
    return undefined
  }

  const flavorPackages = new Set<string>()
  for (const file of [
    files.workerdEntry,
    files.workerdTypeDef,
    files.wasmTypeDef,
  ]) {
    const contents = readRegularFile(join(rootDir, file))
    if (!contents) {
      continue
    }
    const markedFile = parseThreadlessWasiRootFacadeMarker(
      contents.toString('utf8'),
    )
    if (
      markedFile !== undefined &&
      availableWasmHashes.has(markedFile.marker.wasmSha256)
    ) {
      flavorPackages.add(markedFile.marker.flavorPackage)
    }
  }
  return flavorPackages.size === 1 ? [...flavorPackages][0] : undefined
}

function getLegacyThreadlessWasiRootFacade(
  rootDir: string,
  npmDir: string,
  files: ThreadlessWasiRootFacadeFiles,
) {
  const workerdEntry = readRegularFile(join(rootDir, files.workerdEntry))
  const workerdTypeDef = readRegularFile(join(rootDir, files.workerdTypeDef))
  const wasmEntry = readRegularFile(join(rootDir, files.wasmEntry))
  const wasmTypeDef = readRegularFile(join(rootDir, files.wasmTypeDef))
  const flavorWasmEntry = readRegularFile(
    join(npmDir, 'wasm32-wasip1', files.wasmEntry),
  )
  if (!wasmEntry || !flavorWasmEntry || !wasmEntry.equals(flavorWasmEntry)) {
    return undefined
  }

  const forwardingPackages = new Set<string>()
  for (const [file, contents] of [
    [files.workerdEntry, workerdEntry],
    [files.workerdTypeDef, workerdTypeDef],
  ] as const) {
    if (!existsSync(join(rootDir, file)) && contents === undefined) {
      continue
    }
    const flavorPackage = contents
      ? parseThreadlessWasiRootForwardingModule(contents.toString('utf8'))
      : undefined
    if (!flavorPackage) {
      return undefined
    }
    forwardingPackages.add(flavorPackage)
  }
  if (
    (existsSync(join(rootDir, files.wasmTypeDef)) ||
      wasmTypeDef !== undefined) &&
    wasmTypeDef?.toString('utf8') !== createWasmModuleTypeDef()
  ) {
    return undefined
  }
  return forwardingPackages.size === 1 ? [...forwardingPackages][0] : undefined
}

function hasPartialOrCorruptThreadlessWasiRootFacade(
  rootDir: string,
  files: ThreadlessWasiRootFacadeFiles,
  flavorPackage: string,
) {
  const facadeFiles = Object.values(files).map(
    (file) => [file, readRegularFile(join(rootDir, file))] as const,
  )
  if (facadeFiles.some(([, contents]) => contents === undefined)) {
    return true
  }

  const forwardingModule =
    createThreadlessWasiRootForwardingModule(flavorPackage)
  const expectedLegacyContents = new Map([
    [files.workerdEntry, forwardingModule],
    [files.workerdTypeDef, forwardingModule],
    [files.wasmTypeDef, createWasmModuleTypeDef()],
  ])
  return facadeFiles.some(([file, contents]) => {
    const source = contents!.toString('utf8')
    return (
      source.startsWith(WASI_ROOT_FACADE_MARKER_PREFIX) ||
      source === expectedLegacyContents.get(file)
    )
  })
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

function parseThreadlessWasiRootForwardingModule(source: string) {
  const match = /^export \* from (".+")\n$/.exec(source)
  if (!match) {
    return undefined
  }
  let specifier: unknown
  try {
    specifier = JSON.parse(match[1])
  } catch {
    return undefined
  }
  if (
    typeof specifier !== 'string' ||
    !specifier.endsWith('-wasm32-wasip1/workerd')
  ) {
    return undefined
  }
  return specifier.slice(0, -'/workerd'.length)
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
  await copyFileAtomic(
    facade.wasmSourcePath,
    join(rootDir, facade.files.wasmEntry),
  )
  await Promise.all([
    writeFileAtomic(
      join(rootDir, facade.files.workerdEntry),
      `${facade.marker}\n${facade.forwardingModule}`,
      'utf8',
    ),
    writeFileAtomic(
      join(rootDir, facade.files.workerdTypeDef),
      `${facade.marker}\n${facade.forwardingModule}`,
      'utf8',
    ),
    writeFileAtomic(
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

interface RootReleaseMaterializationPlan {
  packageJson: CommonPackageJsonFields
  optionalDependencies: Record<string, unknown>
  nodeEngine?: string
  facade?: ThreadlessWasiRootFacade
  staleGeneratedFiles: string[]
}

function pathIsWithin(root: string, path: string) {
  const relativePath = relative(resolve(root), resolve(path))
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`))
  )
}

function publicationContextPath(
  workspaceRoot: string,
  contextRoot: string,
  sourcePath: string,
) {
  if (!pathIsWithin(contextRoot, sourcePath)) {
    throw new Error(
      `Publication context path is outside ${contextRoot}: ${sourcePath}`,
    )
  }
  return join(workspaceRoot, relative(contextRoot, sourcePath))
}

async function stagePublicationContext(
  contextRoot: string,
  workspaceRoot: string,
  rootDir: string,
  releasePackagePlans: ReleasePackageMaterializationPlan[],
) {
  const canonicalContextRoot = realpathSync.native(contextRoot)
  const protectedDirectories = releasePackagePlans.map(({ pkgDir }) =>
    realpathSync.native(pkgDir),
  )
  const selection = await collectPublicationContextSelection(
    canonicalContextRoot,
    rootDir,
    releasePackagePlans,
  )
  await materializePublicationContextDirectory(
    canonicalContextRoot,
    workspaceRoot,
    protectedDirectories,
    [
      {
        sourceRoot: canonicalContextRoot,
        destinationRoot: workspaceRoot,
      },
    ],
    selection,
  )
}

interface PublicationPathMapping {
  sourceRoot: string
  destinationRoot: string
}

interface PublicationContextSelection {
  files: Set<string>
  recursiveDirectories: Set<string>
}

async function collectPublicationContextSelection(
  contextRoot: string,
  rootDir: string,
  releasePackagePlans: ReleasePackageMaterializationPlan[],
) {
  const files = new Set<string>()
  const recursiveDirectories = new Set<string>()
  const structuralDirectories = new Set<string>()
  for (const leaf of [
    rootDir,
    ...releasePackagePlans.map(({ pkgDir }) => pkgDir),
  ]) {
    let current = resolve(leaf)
    while (pathIsWithin(contextRoot, current)) {
      structuralDirectories.add(current)
      for (const name of PUBLICATION_CONTEXT_FILES) {
        const path = join(current, name)
        if (existsSync(path)) files.add(path)
      }
      if (current === contextRoot) break
      current = dirname(current)
    }
  }

  const yarnContext = join(contextRoot, '.yarn')
  if (existsSync(yarnContext)) recursiveDirectories.add(yarnContext)

  let hasLifecycleScripts = false
  for (const plan of releasePackagePlans) {
    if (!plan.stagedPkgDir) continue
    const manifest = JSON.parse(
      await readFileAsync(join(plan.stagedPkgDir, 'package.json'), 'utf8'),
    ) as ReleasePackageManifest
    const scripts = asRecord(manifest.scripts)
    if (!scripts) continue
    for (const script of publicationLifecycleScriptCommands(scripts)) {
      hasLifecycleScripts = true
      for (const reference of relativeLifecycleScriptPaths(script)) {
        const path = resolve(plan.pkgDir, reference)
        if (!pathIsWithin(contextRoot, path)) {
          throw new Error(
            `Release package lifecycle script path escapes ${contextRoot}: ${reference}`,
          )
        }
        if (!existsSync(path) || pathIsWithin(plan.pkgDir, path)) continue
        const stats = statSync(path)
        if (stats.isDirectory()) {
          recursiveDirectories.add(path)
        } else if (stats.isFile()) {
          files.add(path)
          const parent = dirname(path)
          if (parent !== contextRoot) recursiveDirectories.add(parent)
        }
      }
    }
  }
  if (hasLifecycleScripts) {
    for (const directory of structuralDirectories) {
      const nodeModules = join(directory, 'node_modules')
      if (existsSync(nodeModules)) recursiveDirectories.add(nodeModules)
    }
  }

  for (const directory of structuralDirectories) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      let target: string
      try {
        target = realpathSync.native(path)
      } catch {
        continue
      }
      if (
        [...recursiveDirectories].some((selectedDirectory) =>
          pathIsWithin(selectedDirectory, target),
        )
      ) {
        files.add(path)
      }
    }
  }

  return { files, recursiveDirectories }
}

function stagedPublicationWorkspacePatterns(
  workspaces: unknown[],
  releaseWorkspaces: string[],
) {
  // Yarn applies negative workspace patterns after positive matches regardless
  // of order. The staged tree is already selectively materialized, so retain
  // positive source patterns and add exact release package paths.
  return [
    ...new Set([
      ...workspaces.filter(
        (workspace) =>
          typeof workspace !== 'string' || !workspace.startsWith('!'),
      ),
      ...releaseWorkspaces,
    ]),
  ]
}

function publicationLifecycleScriptCommands(scripts: Record<string, unknown>) {
  const commands: string[] = []
  const pending = [...PUBLICATION_LIFECYCLE_SCRIPTS]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const name = pending.shift()!
    if (visited.has(name)) continue
    visited.add(name)
    const command = scripts[name]
    if (typeof command !== 'string') continue
    commands.push(command)
    for (const referencedScript of lifecycleRunScriptReferences(command)) {
      if (!visited.has(referencedScript)) pending.push(referencedScript)
    }
  }
  return commands
}

function lifecycleRunScriptReferences(script: string) {
  const references = new Set<string>()
  const pattern =
    /\b(?:npm|pnpm|bun)\s+run(?:-script)?\s+([^\s;&|]+)|\byarn\s+(?:run\s+)?([^\s;&|]+)/gu
  for (const match of script.matchAll(pattern)) {
    references.add(match[1] ?? match[2])
  }
  return references
}

function relativeLifecycleScriptPaths(script: string) {
  const paths = new Set<string>()
  const pattern = /(?:^|[\s"'`=,(])((?:\.\.?[\\/])[^ \t\r\n"'`;&|<>),]+)/gu
  for (const match of script.matchAll(pattern)) {
    paths.add(match[1])
  }
  return paths
}

function publicationContextEntryIsSelected(
  path: string,
  directory: boolean,
  selection?: PublicationContextSelection,
) {
  if (!selection) return true
  if (selection.files.has(path)) return true
  if (
    [...selection.recursiveDirectories].some((root) => pathIsWithin(root, path))
  ) {
    return true
  }
  if (!directory) return false
  return (
    [...selection.recursiveDirectories].some((root) =>
      pathIsWithin(path, root),
    ) || [...selection.files].some((file) => pathIsWithin(path, file))
  )
}

async function materializePublicationContextDirectory(
  sourceDir: string,
  destinationDir: string,
  protectedDirectories: string[],
  mappings: PublicationPathMapping[],
  selection?: PublicationContextSelection,
) {
  if (
    protectedDirectories.some(
      (protectedDirectory) => relative(protectedDirectory, sourceDir) === '',
    )
  ) {
    return
  }
  await mkdirAsync(destinationDir, { recursive: true })
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (
      PUBLICATION_CONTEXT_EXCLUDED_NAMES.has(entry.name) ||
      RECONCILIATION_STATE_PREFIXES.some((prefix) =>
        entry.name.startsWith(prefix),
      )
    ) {
      continue
    }
    const source = join(sourceDir, entry.name)
    const destination = join(destinationDir, entry.name)
    if (
      !publicationContextEntryIsSelected(source, entry.isDirectory(), selection)
    ) {
      continue
    }
    const protectedDescendant = protectedDirectories.some(
      (protectedDirectory) =>
        pathIsWithin(source, protectedDirectory) &&
        relative(source, protectedDirectory) !== '',
    )
    if (existsSync(destination)) {
      if (entry.isDirectory()) {
        await materializePublicationContextDirectory(
          source,
          destination,
          protectedDirectories,
          mappings,
          selection,
        )
      }
      continue
    }
    if (protectedDescendant) {
      await materializePublicationContextDirectory(
        source,
        destination,
        protectedDirectories,
        mappings,
        selection,
      )
    } else if (entry.isDirectory()) {
      await materializePublicationContextDirectory(
        source,
        destination,
        protectedDirectories,
        mappings,
        selection,
      )
    } else if (entry.isSymbolicLink()) {
      await materializePublicationContextSymlink(
        source,
        destination,
        protectedDirectories,
        mappings,
      )
    } else if (entry.isFile()) {
      await copyFile(source, destination, constants.COPYFILE_FICLONE)
    } else {
      throw new Error(`Unsupported publication context entry: ${source}`)
    }
  }
}

async function materializePublicationContextSymlink(
  source: string,
  destination: string,
  protectedDirectories: string[],
  mappings: PublicationPathMapping[],
) {
  const canonicalTarget = realpathSync.native(source)
  const targetStats = statSync(source)
  const mapping = mappings
    .filter(({ sourceRoot }) => pathIsWithin(sourceRoot, canonicalTarget))
    .sort((left, right) => right.sourceRoot.length - left.sourceRoot.length)[0]
  if (mapping) {
    const mappedTarget = join(
      mapping.destinationRoot,
      relative(mapping.sourceRoot, canonicalTarget),
    )
    if (resolve(mappedTarget) === resolve(destination)) {
      throw new Error(`Publication context contains a cyclic link: ${source}`)
    }
    await mkdirAsync(dirname(destination), { recursive: true })
    const linkTarget =
      process.platform === 'win32' && targetStats.isDirectory()
        ? mappedTarget
        : relative(dirname(destination), mappedTarget) || '.'
    await symlink(
      linkTarget,
      destination,
      targetStats.isDirectory() ? 'junction' : 'file',
    )
    return
  }

  if (
    mappings.some(({ sourceRoot }) => pathIsWithin(canonicalTarget, sourceRoot))
  ) {
    throw new Error(
      `Publication context link expands above its materialized root: ${source}`,
    )
  }
  if (targetStats.isDirectory()) {
    await materializePublicationContextDirectory(
      canonicalTarget,
      destination,
      protectedDirectories,
      [
        ...mappings,
        {
          sourceRoot: canonicalTarget,
          destinationRoot: destination,
        },
      ],
      undefined,
    )
  } else if (targetStats.isFile()) {
    await copyFile(canonicalTarget, destination, constants.COPYFILE_FICLONE)
  } else {
    throw new Error(`Unsupported publication context link target: ${source}`)
  }
}

async function registerPublicationWorkspaces(
  contextRoot: string,
  workspaceRoot: string,
  packageDirs: string[],
) {
  const manifestPath = join(workspaceRoot, 'package.json')
  let manifest: Record<string, unknown> = { private: true }
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await readFileAsync(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error(
        `Failed to read staged workspace manifest ${manifestPath}`,
        { cause: error },
      )
    }
  }

  const releaseWorkspaces = packageDirs.map((packageDir) =>
    relative(contextRoot, packageDir).split(sep).join('/'),
  )
  const workspaces = manifest.workspaces
  if (Array.isArray(workspaces)) {
    manifest.workspaces = stagedPublicationWorkspacePatterns(
      workspaces,
      releaseWorkspaces,
    )
  } else if (
    typeof workspaces === 'object' &&
    workspaces !== null &&
    Array.isArray((workspaces as { packages?: unknown }).packages)
  ) {
    manifest.workspaces = {
      ...workspaces,
      packages: stagedPublicationWorkspacePatterns(
        (workspaces as { packages: unknown[] }).packages,
        releaseWorkspaces,
      ),
    }
  } else {
    manifest.workspaces = releaseWorkspaces
  }
  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2))
}

async function createPublicationExecutionPackage(
  workspaceRoot: string,
  packageDir: string,
) {
  if (!pathIsWithin(workspaceRoot, packageDir)) {
    throw new Error(
      `Prepared release package is outside its publication workspace: ${packageDir}`,
    )
  }
  const root = await mkdtemp(join(tmpdir(), 'napi-rs-pre-publish-execution-'))
  const executionWorkspaceRoot = join(root, 'workspace')
  try {
    const canonicalWorkspaceRoot = realpathSync.native(workspaceRoot)
    await materializePublicationContextDirectory(
      canonicalWorkspaceRoot,
      executionWorkspaceRoot,
      [],
      [
        {
          sourceRoot: canonicalWorkspaceRoot,
          destinationRoot: executionWorkspaceRoot,
        },
      ],
    )
  } catch (error) {
    await removePreparedSnapshot(root, 'preparation', true, error)
  }
  return {
    packageDir: join(
      executionWorkspaceRoot,
      relative(workspaceRoot, packageDir),
    ),
    root,
  }
}

async function validateRootReleasePlan(
  packageJsonPath: string,
  rootDir: string,
  plan: RootReleaseMaterializationPlan,
) {
  const stagingRoot = await mkdtemp(
    join(tmpdir(), 'napi-rs-pre-publish-root-validation-'),
  )
  const stagedRootDir = join(stagingRoot, 'package')
  try {
    await stageRootReleasePlan(packageJsonPath, rootDir, stagedRootDir, plan)
  } finally {
    await removeOwnedTemporaryTree(stagingRoot)
  }
}

async function stageRootReleasePlan(
  packageJsonPath: string,
  rootDir: string,
  stagedRootDir: string,
  plan: RootReleaseMaterializationPlan,
) {
  await mkdirAsync(stagedRootDir, { recursive: true })
  await cp(packageJsonPath, join(stagedRootDir, 'package.json'))
  if (plan.facade) {
    const packedFiles = readNpmPackFiles(rootDir, 'root package')
    const referencedFiles = collectRootPackagePathReferences(plan.packageJson)
    for (const file of new Set([
      ...packedFiles,
      ...referencedFiles,
      '.npmignore',
      '.gitignore',
      '.npmrc',
    ])) {
      if (file === 'package.json') {
        continue
      }
      const source = join(rootDir, file)
      if (!existsSync(source)) {
        continue
      }
      const destination = join(stagedRootDir, file)
      await mkdirAsync(dirname(destination), { recursive: true })
      await copyOwnedTemporaryPath(source, destination)
    }
  }
  await materializeRootReleasePlan(stagedRootDir, plan)
  if (plan.facade) {
    validateRootFacadePacklist(stagedRootDir, [
      ...plan.facade.generatedFiles,
      ...collectRootPackagePathReferences(plan.packageJson),
    ])
  }
}

async function materializeRootReleasePlan(
  rootDir: string,
  plan: RootReleaseMaterializationPlan,
) {
  if (plan.facade) {
    await materializeThreadlessWasiRootFacade(rootDir, plan.facade)
  }

  const packageJsonPath = join(rootDir, 'package.json')
  const updatedPackageJson = JSON.parse(
    await readFileAsync(packageJsonPath, 'utf8'),
  )
  updatedPackageJson.optionalDependencies = plan.optionalDependencies
  if (plan.nodeEngine !== undefined) {
    updatedPackageJson.engines = {
      ...asRecord(updatedPackageJson.engines),
      node: plan.nodeEngine,
    }
  }
  syncThreadlessWasiRootFacadeManifest(updatedPackageJson, plan.packageJson)
  await writeFileAtomic(
    packageJsonPath,
    JSON.stringify(updatedPackageJson, null, 2),
  )

  const generatedFiles = new Set(plan.facade?.generatedFiles ?? [])
  await Promise.all(
    plan.staleGeneratedFiles
      .filter((file) => !generatedFiles.has(file))
      .map((file) => rm(join(rootDir, file), { force: true })),
  )
}

interface ReleasePackageValidationOptions {
  pkgDir: string
  rootDir: string
  packageName: string
  binaryName: string
  target: Target
  requireDirectBufferDependency: boolean
}

interface ReleasePackageMaterializationPlan {
  target: Target
  pkgDir: string
  rootDir: string
  stagedPkgDir?: string
  packageFiles: string[]
  declarationDependencies: string[]
  updateManifest: boolean
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
  scripts?: unknown
}

async function validateReleasePackage({
  pkgDir,
  ...options
}: ReleasePackageValidationOptions): Promise<ReleasePackageMaterializationPlan> {
  assertReleasePackageTree(pkgDir)
  const packageJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `Release package manifest does not exist: ${packageJsonPath}`,
    )
  }

  const stagingRoot = await mkdtemp(
    join(tmpdir(), 'napi-rs-pre-publish-validation-'),
  )
  const stagedPkgDir = join(stagingRoot, 'package')
  try {
    await copyOwnedTemporaryPath(pkgDir, stagedPkgDir)
    assertReleasePackageTree(stagedPkgDir)
    const validation = await validateReleasePackageContents({
      ...options,
      pkgDir: stagedPkgDir,
    })
    return {
      pkgDir,
      rootDir: options.rootDir,
      target: options.target,
      ...validation,
    }
  } finally {
    await removeOwnedTemporaryTree(stagingRoot)
  }
}

async function stageReleasePackage(
  workspaceRoot: string,
  contextRoot: string,
  packageVersion: string,
  options: ReleasePackageValidationOptions,
) {
  assertReleasePackageTree(options.pkgDir)
  const stagedPkgDir = publicationContextPath(
    workspaceRoot,
    contextRoot,
    options.pkgDir,
  )
  await copyOwnedTemporaryPath(options.pkgDir, stagedPkgDir)
  assertReleasePackageTree(stagedPkgDir)
  const validation = await validateReleasePackageContents({
    ...options,
    pkgDir: stagedPkgDir,
  })
  const packageJsonPath = join(stagedPkgDir, 'package.json')
  const packageJson = JSON.parse(await readFileAsync(packageJsonPath, 'utf8'))
  packageJson.version = packageVersion
  await writeFileAtomic(packageJsonPath, JSON.stringify(packageJson, null, 2))
  return {
    pkgDir: options.pkgDir,
    rootDir: options.rootDir,
    stagedPkgDir,
    target: options.target,
    ...validation,
  }
}

function prepareReleasePackage(
  plan: ReleasePackageMaterializationPlan,
  binaryName: string,
): PreparedReleasePackage {
  const packageDir = plan.stagedPkgDir ?? plan.pkgDir
  const artifactExtension =
    plan.target.platform === 'wasi' || plan.target.platform === 'wasm'
      ? 'wasm'
      : 'node'
  const filename = `${binaryName}.${plan.target.platformArchABI}.${artifactExtension}`
  return {
    artifactPath: join(packageDir, filename),
    filename,
    packageDir,
  }
}

function assertReleasePackageTree(pkgDir: string) {
  let stats
  try {
    stats = lstatSync(pkgDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Release package directory does not exist: ${pkgDir}`, {
        cause: error,
      })
    }
    throw error
  }
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Release package directory must not be a symbolic link: ${pkgDir}`,
    )
  }
  if (!stats.isDirectory()) {
    throw new Error(`Release package path is not a directory: ${pkgDir}`)
  }
  const canonicalRoot = realpathSync.native(pkgDir)
  const visit = (path: string) => {
    const pathStats = lstatSync(path)
    if (pathStats.isSymbolicLink()) {
      throw new Error(
        `Release package contents must not contain symbolic links: ${path}`,
      )
    }
    const canonicalPath = realpathSync.native(path)
    if (!pathIsWithin(canonicalRoot, canonicalPath)) {
      throw new Error(
        `Release package path escapes ${canonicalRoot}: ${canonicalPath}`,
      )
    }
    if (pathStats.isDirectory()) {
      for (const entry of readdirSync(path)) {
        visit(join(path, entry))
      }
    }
  }
  visit(pkgDir)
}

interface CommitPrePublishFileSystemTransactionOptions {
  packageJsonPath: string
  releasePackagePlans: ReleasePackageMaterializationPlan[]
  rootDir: string
  rootReleasePlan: RootReleaseMaterializationPlan
  stagedRootManifestPath?: string
  stagedRootDir: string
  transactionRoot?: string
}

export async function commitPrePublishFileSystemTransaction({
  packageJsonPath,
  releasePackagePlans,
  rootDir,
  rootReleasePlan,
  stagedRootDir,
  stagedRootManifestPath = join(stagedRootDir, 'package.json'),
  transactionRoot = rootDir,
}: CommitPrePublishFileSystemTransactionOptions) {
  const writes: FileSystemTransactionWrite[] = []
  for (const plan of releasePackagePlans) {
    if (!plan.stagedPkgDir) {
      throw new Error(
        `Release package ${plan.target.platformArchABI} was not staged`,
      )
    }
    for (const declarationFile of plan.declarationDependencies) {
      writes.push({
        destination: join(plan.pkgDir, declarationFile),
        source: join(plan.stagedPkgDir, declarationFile),
      })
    }
    writes.push({
      destination: join(plan.pkgDir, 'package.json'),
      source: join(plan.stagedPkgDir, 'package.json'),
    })
  }

  for (const generatedFile of rootReleasePlan.facade?.generatedFiles ?? []) {
    writes.push({
      destination: join(rootDir, generatedFile),
      source: join(stagedRootDir, generatedFile),
    })
  }
  // Keep the root manifest last so every package and facade mutation is
  // rolled back if the final publication metadata cannot be committed.
  writes.push({
    destination: packageJsonPath,
    source: stagedRootManifestPath,
  })

  const generatedFiles = new Set(rootReleasePlan.facade?.generatedFiles ?? [])
  const removals = rootReleasePlan.staleGeneratedFiles
    .filter((file) => !generatedFiles.has(file))
    .map((file) => join(rootDir, file))
  await commitFileSystemTransaction(transactionRoot, writes, removals)
}

async function validateReleasePackageContents({
  pkgDir,
  rootDir,
  packageName,
  binaryName,
  target,
  requireDirectBufferDependency,
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
  for (const file of packageFiles) {
    resolveReleasePackageContentPath(pkgDir, file, expectedPackageName)
  }
  const packagedRuntimeImports =
    target.arch === 'wasm32'
      ? await releasePackageRuntimeImports(
          pkgDir,
          expectedPackageName,
          packageFiles,
        )
      : new Set<string>()
  const packagedLoaderImportsBuffer = packagedRuntimeImports.has('buffer')

  validateExpectedReleasePackageManifest(
    packageJson,
    packageFiles,
    binaryName,
    target,
    requireDirectBufferDependency || packagedLoaderImportsBuffer,
    packagedRuntimeImports,
  )

  for (const file of packageFiles) {
    const path = resolveReleasePackageContentPath(
      pkgDir,
      file,
      expectedPackageName,
    )
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(
        `Release package ${expectedPackageName} is incomplete: missing ${file}`,
      )
    }
  }

  const declarationClosure = await completeDeclarationDependencyClosure({
    pkgDir,
    rootDir,
    packageName: expectedPackageName,
    packageFiles,
  })
  const updateManifest = declarationClosure.files.length > packageFiles.length
  if (updateManifest) {
    packageFiles.splice(0, packageFiles.length, ...declarationClosure.files)
    packageJson.files = packageFiles
    await writeFileAtomic(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    )
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
  return {
    packageFiles,
    declarationDependencies: declarationClosure.materializedFiles,
    updateManifest,
  }
}

async function releasePackageRuntimeImports(
  pkgDir: string,
  packageName: string,
  packageFiles: string[],
) {
  const runtimeImports = new Set<string>()
  for (const file of packageFiles) {
    if (!/\.(?:cjs|mjs|js)$/.test(file)) {
      continue
    }
    const path = resolveReleasePackageContentPath(pkgDir, file, packageName)
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      continue
    }
    const source = await readFileAsync(path, 'utf8')
    for (const specifier of staticModuleSpecifiers(source, path)) {
      const dependency = wasiRuntimeDependencies.find(
        (candidate) =>
          specifier === candidate || specifier.startsWith(`${candidate}/`),
      )
      if (dependency) runtimeImports.add(dependency)
    }
  }
  return runtimeImports
}

function resolveReleasePackageContentPath(
  pkgDir: string,
  file: string,
  packageName: string,
) {
  const normalizedFile = file.replaceAll('\\', '/')
  if (
    normalizedFile.length === 0 ||
    isAbsolute(file) ||
    normalizedFile.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(
      `Release package ${packageName} path escapes its package directory: ${file}`,
    )
  }
  const path = resolve(pkgDir, file)
  if (!pathIsWithin(pkgDir, path)) {
    throw new Error(
      `Release package ${packageName} path escapes its package directory: ${file}`,
    )
  }
  return path
}

function staticModuleSpecifiers(source: string, path: string) {
  const typescript = loadTypeScript()
  const sourceFile = typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  )
  const specifiers = new Set<string>()
  const addSpecifier = (value: unknown) => {
    if (typeof value === 'string') specifiers.add(value)
  }
  const visit = (node: import('typescript').Node) => {
    if (
      (typescript.isImportDeclaration(node) ||
        typescript.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      typescript.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addSpecifier(node.moduleSpecifier.text)
    } else if (
      typescript.isImportEqualsDeclaration(node) &&
      typescript.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      typescript.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addSpecifier(node.moduleReference.expression.text)
    } else if (
      typescript.isCallExpression(node) &&
      node.arguments.length === 1 &&
      typescript.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === typescript.SyntaxKind.ImportKeyword ||
        (typescript.isIdentifier(node.expression) &&
          node.expression.text === 'require') ||
        (typescript.isPropertyAccessExpression(node.expression) &&
          typescript.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'require' &&
          node.expression.name.text === 'resolve'))
    ) {
      addSpecifier(node.arguments[0].text)
    }
    typescript.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function loadTypeScript(): TypeScriptModule {
  loadedTypeScript ??= require('typescript') as TypeScriptModule
  return loadedTypeScript
}

function validateExpectedReleasePackageManifest(
  packageJson: ReleasePackageManifest,
  packageFiles: string[],
  binaryName: string,
  target: Target,
  requireDirectBufferDependency: boolean,
  packagedRuntimeImports: Set<string>,
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
      packagedRuntimeImports,
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
  packagedRuntimeImports: Set<string>,
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
  const declaredRuntimeDependencies = wasiRuntimeDependencies.filter(
    (dependency) => dependencies?.[dependency] !== undefined,
  )
  if (
    packagedRuntimeImports.size === 0 &&
    declaredRuntimeDependencies.length === 0
  ) {
    return
  }
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
  } else if (dependencies.buffer !== undefined) {
    throw new Error(
      `Release package ${packageJson.name} must omit buffer when its loaders do not import it`,
    )
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
}

async function completeDeclarationDependencyClosure({
  pkgDir,
  rootDir,
  packageName,
  packageFiles,
}: DeclarationDependencyClosureOptions) {
  const includedFiles = new Set(packageFiles)
  const materializedFiles = new Set<string>()
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
        const destination = join(pkgDir, sourceDependency)
        await mkdirAsync(dirname(destination), { recursive: true })
        await copyFileAtomic(join(rootDir, sourceDependency), destination)
        materializedFiles.add(sourceDependency)
      }
      if (!includedFiles.has(sourceDependency)) {
        includedFiles.add(sourceDependency)
        if (isDeclarationFile(sourceDependency)) {
          queue.push(sourceDependency)
        }
      }
    }
  }
  return {
    files: [...includedFiles],
    materializedFiles: [...materializedFiles],
  }
}

function extractRelativeDeclarationSpecifiers(source: string) {
  return new Set(collectRelativeDeclarationSpecifiers(source))
}

function resolveDeclarationDependency(
  baseDir: string,
  declarationFile: string,
  specifier: string,
) {
  const canonicalBaseDir = realpathSync.native(baseDir)
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
    if (
      existsSync(candidate) &&
      lstatSync(candidate).isFile() &&
      pathIsWithin(canonicalBaseDir, realpathSync.native(candidate))
    ) {
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
