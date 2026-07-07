import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'

import * as colors from 'colorette'

import {
  applyDefaultArtifactsOptions,
  type ArtifactsOptions,
} from '../def/artifacts.js'
import {
  AVAILABLE_TARGETS,
  debugFactory,
  fileExists,
  mkdirAsync,
  parseTriple,
  readFileAsync,
  readNapiConfig,
  readdirAsync,
  type Target,
  UniArchsByPlatform,
  unlinkAsync,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  writeFileAsync,
} from '../utils/index.js'
import { WASI_ARTIFACT_METADATA_PREFIX } from './build.js'

const debug = debugFactory('artifacts')

interface WasiArtifactSource {
  dir: string
  files: Map<string, string>
}

interface PendingWrite {
  content: Buffer
  source: string
}

// Removed configured targets are recognizable only when their output identity
// belongs to napi-rs's supported target set.
const supportedArtifactTargets = AVAILABLE_TARGETS.map(parseTriple)

export async function collectArtifacts(userOptions: ArtifactsOptions) {
  const options = applyDefaultArtifactsOptions(userOptions)

  const cwd = resolve(options.cwd)
  const resolvePath = (...paths: string[]) => resolve(cwd, ...paths)
  const packageJsonPath = resolvePath(options.packageJsonPath)
  const packageRoot = dirname(packageJsonPath)
  const { targets, binaryName, packageName, packageJson } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolvePath(options.configPath) : undefined,
    )
  const npmDir = resolvePath(options.npmDir)
  const buildOutputDir = options.buildOutputDir
    ? resolvePath(options.buildOutputDir)
    : cwd

  const universalSourceBins = new Set(
    targets
      .filter((target) => target.arch === 'universal')
      .flatMap((target) =>
        UniArchsByPlatform[target.platform]?.map(
          (arch) => `${target.platform}-${arch}`,
        ),
      )
      .filter(Boolean) as string[],
  )

  const artifacts = await collectNodeBinaries(resolvePath(options.outputDir))
  const artifactsByIdentity = collectArtifactIdentities(artifacts, binaryName)
  rejectDuplicateArtifactIdentities(artifactsByIdentity)

  const expectedArtifacts = new Map<string, Target>()
  for (const target of targets) {
    expectedArtifacts.set(artifactName(binaryName, target), target)
  }

  const unexpectedArtifacts = [...artifactsByIdentity].filter(
    ([identity]) =>
      !expectedArtifacts.has(identity) &&
      !universalSourceBins.has(artifactPlatformArchABI(identity)),
  )
  if (unexpectedArtifacts.length > 0) {
    throw new Error(
      `Artifacts were found for unconfigured targets: ${unexpectedArtifacts
        .map(([identity, paths]) => `${identity}: ${paths.join(', ')}`)
        .sort()
        .join('; ')}`,
    )
  }

  const missingTargets = targets.filter(
    (target) => !artifactsByIdentity.has(artifactName(binaryName, target)),
  )
  if (missingTargets.length > 0) {
    await Promise.all(
      missingTargets.map((target) =>
        removeTargetDestinations(packageRoot, npmDir, binaryName, target),
      ),
    )
    throw new Error(
      `Missing artifacts for configured targets: ${missingTargets
        .map(
          (target) => `${target.triple} (${artifactName(binaryName, target)})`,
        )
        .join(', ')}`,
    )
  }

  const wasiTargets = targets.filter((target) => target.platform === 'wasi')
  const wasiSources = new Map<string, WasiArtifactSource>()
  for (const target of wasiTargets) {
    const artifactPath = artifactsByIdentity.get(
      artifactName(binaryName, target),
    )![0]
    const candidates = options.buildOutputDir
      ? [buildOutputDir]
      : [...new Set([dirname(artifactPath), cwd])]
    try {
      wasiSources.set(
        target.platformArchABI,
        await findWasiArtifactSource(candidates, binaryName, target),
      )
    } catch (error) {
      await removeTargetDestinations(packageRoot, npmDir, binaryName, target)
      throw error
    }
  }

  const pendingWrites = new Map<string, PendingWrite>()
  for (const target of targets) {
    const identity = artifactName(binaryName, target)
    const source = artifactsByIdentity.get(identity)![0]
    const content = await readFileAsync(source)
    addPendingWrite(
      pendingWrites,
      join(npmDir, target.platformArchABI, identity),
      source,
      content,
    )
    addPendingWrite(pendingWrites, join(packageRoot, identity), source, content)
  }

  const browserTarget =
    wasiTargets.find((target) => !wasiTargetHasThreads(target)) ??
    wasiTargets[0]
  if (browserTarget) {
    try {
      await addWasiRootEntries(
        pendingWrites,
        packageRoot,
        binaryName,
        browserTarget,
        wasiSources.get(browserTarget.platformArchABI)!,
        packageJson.main,
      )
    } catch (error) {
      await removeTargetDestinations(
        packageRoot,
        npmDir,
        binaryName,
        browserTarget,
      )
      throw error
    }
  }

  for (const target of wasiTargets) {
    const source = wasiSources.get(target.platformArchABI)!
    const loaderSuffix = wasiLoaderSuffix(target.platformArchABI)
    const wasiDir = join(npmDir, target.platformArchABI)
    for (const fileName of requiredWasiFiles(binaryName, target)) {
      const sourcePath = source.files.get(fileName)!
      let content = await readFileAsync(sourcePath)
      if (fileName === `${binaryName}.${loaderSuffix}-browser.js`) {
        content = Buffer.from(
          content
            .toString('utf8')
            .replace(
              `new URL('./wasi-worker-browser.mjs', import.meta.url)`,
              `new URL('${packageName}-${target.platformArchABI}/wasi-worker-browser.mjs', import.meta.url)`,
            ),
        )
      }
      addPendingWrite(
        pendingWrites,
        join(wasiDir, fileName),
        sourcePath,
        content,
      )
    }
  }

  await removeStaleManagedDestinations(
    packageRoot,
    npmDir,
    binaryName,
    targets,
    pendingWrites,
  )

  await Promise.all(
    [...pendingWrites].map(async ([destination, { content, source }]) => {
      debug.info(
        `Write [${colors.yellowBright(source)}] to [${colors.yellowBright(
          destination,
        )}]`,
      )
      await mkdirAsync(dirname(destination), { recursive: true })
      await writeFileAsync(destination, content)
    }),
  )
}

