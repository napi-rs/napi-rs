import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  canonicalizeManagedPackagePath,
  commitFileSystemTransaction,
  debugFactory,
  fileExists,
  managedPackagePathIsWithin,
  parseTriple,
  readFileAsync,
  readNapiConfig,
  readdirAsync,
  resolvePackageReconciliationPaths,
  type Target,
  UniArchsByPlatform,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  withFileSystemReconciliation,
} from '../utils/index.js'
import {
  createWasiBrowserEntry,
  WASI_ARTIFACT_METADATA_PREFIX,
} from './build.js'

const debug = debugFactory('artifacts')

interface WasiArtifactSource {
  dir: string
  files: Map<string, string>
}

interface PendingWrite {
  content: Buffer
  source: string
}

interface WasiArtifactMetadata {
  exports?: string[]
  rootEntry: string | null
  managedRootEntries: string[]
}

// Removed configured targets are recognizable only when their output identity
// belongs to napi-rs's supported target set.
const supportedArtifactTargets = AVAILABLE_TARGETS.map(parseTriple)

export async function collectArtifacts(userOptions: ArtifactsOptions) {
  const options = applyDefaultArtifactsOptions(userOptions)
  const resolvedPaths = resolvePackageReconciliationPaths(
    options.cwd,
    options.packageJsonPath,
    [options.npmDir],
  )
  const { boundary } = resolvedPaths
  return withFileSystemReconciliation(boundary, () =>
    collectArtifactsUnlocked(options, resolvedPaths),
  )
}

async function collectArtifactsUnlocked(
  options: ReturnType<typeof applyDefaultArtifactsOptions>,
  resolvedPaths: ReturnType<typeof resolvePackageReconciliationPaths>,
) {
  const requestedCwd = resolve(options.cwd)
  const cwd = resolvedPaths.cwd
  const resolvePath = (...paths: string[]) => {
    const requestedPath = resolve(requestedCwd, ...paths)
    return isPathAtOrBelow(requestedPath, requestedCwd)
      ? resolve(cwd, relative(requestedCwd, requestedPath))
      : requestedPath
  }
  const packageJsonPath = resolvedPaths.packageJsonPath
  const packageRoot = resolvedPaths.packageRoot
  const { targets, binaryName, packageName, packageJson } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolvePath(options.configPath) : undefined,
    )
  const npmDir = resolvedPaths.managedPaths[0]
  const outputDir = await realpath(resolvePath(options.outputDir))
  const buildOutputDir = options.buildOutputDir
    ? resolvePath(options.buildOutputDir)
    : cwd
  const managedTargetDirs = [
    ...new Set(
      [...supportedArtifactTargets, ...targets].map(
        (target) => target.platformArchABI,
      ),
    ),
  ].map((target) => join(npmDir, target))
  const excludedSourceRoots = isStrictDescendant(outputDir, npmDir)
    ? [npmDir]
    : resolve(outputDir) === resolve(npmDir)
      ? managedTargetDirs
      : []
  const protectedSourcePaths = new Set(
    await collectRegularFiles(outputDir, excludedSourceRoots),
  )

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

  const artifacts = await collectNodeBinaries(outputDir, excludedSourceRoots)
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
    await removeTargetDestinations(
      resolvedPaths.boundary,
      packageRoot,
      npmDir,
      binaryName,
      missingTargets,
      protectedSourcePaths,
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
      await removeTargetDestinations(
        resolvedPaths.boundary,
        packageRoot,
        npmDir,
        binaryName,
        [target],
        protectedSourcePaths,
      )
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
      await addWasiBrowserEntry(
        pendingWrites,
        packageRoot,
        packageName,
        binaryName,
        browserTarget,
        wasiSources.get(browserTarget.platformArchABI)!,
      )
    } catch (error) {
      await removeTargetDestinations(
        resolvedPaths.boundary,
        packageRoot,
        npmDir,
        binaryName,
        [browserTarget],
        protectedSourcePaths,
      )
      throw error
    }
  }
  await addArtifactRootEntry({
    pendingWrites,
    packageRoot,
    packageMain: packageJson.main,
    binaryName,
    targets,
    artifactsByIdentity,
    wasiTargets,
    wasiSources,
    requireArtifactSourceRootEntry: options.buildOutputDir !== undefined,
  })

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

  const staleManagedDestinations = await collectStaleManagedDestinations(
    packageRoot,
    npmDir,
    binaryName,
    targets,
    pendingWrites,
    await collectManagedRootEntries(packageRoot, binaryName, wasiSources),
    protectedSourcePaths,
  )

  await commitArtifactReconciliation(
    resolvedPaths.boundary,
    pendingWrites,
    staleManagedDestinations,
  )
}