function artifactName(binaryName: string, target: Target) {
  const extension =
    target.platform === 'wasi' || target.platform === 'wasm' ? 'wasm' : 'node'
  return `${binaryName}.${target.platformArchABI}.${extension}`
}

function artifactPlatformArchABI(identity: string) {
  const parsed = parse(identity)
  return parsed.name.split('.').pop()!
}

function requiredWasiFiles(binaryName: string, target: Target) {
  const loaderSuffix = wasiLoaderSuffix(target.platformArchABI)
  const files = [
    `${binaryName}.${loaderSuffix}.cjs`,
    `${binaryName}.${loaderSuffix}.d.cts`,
    `${binaryName}.${loaderSuffix}-browser.js`,
  ]
  if (wasiTargetHasThreads(target)) {
    files.push('wasi-worker.mjs', 'wasi-worker-browser.mjs')
  } else {
    files.push(
      `${binaryName}.${loaderSuffix}-deferred.js`,
      `${binaryName}.${loaderSuffix}-deferred.d.ts`,
    )
  }
  return files
}

async function findWasiArtifactSource(
  candidateDirs: string[],
  binaryName: string,
  target: Target,
): Promise<WasiArtifactSource> {
  const requiredFiles = requiredWasiFiles(binaryName, target)
  const failures: string[] = []
  for (const dir of candidateDirs) {
    const files = new Map<string, string>()
    const missing: string[] = []
    for (const fileName of requiredFiles) {
      const path = join(dir, fileName)
      if (await fileExists(path)) {
        files.set(fileName, path)
      } else {
        missing.push(fileName)
      }
    }
    const browserPath = join(dir, 'browser.js')
    if (await fileExists(browserPath)) {
      files.set('browser.js', browserPath)
    }
    if (missing.length === 0) {
      return { dir, files }
    }
    const failure = `${dir} (missing ${missing.join(', ')})`
    // A candidate containing part of a loader set is authoritative but
    // incomplete. Falling through would combine it with stale local outputs.
    if (files.size > 0) {
      throw new Error(
        `Incomplete artifact source found for ${target.triple}: ${failure}`,
      )
    }
    failures.push(failure)
  }
  throw new Error(
    `No complete artifact source found for ${target.triple}: ${failures.join(
      '; ',
    )}`,
  )
}

async function addWasiRootEntries(
  pendingWrites: Map<string, PendingWrite>,
  packageRoot: string,
  binaryName: string,
  browserTarget: Target,
  source: WasiArtifactSource,
  packageMain: string | undefined,
) {
  const browserSource = source.files.get('browser.js')
  if (!browserSource) {
    throw new Error(
      `WASI artifact source ${source.dir} is incomplete: missing required root entry browser.js`,
    )
  }
  addPendingWrite(
    pendingWrites,
    join(packageRoot, 'browser.js'),
    browserSource,
    await readFileAsync(browserSource),
  )

  const bindingSource = source.files.get(
    `${binaryName}.${wasiLoaderSuffix(browserTarget.platformArchABI)}.cjs`,
  )!
  const metadata = parseWasiArtifactMetadata(
    await readFileAsync(bindingSource, 'utf8'),
    bindingSource,
  )
  const rootEntry =
    metadata === undefined
      ? await findLegacyRootEntry(source.dir, packageMain)
      : metadata
  if (rootEntry === null) {
    return
  }

  const sourcePath = resolveArtifactRelativePath(
    source.dir,
    rootEntry,
    'WASI root entry',
  )
  if (!(await fileExists(sourcePath.absolute))) {
    throw new Error(
      `WASI artifact source ${source.dir} is incomplete: missing required root entry ${rootEntry}`,
    )
  }
  const destination = resolveArtifactRelativePath(
    packageRoot,
    sourcePath.relative,
    'WASI root entry destination',
  ).absolute
  addPendingWrite(
    pendingWrites,
    destination,
    sourcePath.absolute,
    await readFileAsync(sourcePath.absolute),
  )
}

function parseWasiArtifactMetadata(content: string, source: string) {
  const firstLine = content.split(/\r?\n/, 1)[0]
  if (!firstLine.startsWith(WASI_ARTIFACT_METADATA_PREFIX)) {
    return undefined
  }
  let metadata: unknown
  try {
    metadata = JSON.parse(firstLine.slice(WASI_ARTIFACT_METADATA_PREFIX.length))
  } catch (error) {
    throw new Error(`Invalid WASI artifact metadata in ${source}`, {
      cause: error,
    })
  }
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('version' in metadata) ||
    metadata.version !== 1 ||
    !('rootEntry' in metadata) ||
    (metadata.rootEntry !== null && typeof metadata.rootEntry !== 'string')
  ) {
    throw new Error(`Unsupported WASI artifact metadata in ${source}`)
  }
  return metadata.rootEntry
}

async function findLegacyRootEntry(
  sourceDir: string,
  packageMain: string | undefined,
) {
  const candidates = [
    ...(packageMain && /\.[cm]?js$/i.test(packageMain) ? [packageMain] : []),
    'index.js',
  ]
  for (const candidate of new Set(candidates)) {
    const path = resolveArtifactRelativePath(
      sourceDir,
      candidate,
      'legacy WASI root entry',
    )
    if (await fileExists(path.absolute)) {
      return path.relative
    }
  }
  throw new Error(
    `WASI artifact source ${sourceDir} is incomplete: missing required root entry ${candidates.join(
      ' or ',
    )}`,
  )
}