async function commitArtifactReconciliation(
  reconciliationRoot: string,
  pendingWrites: Map<string, PendingWrite>,
  staleManagedDestinations: string[],
) {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'napi-rs-artifacts-stage-'))
  try {
    const writes = await Promise.all(
      [...pendingWrites].map(
        async ([destination, { content, source }], index) => {
          const stagedSource = join(stagingRoot, String(index))
          await writeFile(stagedSource, content)
          debug.info(
            `Write [${colors.yellowBright(source)}] to [${colors.yellowBright(
              destination,
            )}]`,
          )
          return { destination, source: stagedSource }
        },
      ),
    )
    if (writes.length === 0 && staleManagedDestinations.length === 0) {
      return
    }
    await commitFileSystemTransaction(
      reconciliationRoot,
      writes,
      staleManagedDestinations,
    )
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
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

async function addWasiBrowserEntry(
  pendingWrites: Map<string, PendingWrite>,
  packageRoot: string,
  packageName: string,
  binaryName: string,
  target: Target,
  source: WasiArtifactSource,
) {
  const bindingSource = source.files.get(
    `${binaryName}.${wasiLoaderSuffix(target.platformArchABI)}.cjs`,
  )!
  const metadata = parseWasiArtifactMetadata(
    await readFileAsync(bindingSource, 'utf8'),
    bindingSource,
  )
  if (metadata?.exports !== undefined) {
    addPendingWrite(
      pendingWrites,
      join(packageRoot, 'browser.js'),
      bindingSource,
      Buffer.from(
        createWasiBrowserEntry(
          packageName,
          target.platformArchABI,
          metadata.exports,
        ),
      ),
    )
    return
  }

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
}

async function addWasiRootEntry(
  pendingWrites: Map<string, PendingWrite>,
  packageRoot: string,
  binaryName: string,
  rootTarget: Target,
  source: WasiArtifactSource,
  packageMain: string | undefined,
) {
  const bindingSource = source.files.get(
    `${binaryName}.${wasiLoaderSuffix(rootTarget.platformArchABI)}.cjs`,
  )!
  const metadata = parseWasiArtifactMetadata(
    await readFileAsync(bindingSource, 'utf8'),
    bindingSource,
  )
  const rootEntry =
    metadata === undefined
      ? await findLegacyRootEntry(source.dir, packageMain)
      : metadata.rootEntry
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
  const destination = resolvePackageRootEntry(
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

async function addArtifactRootEntry({
  pendingWrites,
  packageRoot,
  packageMain,
  binaryName,
  targets,
  artifactsByIdentity,
  wasiTargets,
  wasiSources,
  requireArtifactSourceRootEntry,
}: {
  pendingWrites: Map<string, PendingWrite>
  packageRoot: string
  packageMain: string | undefined
  binaryName: string
  targets: Target[]
  artifactsByIdentity: Map<string, string[]>
  wasiTargets: Target[]
  wasiSources: Map<string, WasiArtifactSource>
  requireArtifactSourceRootEntry: boolean
}) {
  const nativeTargets = targets.filter((target) => target.platform !== 'wasi')

  // The WASI loader metadata records which file was generated as the package
  // root entry when the loaders were built (`--js` on `napi build`, e.g.
  // `binding.js`). That name can differ from `package.json#main`, which may
  // point at a handwritten wrapper like `index.js`; both files must survive
  // reconciliation, so the recorded entry is a root candidate too.
  const wasiDeclaredRootEntries = new Map<string, string | null>()
  for (const target of wasiTargets) {
    const source = wasiSources.get(target.platformArchABI)
    if (!source) {
      continue
    }
    const bindingPath = source.files.get(
      `${binaryName}.${wasiLoaderSuffix(target.platformArchABI)}.cjs`,
    )
    if (!bindingPath) {
      continue
    }
    const metadata = parseWasiArtifactMetadata(
      await readFileAsync(bindingPath, 'utf8'),
      bindingPath,
    )
    if (metadata === undefined) {
      continue
    }
    wasiDeclaredRootEntries.set(
      target.platformArchABI,
      metadata.rootEntry === null
        ? null
        : resolveArtifactRelativePath(
            packageRoot,
            metadata.rootEntry,
            'WASI root entry',
          ).relative,
    )
  }
  // All flavors must declare the same root entry: their loaders are
  // interchangeable to consumers, and a divergence means the artifacts came
  // from builds with different `--js` options that cannot be spliced into a
  // coherent package.
  const declaredRootEntryContracts = new Set(wasiDeclaredRootEntries.values())
  if (declaredRootEntryContracts.size > 1) {
    throw new Error(
      `WASI loader metadata declares conflicting root entries: ${[
        ...wasiDeclaredRootEntries,
      ]
        .map(([abi, entry]) => `${abi}: ${entry ?? 'none'}`)
        .join(', ')}`,
    )
  }
  const wasiRootEntries = new Set(
    [...wasiDeclaredRootEntries.values()].filter(
      (entry): entry is string => entry !== null,
    ),
  )
  const rootCandidates = packageRootEntryCandidates(packageMain)

  // The package-root file the configured `main` resolves to shares its name
  // with the native root entry. Node applies the CommonJS lookup order to
  // `main` — the specifier itself (which also covers ESM importers, which
  // resolve `main` literally), `.js`/`.json`/`.node` extension variants,
  // then directory forms — and stops at the first match, so candidates an
  // existing earlier match shadows are not shared. The `index.js` fallback
  // in rootCandidates is only a scan candidate for the native artifact
  // dir, not a shared name: a WASI-declared `index.js` next to a
  // handwritten `main: "wrapper.js"` is a distinct generated file that must
  // resolve from the WASI artifact source like any other root entry.
  const sharedRootEntryPaths = await packageMainResolutionPaths(
    packageRoot,
    packageMain,
  )

  // The root loader below is taken from the threaded WASI target when both
  // flavors are configured, so a distinct root entry must come from that
  // target's source first: the generated entry embeds flavor-specific
  // loader references, and a threadless copy next to the threaded root
  // loader publishes a mismatched pair.
  const rootWasiTarget =
    wasiTargets.find((target) => wasiTargetHasThreads(target)) ?? wasiTargets[0]
  const orderedWasiTargets = [
    ...(rootWasiTarget ? [rootWasiTarget] : []),
    ...wasiTargets.filter((target) => target !== rootWasiTarget),
  ].filter(
    (target, index, list) =>
      list.findIndex(
        (other) => other.platformArchABI === target.platformArchABI,
      ) === index,
  )

  // A metadata-declared root entry whose name is not a package `main`
  // resolution (e.g. `binding.js` next to a handwritten `index.js`) is a
  // file `napi build` generated alongside the loader; reconciliation must
  // keep it. It is resolved before the native scan so a stale copy beside
  // the `.node` artifacts cannot claim the destination, preferring in
  // order: the WASI artifact source, native artifact dirs, then the
  // existing package-root file below. Entries that share a `main` path skip
  // this path entirely: their WASI-source copy is the WASI loader
  // (`*.wasi.cjs` chain), which must never replace the native root loader.
  // Destinations are compared after normalization since `main` values like
  // `./binding.js` and metadata entries like `binding.js` alias the same
  // package-root path.
  const distinctWasiRootEntries = [...wasiRootEntries].filter(
    (entry) => !sharedRootEntryPaths.has(entry),
  )
  const wasiSourceResolvedEntries = new Set<string>()
  if (nativeTargets.length > 0) {
    for (const entry of distinctWasiRootEntries) {
      const destination = resolvePackageRootEntry(
        packageRoot,
        entry,
        'WASI root entry destination',
      ).absolute
      let resolved = false
      for (const target of orderedWasiTargets) {
        if (wasiDeclaredRootEntries.get(target.platformArchABI) !== entry) {
          continue
        }
        const source = wasiSources.get(target.platformArchABI)
        if (!source) {
          continue
        }
        const sourcePath = resolveArtifactRelativePath(
          source.dir,
          entry,
          'WASI root entry',
        )
        if (!(await fileExists(sourcePath.absolute))) {
          continue
        }
        addPendingWrite(
          pendingWrites,
          destination,
          sourcePath.absolute,
          await readFileAsync(sourcePath.absolute),
        )
        wasiSourceResolvedEntries.add(entry)
        resolved = true
        break
      }
      if (resolved) {
        continue
      }
      for (const target of nativeTargets) {
        const artifactPath = artifactsByIdentity.get(
          artifactName(binaryName, target),
        )?.[0]
        if (!artifactPath) {
          continue
        }
        const sourcePath = resolveArtifactRelativePath(
          dirname(artifactPath),
          entry,
          'native-adjacent WASI root entry',
        )
        if (!(await fileExists(sourcePath.absolute))) {
          continue
        }
        addPendingWrite(
          pendingWrites,
          destination,
          sourcePath.absolute,
          await readFileAsync(sourcePath.absolute),
        )
        break
      }
    }
  }

  let copiedNativeRoot = false
  for (const target of nativeTargets) {
    if (copiedNativeRoot) {
      break
    }
    const artifactPath = artifactsByIdentity.get(
      artifactName(binaryName, target),
    )?.[0]
    if (!artifactPath) {
      continue
    }
    const sourceDir = dirname(artifactPath)
    for (const candidate of rootCandidates) {
      const source = resolveArtifactRelativePath(
        sourceDir,
        candidate,
        'native root entry',
      )
      if (!(await fileExists(source.absolute))) {
        continue
      }
      const destination = resolvePackageRootEntry(
        packageRoot,
        candidate,
        'native root entry destination',
      )
      if (pendingWrites.has(destination.absolute)) {
        continue
      }
      addPendingWrite(
        pendingWrites,
        destination.absolute,
        source.absolute,
        await readFileAsync(source.absolute),
      )
      copiedNativeRoot = true
      break
    }
  }

  if (nativeTargets.length > 0) {
    // Every root entry candidate that already exists in the package stays
    // managed: keeping it out of pendingWrites would mark it as a stale
    // managed destination and delete it. This must run even when a root entry
    // was copied from an artifact dir above, since a WASI-only candidate
    // such as `binding.js` never sits next to the `.node` artifacts.
    let keptExisting = false
    for (const candidate of [...rootCandidates, ...wasiRootEntries]) {
      const existing = resolvePackageRootEntry(
        packageRoot,
        candidate,
        'existing native root entry',
      )
      if (
        pendingWrites.has(existing.absolute) ||
        !(await fileExists(existing.absolute))
      ) {
        continue
      }
      addPendingWrite(
        pendingWrites,
        existing.absolute,
        existing.absolute,
        await readFileAsync(existing.absolute),
      )
      keptExisting = true
    }
    // A declared root entry that no artifact source or existing file
    // resolved would publish a package whose entry point does not exist.
    // Fail loudly like addWasiRootEntry instead of silently dropping it.
    for (const entry of wasiRootEntries) {
      const destination = resolvePackageRootEntry(
        packageRoot,
        entry,
        'WASI root entry destination',
      ).absolute
      // With an explicit --build-output-dir the WASI output is authoritative:
      // a distinct declared entry it does not contain cannot be satisfied by
      // a possibly stale package-root or native-adjacent copy, the same way
      // the WASI-only path already rejects an incomplete source.
      if (
        requireArtifactSourceRootEntry &&
        distinctWasiRootEntries.includes(entry) &&
        !wasiSourceResolvedEntries.has(entry)
      ) {
        throw new Error(
          `WASI loader metadata declares root entry ${entry}, but the configured build output directory does not contain it`,
        )
      }
      if (!pendingWrites.has(destination)) {
        throw new Error(
          `WASI loader metadata declares root entry ${entry}, but it was found in neither the artifact sources nor the package root`,
        )
      }
    }
    if (copiedNativeRoot || keptExisting) {
      return
    }
  }

  if (rootWasiTarget) {
    await addWasiRootEntry(
      pendingWrites,
      packageRoot,
      binaryName,
      rootWasiTarget,
      wasiSources.get(rootWasiTarget.platformArchABI)!,
      packageMain,
    )
  }
}

function packageRootEntryCandidates(packageMain: string | undefined) {
  return [
    ...(packageMain && /\.[cm]?js$/i.test(packageMain) ? [packageMain] : []),
    'index.js',
  ]
}

async function regularFileExists(path: string) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

// Package-root-relative paths a `main` value resolves to as the native root
// entry, following Node's CommonJS lookup order: the specifier itself
// (which also covers ESM importers, which resolve `main` literally), the
// LOAD_AS_FILE extension variants, then LOAD_AS_DIRECTORY — a nested
// `package.json#main` or `index.*` inside the directory. Candidates are
// shared only up to the first existing file; an earlier match shadows the
// later spellings, so they must not suppress a WASI-declared root entry of
// the same name. With no `main`, the implicit default is `index.js`.
async function packageMainResolutionPaths(
  packageRoot: string,
  packageMain: string | undefined,
) {
  const paths = new Set<string>()
  const enqueue = (entry: string) => {
    try {
      paths.add(
        resolveArtifactRelativePath(packageRoot, entry, 'package main')
          .relative,
      )
    } catch {
      // A `main` that escapes the package root cannot alias a managed root
      // entry, so it contributes no shared names.
    }
  }
  if (packageMain === undefined) {
    enqueue('index.js')
    return paths
  }
  const visitedManifests = new Set<string>()
  const visit = async (specifier: string): Promise<void> => {
    // The specifier itself is shared even when it does not exist: ESM
    // importers resolve `main` literally, so it still names the package
    // entry.
    enqueue(specifier)
    for (const extension of ['.js', '.json', '.node']) {
      const candidate = `${specifier}${extension}`
      if (await regularFileExists(join(packageRoot, candidate))) {
        enqueue(candidate)
        return
      }
    }
    const manifest = join(specifier, 'package.json')
    if (
      !visitedManifests.has(manifest) &&
      (await regularFileExists(join(packageRoot, manifest)))
    ) {
      visitedManifests.add(manifest)
      let nestedMain: unknown
      try {
        nestedMain = JSON.parse(
          await readFileAsync(join(packageRoot, manifest), 'utf8'),
        )?.main
      } catch {
        nestedMain = undefined
      }
      if (typeof nestedMain === 'string' && nestedMain.length > 0) {
        await visit(join(specifier, nestedMain))
        return
      }
    }
    for (const extension of ['js', 'json', 'node']) {
      const index = join(specifier, `index.${extension}`)
      if (await regularFileExists(join(packageRoot, index))) {
        enqueue(index)
        return
      }
    }
  }
  await visit(packageMain)
  return paths
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
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error(`Unsupported WASI artifact metadata in ${source}`)
  }
  const record = metadata as Record<string, unknown>
  if (
    (record.version !== 1 && record.version !== 2) ||
    (record.rootEntry !== null && typeof record.rootEntry !== 'string')
  ) {
    throw new Error(`Unsupported WASI artifact metadata in ${source}`)
  }
  const managedRootEntries =
    record.version === 1
      ? ['browser.js', ...(record.rootEntry ? [record.rootEntry] : [])]
      : record.managedRootEntries
  if (
    !Array.isArray(managedRootEntries) ||
    !managedRootEntries.every((entry) => typeof entry === 'string')
  ) {
    throw new Error(`Unsupported WASI artifact metadata in ${source}`)
  }
  const exports = record.exports
  if (
    exports !== undefined &&
    (!Array.isArray(exports) ||
      !exports.every((entry) => typeof entry === 'string'))
  ) {
    throw new Error(`Unsupported WASI artifact metadata in ${source}`)
  }
  return {
    exports: exports as string[] | undefined,
    rootEntry: record.rootEntry as string | null,
    managedRootEntries: [...new Set(managedRootEntries)],
  } satisfies WasiArtifactMetadata
}

async function findLegacyRootEntry(
  sourceDir: string,
  packageMain: string | undefined,
) {
  const candidates = packageRootEntryCandidates(packageMain)
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

// Root entry names come from `package.json#main` or WASI loader metadata and
// may be nested (e.g. `nested/binding.js`). The lexical check in
// resolveArtifactRelativePath cannot see symlinked intermediate directories,
// and the file-system transaction only guards the workspace boundary, so a
// symlinked parent could redirect a pending write into a sibling package.
// Canonicalizing the destination's nearest existing ancestor closes that gap.
function resolvePackageRootEntry(
  packageRoot: string,
  entry: string,
  description: string,
) {
  const resolved = resolveArtifactRelativePath(packageRoot, entry, description)
  const canonical = canonicalizeManagedPackagePath(resolved.absolute)
  if (!managedPackagePathIsWithin(packageRoot, canonical)) {
    throw new Error(
      `${description} resolves outside the package root through a symlinked path: ${entry}`,
    )
  }
  return resolved
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
  reconciliationRoot: string,
  packageRoot: string,
  npmDir: string,
  binaryName: string,
  targets: Target[],
  protectedSourcePaths: Set<string>,
) {
  const paths = targets.flatMap((target) =>
    targetDestinationPaths(packageRoot, npmDir, binaryName, target),
  )
  const removals = [
    ...new Set(
      paths.filter((path) => !protectedSourcePaths.has(resolve(path))),
    ),
  ]
  if (removals.length > 0) {
    await commitFileSystemTransaction(reconciliationRoot, [], removals)
  }
}

function targetDestinationPaths(
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
  return paths
}

async function collectStaleManagedDestinations(
  packageRoot: string,
  npmDir: string,
  binaryName: string,
  targets: Target[],
  pendingWrites: Map<string, PendingWrite>,
  managedRootEntries: string[],
  protectedSourcePaths: Set<string>,
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

  for (const entry of managedRootEntries) {
    const path = resolveArtifactRelativePath(
      packageRoot,
      entry,
      'managed WASI root entry',
    ).absolute
    if (!pendingWrites.has(path)) {
      stalePaths.push(path)
    }
  }

  return [
    ...new Set(
      stalePaths.filter((path) => !protectedSourcePaths.has(resolve(path))),
    ),
  ]
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

async function collectManagedRootEntries(
  packageRoot: string,
  binaryName: string,
  wasiSources: Map<string, WasiArtifactSource>,
) {
  const entries = new Set<string>()
  const loaderPaths = new Set<string>()
  for (const loaderSuffix of ['wasi', 'wasip1']) {
    loaderPaths.add(join(packageRoot, `${binaryName}.${loaderSuffix}.cjs`))
  }
  for (const source of wasiSources.values()) {
    for (const [fileName, path] of source.files) {
      if (fileName.endsWith('.cjs')) {
        loaderPaths.add(path)
      }
    }
  }

  for (const path of loaderPaths) {
    if (!(await fileExists(path))) {
      continue
    }
    const metadata = parseWasiArtifactMetadata(
      await readFileAsync(path, 'utf8'),
      path,
    )
    for (const entry of metadata?.managedRootEntries ?? []) {
      entries.add(entry)
    }
  }
  return [...entries]
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

async function collectNodeBinaries(root: string, excludedRoots: string[] = []) {
  const resolvedRoot = resolve(root)
  if (
    excludedRoots.some((excludedRoot) =>
      isPathAtOrBelow(resolvedRoot, excludedRoot),
    )
  ) {
    return []
  }
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
      nodeBinaries.push(
        ...(await collectNodeBinaries(join(root, dir.name), excludedRoots)),
      )
    }
  }
  return nodeBinaries.sort()
}

async function collectRegularFiles(
  root: string,
  excludedRoots: string[] = [],
): Promise<string[]> {
  const resolvedRoot = resolve(root)
  if (
    excludedRoots.some((excludedRoot) =>
      isPathAtOrBelow(resolvedRoot, excludedRoot),
    )
  ) {
    return []
  }
  const files = await readdirAsync(resolvedRoot, { withFileTypes: true })
  const regularFiles = files
    .filter((entry) => entry.isFile())
    .map((entry) => join(resolvedRoot, entry.name))
  for (const entry of files) {
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      regularFiles.push(
        ...(await collectRegularFiles(
          join(resolvedRoot, entry.name),
          excludedRoots,
        )),
      )
    }
  }
  return regularFiles
}

function isStrictDescendant(root: string, candidate: string) {
  const relativePath = relative(resolve(root), resolve(candidate))
  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  )
}

function isPathAtOrBelow(path: string, root: string) {
  const relativePath = relative(resolve(root), resolve(path))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}