function resolveArtifactRelativePath(
  root: string,
  entry: string,
  description: string,
) {
  if (!entry || isAbsolute(entry)) {
    throw new Error(
      `${description} must be a non-empty relative path: ${entry}`,
    )
  }
  const absolute = resolve(root, entry)
  const relativePath = relative(root, absolute)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${description} escapes its output directory: ${entry}`)
  }
  return { absolute, relative: relativePath }
}

function addPendingWrite(
  writes: Map<string, PendingWrite>,
  destination: string,
  source: string,
  content: Buffer,
) {
  const existing = writes.get(destination)
  if (existing) {
    if (!existing.content.equals(content)) {
      throw new Error(
        `Conflicting artifacts target ${destination}: ${existing.source} and ${source}`,
      )
    }
    return
  }
  writes.set(destination, { content, source })
}

async function removeTargetDestinations(
  packageRoot: string,
  npmDir: string,
  binaryName: string,
  target: Target,
) {
  const identity = artifactName(binaryName, target)
  const paths = [
    join(packageRoot, identity),
    join(npmDir, target.platformArchABI, identity),
  ]
  if (target.platform === 'wasi') {
    const wasiDir = join(npmDir, target.platformArchABI)
    for (const fileName of allManagedWasiFiles(binaryName, target)) {
      paths.push(join(wasiDir, fileName))
    }
    for (const fileName of requiredWasiFiles(binaryName, target)) {
      paths.push(join(packageRoot, fileName))
    }
    paths.push(join(packageRoot, `${binaryName}.wasm`))
  }
  await Promise.all(paths.map(unlinkIfExists))
}

async function removeStaleManagedDestinations(
  packageRoot: string,
  npmDir: string,
  binaryName: string,
  targets: Target[],
  pendingWrites: Map<string, PendingWrite>,
) {
  const stalePaths: string[] = []
  const managedBinaryFiles = new Set(
    [...supportedArtifactTargets, ...targets].map((target) =>
      artifactName(binaryName, target),
    ),
  )
  const managedWasiFiles = new Set<string>()
  for (const loaderSuffix of new Set([
    'wasi',
    'wasip1',
    ...targets
      .filter((target) => target.platform === 'wasi')
      .map((target) => wasiLoaderSuffix(target.platformArchABI)),
  ])) {
    for (const fileName of allManagedWasiFilesForSuffix(
      binaryName,
      loaderSuffix,
    )) {
      managedWasiFiles.add(fileName)
    }
  }

  for (const target of targets) {
    const targetDir = join(npmDir, target.platformArchABI)
    if (!(await fileExists(targetDir))) {
      continue
    }
    for (const entry of await readdirAsync(targetDir, {
      withFileTypes: true,
    })) {
      const path = join(targetDir, entry.name)
      if (
        entry.isFile() &&
        (managedBinaryFiles.has(entry.name) ||
          (target.platform === 'wasi' && managedWasiFiles.has(entry.name))) &&
        !pendingWrites.has(path)
      ) {
        stalePaths.push(path)
      }
    }
  }

  if (await fileExists(packageRoot)) {
    for (const entry of await readdirAsync(packageRoot, {
      withFileTypes: true,
    })) {
      const path = join(packageRoot, entry.name)
      if (
        entry.isFile() &&
        managedBinaryFiles.has(entry.name) &&
        !pendingWrites.has(path)
      ) {
        stalePaths.push(path)
      }
    }
  }

  await Promise.all(stalePaths.map(unlinkIfExists))
}

function allManagedWasiFiles(binaryName: string, target: Target) {
  return allManagedWasiFilesForSuffix(
    binaryName,
    wasiLoaderSuffix(target.platformArchABI),
  )
}

function allManagedWasiFilesForSuffix(
  binaryName: string,
  loaderSuffix: string,
) {
  return [
    `${binaryName}.${loaderSuffix}.cjs`,
    `${binaryName}.${loaderSuffix}.d.cts`,
    `${binaryName}.${loaderSuffix}-browser.js`,
    `${binaryName}.${loaderSuffix}-deferred.js`,
    `${binaryName}.${loaderSuffix}-deferred.d.ts`,
    'wasi-worker.mjs',
    'wasi-worker-browser.mjs',
  ]
}

async function unlinkIfExists(path: string) {
  try {
    await unlinkAsync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

function collectArtifactIdentities(filePaths: string[], binaryName: string) {
  const artifactsByIdentity = new Map<string, string[]>()
  for (const filePath of filePaths) {
    if (filePath.endsWith('.debug.wasm')) {
      continue
    }
    const parsedName = parse(filePath)
    const terms = parsedName.name.split('.')
    terms.pop()
    if (terms.join('.') !== binaryName) {
      continue
    }
    const matchingArtifacts = artifactsByIdentity.get(parsedName.base)
    if (matchingArtifacts) {
      matchingArtifacts.push(filePath)
    } else {
      artifactsByIdentity.set(parsedName.base, [filePath])
    }
  }
  return artifactsByIdentity
}

function rejectDuplicateArtifactIdentities(
  artifactsByIdentity: Map<string, string[]>,
) {
  const duplicates = [...artifactsByIdentity]
    .filter(([, filePaths]) => filePaths.length > 1)
    .map(
      ([identity, filePaths]) =>
        `${identity}: ${[...filePaths].sort().join(', ')}`,
    )
    .sort()
  if (duplicates.length > 0) {
    throw new Error(
      `Multiple artifacts found for binary artifact identities: ${duplicates.join('; ')}. Ensure merged CI artifacts contain exactly one build for each configured target or narrow --output-dir.`,
    )
  }
}

async function collectNodeBinaries(root: string) {
  const files = await readdirAsync(root, { withFileTypes: true })
  const nodeBinaries = files
    .filter(
      (file) =>
        file.isFile() &&
        (file.name.endsWith('.node') || file.name.endsWith('.wasm')),
    )
    .map((file) => join(root, file.name))

  const dirs = files.filter((file) => file.isDirectory())
  for (const dir of dirs) {
    if (dir.name !== 'node_modules') {
      nodeBinaries.push(...(await collectNodeBinaries(join(root, dir.name))))
    }
  }
  return nodeBinaries.sort()
}
