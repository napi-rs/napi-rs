import { execFile } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  readFile,
  writeFile,
  unlink,
  copyFile,
  mkdir,
  stat,
  readdir,
  access,
  chmod,
  rename,
  rm,
  realpath,
  lstat,
  link,
  open,
  readlink,
  type FileHandle,
} from 'node:fs/promises'
import {
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  type BigIntStats,
  type Stats,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as scheduleTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'

import pkgJson from '../../package.json' with { type: 'json' }
import { debug } from './log.js'

export const readFileAsync = readFile
export const writeFileAsync = writeFile
export const unlinkAsync = unlink
export const copyFileAsync = copyFile
export const mkdirAsync = mkdir
export const statAsync = stat
export const readdirAsync = readdir

const reconciliationTails = new Map<string, Promise<void>>()
const reconciliationLockName = '.napi-rs-filesystem-reconciliation'
const reconciliationReclaimMarker = '.reclaim.'
const reconciliationCandidateMarker = '.candidate.'
const reconciliationRetiredMarker = '.retired.'
const reconciliationMetadataExtension = '.swp'
const reconciliationLockKind = 'napi-rs-filesystem-reconciliation-lock'
const reconciliationReclaimKind = 'napi-rs-filesystem-reconciliation-reclaim'
const reconciliationStateVersion = 1
const reconciliationLockAcquisitionTimeout = 120_000
const reconciliationLockCleanupTimeout = 5_000
const reconciliationLockCleanupRetryInterval = 250
const reconciliationMetadataMaximumSize = 64 * 1024
const processIncarnationCommandTimeout = 2_000
const incompleteProcessExecutionIdentityCacheDuration =
  processIncarnationCommandTimeout
const processIncarnationObservationCacheDuration = 1_000
const fileSystemTransactionJournalName = '.napi-rs-filesystem-transaction.swp'
const fileSystemTransactionCandidateMarker = '.candidate.'
const fileSystemTransactionRetiredMarker = '.retired.'
const fileSystemTransactionOwnerName = 'owner.json'
const fileSystemTransactionStateName = 'state.json'
const fileSystemTransactionKind = 'napi-rs-filesystem-transaction'
const legacyFileSystemTransactionStateVersion = 1
const previousFileSystemTransactionStateVersion = 2
const fileSystemTransactionStateVersion = 3
const fileSystemTransactionStateMaximumSize = 16 * 1024 * 1024
const fileSystemTransactionMaximumEntries = 100_000
const fileSystemTransactionCleanupTimeout = 5_000
const fileSystemTransactionCleanupInitialRetryDelay = 10
const fileSystemTransactionCleanupMaximumRetryDelay = 250

interface ReconciliationLockOwner {
  candidate: string
  createdAt: number
  boot?: string | null
  bootSession?: string | null
  incarnation?: string | null
  key: string
  kind: typeof reconciliationLockKind
  machine?: string | null
  namespace?: string | null
  pid: number
  token: string
  version: typeof reconciliationStateVersion
}

interface ReconciliationReclaimOwner {
  candidate: string
  createdAt: number
  boot?: string | null
  bootSession?: string | null
  incarnation?: string | null
  key: string
  kind: typeof reconciliationReclaimKind
  machine?: string | null
  namespace?: string | null
  pid: number
  token: string
  version: typeof reconciliationStateVersion
}

interface ReconciliationLockState {
  lockStats: Stats
  ownerContent?: string
  owner?: ReconciliationLockOwner
  stale: boolean
  unverifiableReason?: string
}

interface ReconciliationReclaimState {
  owner: ReconciliationReclaimOwner
  ownerContent: string
  reclaimStats: Stats
  stale: boolean
  unverifiableReason?: string
}

type ReconciliationMetadataOwner =
  ReconciliationLockOwner | ReconciliationReclaimOwner

interface ReconciliationCandidateState {
  owner: ReconciliationMetadataOwner
  ownerContent: string
  stats: Stats
  stale: boolean
  unverifiableReason?: string
}

interface ProcessIncarnationObservation {
  expiresAt: number
  incarnation: string | null
}

interface ProcessExecutionIdentity {
  boot: string | null
  bootSession: string | null
  machine: string | null
  namespace: string | null
}

interface ProcessOwnerState {
  stale: boolean
  unverifiableReason?: string
}

interface ReconciliationLockDeadline {
  expiresAt: number
  timeout: number
}

interface ReconciliationLockIdentity {
  anchorPath: string
  dev: number
  ino: number
  key: string
  lockRootDev: number
  lockRootIno: number
  lockRootPath: string
  reportTopologyChange: boolean
  requestedPath: string
}

const processIncarnationObservations = new Map<
  number,
  ProcessIncarnationObservation
>()
let currentProcessIncarnation: string | undefined
let currentProcessIncarnationProbe: Promise<string | null> | undefined
let linuxBootId: string | undefined

interface TransactionParentIdentity {
  canonicalParent: string
  // 64-bit filesystem identifiers are captured from a bigint stat() and stored
  // as decimal strings so values above Number.MAX_SAFE_INTEGER (common for
  // Windows NTFS file references and volume serials) round-trip losslessly.
  dev: string
  identityPath: string
  ino: string
}

interface FileSystemTransactionJournalParent {
  canonicalParent: string
  dev: string
  identityPath: string
  ino: string
}

interface FileSystemTransactionJournalFileState {
  dev?: string
  hash: string
  ino?: string
  mode: number
}

interface FileSystemTransactionFileIdentity {
  dev: string
  ino: string
}

interface FileSystemTransactionJournalEntry {
  backup?: string
  final?: FileSystemTransactionJournalFileState
  original?: FileSystemTransactionJournalFileState
  parent: FileSystemTransactionJournalParent
  path: string
  prepared?: string
  retired?: string
  rollbackRetired?: string
}

interface FileSystemTransactionJournal {
  entries: FileSystemTransactionJournalEntry[]
  phase: 'committed' | 'prepared' | 'preparing'
  token: string
  version:
    | typeof legacyFileSystemTransactionStateVersion
    | typeof previousFileSystemTransactionStateVersion
    | typeof fileSystemTransactionStateVersion
}

interface FileSystemTransactionJournalOwner {
  kind: typeof fileSystemTransactionKind
  token: string
  version:
    | typeof legacyFileSystemTransactionStateVersion
    | typeof previousFileSystemTransactionStateVersion
    | typeof fileSystemTransactionStateVersion
}

interface FileSystemReconciliationCapability {
  roots: ReadonlySet<string>
}

interface PreparedFileSystemTransactionWrite {
  destination: string
  final: FileSystemTransactionJournalFileState
  input: string
  prepared?: string
  removeBeforeWrite?: string
}

interface OpenFileSystemTransactionIdentity {
  handle: FileHandle
  state: FileSystemTransactionJournalFileState
}

export interface FileSystemTransactionWrite {
  destination: string
  mode?: number
  removeBeforeWrite?: string
  source: string
}

const fileSystemReconciliationCapability =
  new AsyncLocalStorage<FileSystemReconciliationCapability>()

export async function writeFileAtomic(
  path: string,
  data: Parameters<typeof writeFile>[1],
  options?: Parameters<typeof writeFile>[2],
) {
  await mkdir(dirname(path), { recursive: true })
  while (true) {
    const temporaryPath = atomicTemporaryPath(path)
    const exclusiveOptions =
      typeof options === 'string'
        ? { encoding: options, flag: 'wx' as const }
        : { ...options, flag: 'wx' as const }
    try {
      await writeFile(temporaryPath, data, exclusiveOptions)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      throw error
    }
    let committed = false
    try {
      await syncFile(temporaryPath)
      await rename(temporaryPath, path)
      await syncDirectory(dirname(path))
      committed = true
      return
    } finally {
      if (!committed) {
        await unlinkFileIfExists(temporaryPath)
      }
    }
  }
}

export async function copyFileAtomic(
  source: string,
  destination: string,
  mode?: number,
) {
  await mkdir(dirname(destination), { recursive: true })
  while (true) {
    const temporaryPath = atomicTemporaryPath(destination)
    try {
      await copyFile(source, temporaryPath, constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      throw error
    }
    let committed = false
    try {
      if (mode !== undefined) {
        await chmod(temporaryPath, mode)
      }
      await syncFile(temporaryPath)
      await rename(temporaryPath, destination)
      await syncDirectory(dirname(destination))
      committed = true
      return
    } finally {
      if (!committed) {
        await unlinkFileIfExists(temporaryPath)
      }
    }
  }
}

export async function withFileSystemReconciliation<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const localKey = resolve(path)
  const previous = reconciliationTails.get(localKey) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent
  })
  const tail = previous.catch(() => {}).then(() => current)
  reconciliationTails.set(localKey, tail)

  const releaseCrossProcessLocks: Array<() => Promise<void>> = []
  let operationFailed = false
  let operationError: unknown
  let result!: T
  try {
    await previous.catch(() => {})
    const identities = await resolveReconciliationLockIdentities(path)
    const acquisitionDeadline = createReconciliationLockDeadline(
      reconciliationLockAcquisitionTimeout,
    )
    for (const identity of identities) {
      releaseCrossProcessLocks.push(
        await acquireReconciliationLock(identity, acquisitionDeadline),
      )
    }
    await recoverFileSystemTransaction(identities[0].anchorPath)
    const currentCapability = fileSystemReconciliationCapability.getStore()
    const roots = new Set(currentCapability?.roots)
    roots.add(fileSystemReconciliationCapabilityRoot(identities[0].anchorPath))
    result = await fileSystemReconciliationCapability.run({ roots }, operation)
  } catch (error) {
    operationFailed = true
    operationError = error
  }

  const releaseErrors: unknown[] = []
  for (let index = releaseCrossProcessLocks.length - 1; index >= 0; index--) {
    try {
      await releaseCrossProcessLocks[index]()
    } catch (error) {
      releaseErrors.push(error)
    }
  }
  release()
  if (reconciliationTails.get(localKey) === tail) {
    reconciliationTails.delete(localKey)
  }

  if (operationFailed) {
    if (releaseErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...releaseErrors],
        'Filesystem reconciliation operation and lock release both failed',
        { cause: operationError },
      )
    }
    throw operationError
  }
  if (releaseErrors.length === 1) {
    throw releaseErrors[0]
  }
  if (releaseErrors.length > 1) {
    throw new AggregateError(
      releaseErrors,
      'Multiple filesystem reconciliation locks could not be released',
      { cause: releaseErrors[0] },
    )
  }
  return result
}

function fileSystemReconciliationCapabilityRoot(path: string) {
  const resolvedPath = resolve(path)
  return process.platform === 'win32'
    ? resolvedPath.toLowerCase()
    : resolvedPath
}

export function getPackageReconciliationRoot(
  cwd: string,
  packageJsonPath = 'package.json',
) {
  return dirname(resolve(cwd, packageJsonPath))
}

export function resolvePackageReconciliationPaths(
  cwd: string,
  packageJsonPath = 'package.json',
  managedPaths: string[] = [],
) {
  const canonicalCwd = canonicalizeManagedPackagePath(cwd)
  const requestedPackageJsonPath = resolve(cwd, packageJsonPath)
  const canonicalPackageJsonPath = canonicalizeManagedPackagePath(
    requestedPackageJsonPath,
  )
  const canonicalPackageRoot = canonicalizeManagedPackagePath(
    dirname(requestedPackageJsonPath),
  )
  const canonicalManagedPaths = managedPaths.map((path) =>
    canonicalizeManagedPackagePath(resolve(cwd, path)),
  )
  if (
    !managedPackagePathIsWithin(canonicalPackageRoot, canonicalPackageJsonPath)
  ) {
    throw new Error(
      `Package manifest escapes its package root: ${requestedPackageJsonPath}`,
    )
  }

  const packageRootAndCwdAreRelated =
    managedPackagePathIsWithin(canonicalPackageRoot, canonicalCwd) ||
    managedPackagePathIsWithin(canonicalCwd, canonicalPackageRoot)
  if (!packageRootAndCwdAreRelated) {
    throw managedPackageBoundaryError(
      canonicalCwd,
      canonicalPackageRoot,
      canonicalManagedPaths,
    )
  }

  const discoveryBoundary = managedPackagePathIsWithin(
    canonicalCwd,
    canonicalPackageRoot,
  )
    ? canonicalCwd
    : canonicalPackageRoot
  let candidate = canonicalPackageRoot
  while (true) {
    if (
      hasPackageWorkspaceBoundaryMarker(candidate) &&
      canonicalManagedPaths.every((path) =>
        managedPackagePathIsWithin(candidate, path),
      )
    ) {
      return {
        boundary: candidate,
        cwd: canonicalCwd,
        managedPaths: canonicalManagedPaths,
        packageJsonPath: canonicalPackageJsonPath,
        packageRoot: canonicalPackageRoot,
      }
    }
    if (candidate === discoveryBoundary) {
      break
    }
    const parent = dirname(candidate)
    if (
      parent === candidate ||
      !managedPackagePathIsWithin(discoveryBoundary, parent)
    ) {
      break
    }
    candidate = parent
  }

  if (
    dirname(canonicalPackageRoot) !== canonicalPackageRoot &&
    canonicalManagedPaths.every((path) =>
      managedPackagePathIsWithin(canonicalPackageRoot, path),
    )
  ) {
    return {
      boundary: canonicalPackageRoot,
      cwd: canonicalCwd,
      managedPaths: canonicalManagedPaths,
      packageJsonPath: canonicalPackageJsonPath,
      packageRoot: canonicalPackageRoot,
    }
  }
  throw managedPackageBoundaryError(
    canonicalCwd,
    canonicalPackageRoot,
    canonicalManagedPaths,
  )
}

export function getPackageReconciliationRoots({
  boundary,
  cwd,
  packageRoot,
}: Pick<
  ReturnType<typeof resolvePackageReconciliationPaths>,
  'boundary' | 'cwd' | 'packageRoot'
>) {
  const roots: string[] = []
  const rootIdentities = new Set<string>()
  for (const root of [packageRoot, boundary, cwd]) {
    const resolvedRoot = resolve(root)
    const identity = fileSystemReconciliationCapabilityRoot(resolvedRoot)
    if (rootIdentities.has(identity)) {
      continue
    }
    if (
      roots.some(
        (existingRoot) =>
          !managedPackagePathIsWithin(existingRoot, resolvedRoot) &&
          !managedPackagePathIsWithin(resolvedRoot, existingRoot),
      )
    ) {
      throw new Error(
        `Package reconciliation roots must be nested: ${roots.join(', ')}, ${resolvedRoot}`,
      )
    }
    rootIdentities.add(identity)
    roots.push(resolvedRoot)
  }

  return roots
}

export async function withPackageFileSystemReconciliation<T>(
  paths: Pick<
    ReturnType<typeof resolvePackageReconciliationPaths>,
    'boundary' | 'cwd' | 'packageRoot'
  >,
  operation: () => Promise<T>,
): Promise<T> {
  const roots = getPackageReconciliationRoots(paths)
  const acquire = (index: number): Promise<T> => {
    if (index === roots.length) {
      return operation()
    }
    return withFileSystemReconciliation(roots[index], () => acquire(index + 1))
  }

  // Build takes the package lock before widening to its transaction root.
  // Preserve that semantic order even when cwd is below the package root.
  return acquire(0)
}

function managedPackagePathIsWithin(root: string, path: string) {
  const relativePath = relative(resolve(root), resolve(path))
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`))
  )
}

function canonicalizeManagedPackagePath(path: string) {
  let current = resolve(path)
  const missingSegments: string[] = []
  while (true) {
    try {
      return join(realpathSync.native(current), ...missingSegments)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      const parent = dirname(current)
      if (parent === current) {
        return join(current, ...missingSegments)
      }
      missingSegments.unshift(basename(current))
      current = parent
    }
  }
}

function hasPackageWorkspaceBoundaryMarker(directory: string) {
  if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    return true
  }
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) {
    return false
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      workspaces?: unknown
    }
    return (
      Array.isArray(manifest.workspaces) ||
      (typeof manifest.workspaces === 'object' &&
        manifest.workspaces !== null &&
        Array.isArray((manifest.workspaces as { packages?: unknown }).packages))
    )
  } catch {
    return false
  }
}

function managedPackageBoundaryError(
  cwd: string,
  packageRoot: string,
  managedPaths: string[],
) {
  return new Error(
    `Managed package paths must stay within the project or workspace boundary discovered from ${cwd}: ${[
      packageRoot,
      ...managedPaths,
    ].join(', ')}`,
  )
}

export async function commitFileSystemTransaction(
  root: string,
  writes: FileSystemTransactionWrite[],
  removals: string[],
) {
  const requestedTransactionRoot = resolve(root)
  for (const path of [
    ...writes.flatMap(({ destination, removeBeforeWrite }) =>
      removeBeforeWrite ? [destination, removeBeforeWrite] : [destination],
    ),
    ...removals,
  ]) {
    assertFileSystemTransactionPathIsNotReserved(
      requestedTransactionRoot,
      resolveTransactionPath(requestedTransactionRoot, path),
    )
  }
  const capability = fileSystemReconciliationCapability.getStore()
  if (capability) {
    const transactionRoot = await canonicalizeReconciliationPath(
      requestedTransactionRoot,
    )
    if (
      capability.roots.has(
        fileSystemReconciliationCapabilityRoot(transactionRoot),
      )
    ) {
      return commitFileSystemTransactionUnlocked(
        requestedTransactionRoot,
        transactionRoot,
        writes,
        removals,
      )
    }
  }
  return withFileSystemReconciliation(requestedTransactionRoot, async () => {
    const transactionRoot = await canonicalizeReconciliationPath(
      requestedTransactionRoot,
    )
    await commitFileSystemTransactionUnlocked(
      requestedTransactionRoot,
      transactionRoot,
      writes,
      removals,
    )
  })
}

async function commitFileSystemTransactionUnlocked(
  requestedTransactionRoot: string,
  transactionRoot: string,
  writes: FileSystemTransactionWrite[],
  removals: string[],
) {
  const transactionWrites = await Promise.all(
    writes.map(async (write) => {
      const destination = await resolveCanonicalTransactionPath(
        requestedTransactionRoot,
        transactionRoot,
        write.destination,
      )
      await mkdir(dirname(destination), { recursive: true })
      const stableDestination = await resolveCanonicalTransactionPath(
        requestedTransactionRoot,
        transactionRoot,
        write.destination,
      )
      if (
        !pathsHaveEquivalentPlatformSpelling(destination, stableDestination)
      ) {
        throw new Error(
          `Filesystem transaction destination parent changed while it was created: ${write.destination}`,
        )
      }
      return {
        destination: stableDestination,
        mode: write.mode,
        removeBeforeWrite: write.removeBeforeWrite
          ? await resolveCanonicalTransactionPath(
              requestedTransactionRoot,
              transactionRoot,
              write.removeBeforeWrite,
            )
          : undefined,
        source: write.source,
      }
    }),
  )
  const destinationKeys = new Set<string>()
  for (const { destination } of transactionWrites) {
    const destinationKey = fileSystemReconciliationCapabilityRoot(destination)
    if (destinationKeys.has(destinationKey)) {
      throw new Error(
        `Duplicate canonical filesystem transaction destination: ${destination}`,
      )
    }
    destinationKeys.add(destinationKey)
  }
  const writesByDestination = new Map(
    transactionWrites.map((write) => [write.destination, write]),
  )
  const resolvedRemovals = await Promise.all(
    removals.map((path) =>
      resolveCanonicalTransactionPath(
        requestedTransactionRoot,
        transactionRoot,
        path,
      ),
    ),
  )
  const preWriteRemovals = new Set(
    transactionWrites.flatMap(({ removeBeforeWrite }) =>
      removeBeforeWrite ? [removeBeforeWrite] : [],
    ),
  )
  const affected = new Set([
    ...writesByDestination.keys(),
    ...resolvedRemovals,
    ...preWriteRemovals,
  ])
  const journalRoot = fileSystemTransactionJournalPath(transactionRoot)
  for (const path of affected) {
    assertFileSystemTransactionPathIsNotReserved(transactionRoot, path)
  }
  // Capture 64-bit identity so the source preflight below can detect an inode
  // replacement even when dev/ino exceed Number.MAX_SAFE_INTEGER on Windows.
  const affectedStats = new Map<string, BigIntStats | undefined>()
  for (const path of affected) {
    const stats = await lstatIfExists(path, { bigint: true })
    if (stats && !stats.isFile()) {
      throw new Error(
        `Filesystem transaction path is not a regular file: ${path}`,
      )
    }
    affectedStats.set(path, stats)
  }
  const replacementAliasParents = new Map<string, string>()
  const findReplacementAlias = (path: string): string => {
    const parent = replacementAliasParents.get(path)
    if (parent === undefined) {
      replacementAliasParents.set(path, path)
      return path
    }
    if (parent === path) {
      return path
    }
    const root = findReplacementAlias(parent)
    replacementAliasParents.set(path, root)
    return root
  }
  const joinReplacementAliases = (left: string, right: string) => {
    const leftRoot = findReplacementAlias(left)
    const rightRoot = findReplacementAlias(right)
    if (leftRoot !== rightRoot) {
      replacementAliasParents.set(rightRoot, leftRoot)
    }
  }
  for (const { destination, removeBeforeWrite } of transactionWrites) {
    if (!removeBeforeWrite) {
      continue
    }
    const replacementStats = affectedStats.get(removeBeforeWrite)
    if (!replacementStats) {
      throw new Error(
        `Filesystem transaction replacement source does not exist: ${removeBeforeWrite}`,
      )
    }
    const destinationStats = affectedStats.get(destination)
    if (destinationStats) {
      if (
        !(await pathsReferToSameDirectoryEntry(
          removeBeforeWrite,
          destination,
          replacementStats,
          destinationStats,
        ))
      ) {
        throw new Error(
          `Filesystem transaction replacement destination is occupied: ${destination}`,
        )
      }
      joinReplacementAliases(removeBeforeWrite, destination)
    }
  }
  const replacementAliasBackups = new Map<string, string>()
  for (const { removeBeforeWrite } of transactionWrites) {
    if (!removeBeforeWrite || !replacementAliasParents.has(removeBeforeWrite)) {
      continue
    }
    const root = findReplacementAlias(removeBeforeWrite)
    if (!replacementAliasBackups.has(root)) {
      replacementAliasBackups.set(root, removeBeforeWrite)
    }
  }
  const replacementBackupPaths = new Set(replacementAliasBackups.values())
  const parentIdentities = new Map<string, TransactionParentIdentity>()
  for (const path of affected) {
    const parent = dirname(path)
    if (!parentIdentities.has(parent)) {
      parentIdentities.set(
        parent,
        await captureTransactionParentIdentity(transactionRoot, parent),
      )
    }
  }

  const transactionState =
    await createFileSystemTransactionCandidate(transactionRoot)
  const {
    path: candidateRoot,
    stats: candidateStats,
    token: transactionToken,
  } = transactionState
  const candidateBackupRoot = join(candidateRoot, 'backups')
  const candidateInputRoot = join(candidateRoot, 'inputs')
  const publishedBackupRoot = join(journalRoot, 'backups')
  const backups = new Map<
    string,
    {
      path: string
      state: FileSystemTransactionJournalFileState
    }
  >()
  let preserveJournalRoot = false
  let journal: FileSystemTransactionJournal | undefined
  let committed = false
  let published = false
  let transactionError: unknown

  try {
    await writeFileAtomic(
      join(candidateRoot, fileSystemTransactionOwnerName),
      JSON.stringify({
        kind: fileSystemTransactionKind,
        token: transactionToken,
        version: fileSystemTransactionStateVersion,
      } satisfies FileSystemTransactionJournalOwner),
      { mode: 0o644 },
    )
    await syncDirectory(transactionRoot)
    await Promise.all([mkdir(candidateBackupRoot), mkdir(candidateInputRoot)])
    const preparedWrites: PreparedFileSystemTransactionWrite[] = []
    const snapshots = new Map<
      string,
      {
        final: FileSystemTransactionJournalFileState
        input: string
      }
    >()
    for (let index = 0; index < transactionWrites.length; index++) {
      const write = transactionWrites[index]
      let snapshot = snapshots.get(write.source)
      if (!snapshot) {
        const inputName = String(snapshots.size)
        const inputPath = join(candidateInputRoot, inputName)
        const sourceState = await snapshotFileSystemTransactionInput(
          write.source,
          inputPath,
        )
        snapshot = {
          final: fileSystemTransactionFileContents(sourceState),
          input: join('inputs', inputName),
        }
        snapshots.set(write.source, snapshot)
      }
      preparedWrites.push({
        destination: write.destination,
        final: {
          hash: snapshot.final.hash,
          mode: write.mode ?? snapshot.final.mode,
        },
        input: snapshot.input,
        removeBeforeWrite: write.removeBeforeWrite,
      })
    }

    for (let index = 0; index < preparedWrites.length; index++) {
      const write = preparedWrites[index]
      const prepared = fileSystemTransactionArtifactPath(
        write.destination,
        transactionToken,
        index,
        'prepared',
      )
      if ((await lstatIfExists(prepared)) !== undefined) {
        throw new Error(
          `Filesystem transaction artifact path already exists for ${write.destination}`,
        )
      }
      write.prepared = prepared
    }

    const artifactPaths = new Map<
      string,
      {
        retired: string
        rollbackRetired: string
      }
    >()
    let artifactIndex = 0
    for (const path of affected) {
      const retired = fileSystemTransactionArtifactPath(
        path,
        transactionToken,
        artifactIndex,
        'retired',
      )
      const rollbackRetired = fileSystemTransactionArtifactPath(
        path,
        transactionToken,
        artifactIndex,
        'rollback',
      )
      artifactIndex += 1
      if (
        (await lstatIfExists(retired)) !== undefined ||
        (await lstatIfExists(rollbackRetired)) !== undefined
      ) {
        throw new Error(
          `Filesystem transaction artifact path already exists for ${path}`,
        )
      }
      artifactPaths.set(path, { retired, rollbackRetired })
    }

    const journalParentForPath = (
      path: string,
    ): FileSystemTransactionJournalParent => {
      const parentIdentity = parentIdentities.get(dirname(path))
      if (!parentIdentity) {
        throw new Error(
          `Filesystem transaction parent metadata was not captured for ${path}`,
        )
      }
      return {
        canonicalParent: fileSystemTransactionRelativePath(
          transactionRoot,
          parentIdentity.canonicalParent,
          'Transaction canonical parent',
          true,
        ),
        dev: parentIdentity.dev,
        identityPath: fileSystemTransactionRelativePath(
          transactionRoot,
          parentIdentity.identityPath,
          'Transaction parent identity',
          true,
        ),
        ino: parentIdentity.ino,
      }
    }

    const preparingJournal: FileSystemTransactionJournal = {
      entries: preparedWrites.map((write) => ({
        final: write.final,
        parent: journalParentForPath(write.destination),
        path: fileSystemTransactionRelativePath(
          transactionRoot,
          write.destination,
          'Transaction path',
        ),
        prepared: fileSystemTransactionRelativePath(
          transactionRoot,
          write.prepared!,
          'Transaction prepared replacement',
        ),
      })),
      phase: 'preparing',
      token: transactionToken,
      version: fileSystemTransactionStateVersion,
    }
    await writeFileSystemTransactionJournal(candidateRoot, preparingJournal)
    journal = preparingJournal

    // Release every prepared-file writer only after one atomic journal update
    // records all created inodes. A crash before that checkpoint is ambiguous.
    let preparedIdentityCount = 0
    let preparedIdentityPublicationClosed = false
    let resolvePreparedIdentityPublication!: () => void
    let rejectPreparedIdentityPublication!: (reason?: unknown) => void
    const preparedIdentityPublication = new Promise<void>((resolve, reject) => {
      resolvePreparedIdentityPublication = resolve
      rejectPreparedIdentityPublication = reject
    })
    void preparedIdentityPublication.catch(() => {})
    const failPreparedIdentityPublication = (error: unknown) => {
      if (!preparedIdentityPublicationClosed) {
        preparedIdentityPublicationClosed = true
        rejectPreparedIdentityPublication(error)
      }
    }
    const recordPreparedIdentity = (
      index: number,
      identity: FileSystemTransactionFileIdentity,
    ) => {
      if (!preparedIdentityPublicationClosed) {
        const entry = preparingJournal.entries[index]
        if (!entry?.final) {
          failPreparedIdentityPublication(
            new Error(
              `Filesystem transaction preparing metadata was not captured for ${preparedWrites[index]?.destination}`,
            ),
          )
        } else {
          entry.final = { ...entry.final, ...identity }
          preparedIdentityCount += 1
          if (preparedIdentityCount === preparedWrites.length) {
            preparedIdentityPublicationClosed = true
            void writeFileSystemTransactionJournal(
              candidateRoot,
              preparingJournal,
            ).then(
              resolvePreparedIdentityPublication,
              rejectPreparedIdentityPublication,
            )
          }
        }
      }
      return preparedIdentityPublication
    }

    const preparations = preparedWrites.map(async (write, index) => {
      try {
        await assertTransactionParentUnchanged(
          transactionRoot,
          write.destination,
          parentIdentities,
        )
        const state = await prepareFileSystemTransactionReplacement(
          join(candidateInputRoot, basename(write.input)),
          write.prepared!,
          write.final,
          () =>
            assertTransactionParentUnchanged(
              transactionRoot,
              write.destination,
              parentIdentities,
            ),
          (identity) => recordPreparedIdentity(index, identity),
        )
        write.final = state
      } catch (error) {
        failPreparedIdentityPublication(error)
        throw error
      }
    })
    try {
      await Promise.all(preparations)
    } catch (error) {
      // Cleanup owns every prepared pathname only after all creators stop.
      await Promise.allSettled(preparations)
      throw error
    }

    const preparedWritesByDestination = new Map(
      preparedWrites.map((write) => [write.destination, write]),
    )

    let backupIndex = 0
    for (const path of affected) {
      if (
        replacementAliasParents.has(path) &&
        !replacementBackupPaths.has(path)
      ) {
        continue
      }
      const stats = affectedStats.get(path)
      if (!stats) {
        continue
      }
      await assertTransactionParentUnchanged(
        transactionRoot,
        path,
        parentIdentities,
      )
      const backupName = String(backupIndex++)
      const backup = join(candidateBackupRoot, backupName)
      const mode = Number(stats.mode & 0o7777n)
      const state = await snapshotFileSystemTransactionInput(
        path,
        backup,
        mode,
        stats,
      )
      backups.set(path, {
        path: join(publishedBackupRoot, backupName),
        state,
      })
    }

    const backupForPath = (path: string) => {
      const direct = backups.get(path)
      if (direct) {
        return direct
      }
      if (!replacementAliasParents.has(path)) {
        return
      }
      const aliasBackupPath = replacementAliasBackups.get(
        findReplacementAlias(path),
      )
      return aliasBackupPath ? backups.get(aliasBackupPath) : undefined
    }
    const finalWriteForPath = (path: string) => {
      const direct = preparedWritesByDestination.get(path)
      if (direct) {
        return direct
      }
      if (!replacementAliasParents.has(path)) {
        return
      }
      const aliasRoot = findReplacementAlias(path)
      return preparedWrites.find(
        (write) =>
          replacementAliasParents.has(write.destination) &&
          findReplacementAlias(write.destination) === aliasRoot,
      )
    }
    const preparedJournal: FileSystemTransactionJournal = {
      entries: [...affected].map((path) => {
        const originalStats = affectedStats.get(path)
        const backup = backupForPath(path)
        const finalWrite = finalWriteForPath(path)
        const artifacts = artifactPaths.get(path)
        if (!artifacts) {
          throw new Error(
            `Filesystem transaction metadata was not captured for ${path}`,
          )
        }
        if (finalWrite && !finalWrite.prepared) {
          throw new Error(
            `Filesystem transaction replacement was not prepared for ${path}`,
          )
        }
        return {
          backup: backup
            ? fileSystemTransactionRelativePath(
                transactionRoot,
                backup.path,
                'Transaction backup',
              )
            : undefined,
          final: finalWrite?.final,
          original: originalStats && backup ? backup.state : undefined,
          parent: journalParentForPath(path),
          path: fileSystemTransactionRelativePath(
            transactionRoot,
            path,
            'Transaction path',
          ),
          prepared: finalWrite
            ? fileSystemTransactionRelativePath(
                transactionRoot,
                finalWrite.prepared!,
                'Transaction prepared replacement',
              )
            : undefined,
          retired: fileSystemTransactionRelativePath(
            transactionRoot,
            artifacts.retired,
            'Transaction retirement path',
          ),
          rollbackRetired: fileSystemTransactionRelativePath(
            transactionRoot,
            artifacts.rollbackRetired,
            'Transaction rollback retirement path',
          ),
        }
      }),
      phase: 'prepared',
      token: transactionToken,
      version: fileSystemTransactionStateVersion,
    }
    await writeFileSystemTransactionJournal(candidateRoot, preparedJournal)
    journal = preparedJournal
    const journalEntriesByPath = new Map(
      preparedJournal.entries.map((entry) => [
        resolveFileSystemTransactionRelativePath(
          transactionRoot,
          entry.path,
          'Transaction path',
        ),
        entry,
      ]),
    )
    await Promise.all([
      syncDirectory(candidateBackupRoot),
      syncDirectory(candidateInputRoot),
    ])
    await syncDirectory(candidateRoot)
    if (await lstatIfExists(journalRoot)) {
      throw new Error(
        `Filesystem transaction recovery state already exists: ${journalRoot}`,
      )
    }
    await rename(candidateRoot, journalRoot)
    published = true
    await syncDirectory(transactionRoot)
    const publishedStats = await lstatIfExists(journalRoot, { bigint: true })
    if (!fileSystemTransactionStateMatches(candidateStats, publishedStats)) {
      throw new Error(
        `Filesystem transaction recovery state changed during publication: ${journalRoot}`,
      )
    }
    const publishedOwner = await readFileSystemTransactionOwner(transactionRoot)
    if (publishedOwner.token !== transactionToken) {
      throw new Error(
        `Filesystem transaction recovery state owner changed during publication: ${journalRoot}`,
      )
    }

    for (const path of preWriteRemovals) {
      const entry = journalEntriesByPath.get(path)
      if (!entry) {
        throw new Error(`Filesystem transaction journal omitted path: ${path}`)
      }
      await removeFileSystemTransactionPath(
        transactionRoot,
        path,
        parentIdentities,
        entry.original,
        resolveFileSystemTransactionRelativePath(
          transactionRoot,
          entry.retired!,
          'Transaction retirement path',
        ),
        'before pre-write removal',
      )
    }
    for (const write of preparedWrites) {
      const { destination } = write
      const entry = journalEntriesByPath.get(destination)
      if (!entry || !entry.final || !entry.prepared || !entry.retired) {
        throw new Error(
          `Filesystem transaction journal omitted write destination: ${destination}`,
        )
      }
      const expectedDestination =
        write.removeBeforeWrite &&
        replacementAliasParents.has(write.removeBeforeWrite) &&
        replacementAliasParents.has(destination) &&
        findReplacementAlias(write.removeBeforeWrite) ===
          findReplacementAlias(destination)
          ? undefined
          : entry.original
      await commitFileSystemTransactionReplacement(
        transactionRoot,
        destination,
        parentIdentities,
        expectedDestination,
        resolveFileSystemTransactionRelativePath(
          transactionRoot,
          entry.prepared,
          'Transaction prepared replacement',
        ),
        entry.final,
        resolveFileSystemTransactionRelativePath(
          transactionRoot,
          entry.retired,
          'Transaction retirement path',
        ),
      )
    }
    for (const path of affected) {
      if (!writesByDestination.has(path) && !preWriteRemovals.has(path)) {
        const entry = journalEntriesByPath.get(path)
        if (!entry) {
          throw new Error(
            `Filesystem transaction journal omitted path: ${path}`,
          )
        }
        await removeFileSystemTransactionPath(
          transactionRoot,
          path,
          parentIdentities,
          entry.original,
          resolveFileSystemTransactionRelativePath(
            transactionRoot,
            entry.retired!,
            'Transaction retirement path',
          ),
          'before transaction removal',
        )
      }
    }
    journal = { ...journal, phase: 'committed' }
    await writeFileSystemTransactionJournal(journalRoot, journal)
    committed = true
  } catch (error) {
    transactionError = error
    if (published && journal && !committed) {
      const rollbackErrors: Error[] = []
      for (const rollbackError of await rollbackFileSystemTransaction(
        transactionRoot,
        journal,
      )) {
        rollbackErrors.push(rollbackError)
      }
      if (rollbackErrors.length > 0) {
        preserveJournalRoot = true
        transactionError = new AggregateError(
          [error, ...rollbackErrors],
          `Filesystem transaction failed and rollback was incomplete; recovery state is preserved at ${journalRoot}`,
          { cause: error },
        )
      }
    }
  }

  let cleanupError: unknown
  if (!preserveJournalRoot) {
    try {
      if (published) {
        if (journal) {
          await cleanupFileSystemTransactionArtifacts(transactionRoot, journal)
        }
        await removeFileSystemTransactionJournal(
          transactionRoot,
          transactionToken,
          candidateStats,
        )
      } else {
        if (journal) {
          await cleanupUnpublishedFileSystemTransactionArtifacts(
            transactionRoot,
            journal,
          )
        }
        await removeFileSystemTransactionCandidate(
          transactionRoot,
          candidateRoot,
          candidateStats,
        )
      }
    } catch (error) {
      cleanupError = error
    }
  }

  if (transactionError !== undefined) {
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [transactionError, cleanupError],
        `Filesystem transaction failed and its recovery state could not be removed from ${journalRoot}`,
        { cause: transactionError },
      )
    }
    throw transactionError
  }
  if (cleanupError !== undefined) {
    debug.warn(
      `Filesystem transaction committed but recovery-state cleanup failed at ${journalRoot}: ${errorMessage(cleanupError)}`,
    )
  }
}

async function pathsReferToSameDirectoryEntry(
  left: string,
  right: string,
  leftStats: BigIntStats,
  rightStats: BigIntStats,
) {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  if (resolvedLeft === resolvedRight) {
    return true
  }

  if (
    !leftStats.isFile() ||
    !rightStats.isFile() ||
    leftStats.dev !== rightStats.dev ||
    leftStats.ino !== rightStats.ino
  ) {
    return false
  }
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return false
  }

  const [leftParent, rightParent] = await Promise.all([
    realpath(dirname(left)),
    realpath(dirname(right)),
  ])
  if (!pathsHaveEquivalentPlatformSpelling(leftParent, rightParent)) {
    return false
  }

  const entries = await readdir(leftParent)
  const leftName = basename(left)
  const rightName = basename(right)
  return !(
    leftName !== rightName &&
    entries.includes(leftName) &&
    entries.includes(rightName)
  )
}

async function lstatIfExists(path: string): Promise<Stats | undefined>
async function lstatIfExists(
  path: string,
  options: { bigint: true },
): Promise<BigIntStats | undefined>
async function lstatIfExists(path: string, options?: { bigint: true }) {
  try {
    return options?.bigint
      ? await lstat(path, { bigint: true })
      : await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function readReconciliationMetadata(path: string, label: string) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw reconciliationPathCollisionError(
        path,
        `is not a regular ${label} file`,
      )
    }
    throw error
  }

  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      throw reconciliationPathCollisionError(
        path,
        `is not a regular ${label} file`,
      )
    }
    const content = Buffer.allocUnsafe(reconciliationMetadataMaximumSize + 1)
    let offset = 0
    while (offset < content.length) {
      const { bytesRead } = await handle.read(
        content,
        offset,
        content.length - offset,
        offset,
      )
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    if (offset > reconciliationMetadataMaximumSize) {
      throw reconciliationPathCollisionError(
        path,
        `exceeds the maximum ${label} size`,
      )
    }
    return {
      content: content.subarray(0, offset).toString('utf8'),
      stats,
    }
  } finally {
    await handle.close()
  }
}

async function canonicalizeReconciliationPath(path: string) {
  let current = resolve(path)
  const missingSegments: string[] = []

  while (true) {
    try {
      return join(await realpath(current), ...missingSegments)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      const parent = dirname(current)
      if (parent === current) {
        return join(current, ...missingSegments)
      }
      missingSegments.unshift(basename(current))
      current = parent
    }
  }
}

async function resolveReconciliationLockIdentities(
  path: string,
): Promise<ReconciliationLockIdentity[]> {
  const requestedPath = resolve(path)
  const anchorPath = await canonicalizeReconciliationPath(path)
  let anchorStats: Stats
  try {
    anchorStats = await lstat(anchorPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw reconciliationAnchorError(anchorPath, 'does not exist', 'ENOENT')
    }
    throw error
  }
  if (!anchorStats.isDirectory()) {
    throw reconciliationAnchorError(anchorPath, 'is not a directory', 'ENOTDIR')
  }
  const guardKeys = new Set<string>()
  if (await directoryIsWritable(dirname(anchorPath))) {
    guardKeys.add(anchorPath)
  }
  let currentPath = requestedPath
  while (true) {
    const currentStats = await lstatIfExists(currentPath)
    if (currentStats?.isSymbolicLink()) {
      if (await directoryIsWritable(dirname(currentPath))) {
        guardKeys.add(currentPath)
      }
    }
    const parent = dirname(currentPath)
    if (parent === currentPath) {
      break
    }
    currentPath = parent
  }

  const pathIdentities = await Promise.all(
    [...guardKeys].map(async (key) => {
      const lockRootPath = await realpath(dirname(key))
      const lockRootStats = await lstat(lockRootPath)
      if (!lockRootStats.isDirectory()) {
        throw reconciliationPathCollisionError(
          lockRootPath,
          'is not a lock namespace directory',
        )
      }
      return {
        anchorPath,
        dev: anchorStats.dev,
        ino: anchorStats.ino,
        key,
        lockRootDev: lockRootStats.dev,
        lockRootIno: lockRootStats.ino,
        lockRootPath,
        reportTopologyChange: key === anchorPath,
        requestedPath,
      }
    }),
  )
  const anchorParentPath = await realpath(dirname(anchorPath))
  const anchorParentStats = await lstat(anchorParentPath)
  const anchorParentIsShared =
    (anchorParentStats.mode & 0o1000) === 0 &&
    (await directoryIsWritable(anchorParentPath))
  const objectLockRootPath = anchorParentIsShared
    ? anchorParentPath
    : anchorPath
  const objectLockRootStats = anchorParentIsShared
    ? anchorParentStats
    : anchorStats
  if (!anchorParentIsShared && !(await directoryIsWritable(anchorPath))) {
    throw reconciliationPathCollisionError(
      anchorPath,
      'does not provide a writable lock namespace',
    )
  }
  const objectIdentity: ReconciliationLockIdentity = {
    anchorPath,
    dev: anchorStats.dev,
    ino: anchorStats.ino,
    key: `inode:${anchorStats.ino}`,
    lockRootDev: objectLockRootStats.dev,
    lockRootIno: objectLockRootStats.ino,
    lockRootPath: objectLockRootPath,
    reportTopologyChange: !guardKeys.has(anchorPath),
    requestedPath,
  }
  const identities = [...pathIdentities, objectIdentity]
  return identities.sort((left, right) => {
    const leftPath = reconciliationLockPath(left)
    const rightPath = reconciliationLockPath(right)
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
  })
}

async function directoryIsWritable(path: string) {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function assertReconciliationRequestedPathUnchanged(
  identity: ReconciliationLockIdentity,
) {
  let currentPath: string
  try {
    currentPath = await canonicalizeReconciliationPath(identity.requestedPath)
  } catch {
    throw reconciliationAnchorError(
      identity.requestedPath,
      'changed after lock identity was captured',
      'ESTALE',
    )
  }
  const currentStats = await lstatIfExists(currentPath)
  if (
    !currentStats?.isDirectory() ||
    currentStats.dev !== identity.dev ||
    currentStats.ino !== identity.ino
  ) {
    throw reconciliationAnchorError(
      identity.requestedPath,
      'changed after lock identity was captured',
      'ESTALE',
    )
  }
}

async function assertReconciliationAnchorUnchanged(
  identity: ReconciliationLockIdentity,
) {
  let anchorStats: Stats
  try {
    anchorStats = await lstat(identity.anchorPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw reconciliationAnchorError(
        identity.anchorPath,
        'changed after lock identity was captured',
        'ESTALE',
      )
    }
    throw error
  }
  if (
    !anchorStats.isDirectory() ||
    anchorStats.dev !== identity.dev ||
    anchorStats.ino !== identity.ino
  ) {
    throw reconciliationAnchorError(
      identity.anchorPath,
      'changed after lock identity was captured',
      'ESTALE',
    )
  }
}

async function assertReconciliationLockRootUnchanged(
  identity: ReconciliationLockIdentity,
) {
  const lockRootStats = await lstatIfExists(identity.lockRootPath)
  if (
    !lockRootStats?.isDirectory() ||
    lockRootStats.dev !== identity.lockRootDev ||
    lockRootStats.ino !== identity.lockRootIno
  ) {
    throw reconciliationAnchorError(
      identity.lockRootPath,
      'changed after lock identity was captured',
      'ESTALE',
    )
  }
}

function reconciliationAnchorError(
  anchorPath: string,
  message: string,
  code: string,
) {
  const error = new Error(
    `Filesystem reconciliation root ${anchorPath} ${message}`,
  ) as NodeJS.ErrnoException
  error.code = code
  error.path = anchorPath
  return error
}

function reconciliationLockPath(identity: ReconciliationLockIdentity) {
  return join(
    identity.lockRootPath,
    `${reconciliationLockName}.${createHash('sha256')
      .update(identity.key)
      .digest('hex')}${reconciliationMetadataExtension}`,
  )
}

function reconciliationReclaimPath(identity: ReconciliationLockIdentity) {
  return join(
    identity.lockRootPath,
    `${reconciliationLockName}${reconciliationReclaimMarker}${createHash(
      'sha256',
    )
      .update(identity.key)
      .digest('hex')}${reconciliationMetadataExtension}`,
  )
}

function reconciliationCandidateName(path: string, token: string) {
  return `${basename(path, extname(path))}${
    reconciliationCandidateMarker
  }${token}${reconciliationMetadataExtension}`
}

function reconciliationCandidatePath(path: string, token: string) {
  return join(dirname(path), reconciliationCandidateName(path, token))
}

function reconciliationRetiredPath(path: string) {
  return join(
    dirname(path),
    `${basename(path, extname(path))}${
      reconciliationRetiredMarker
    }${randomUUID()}${reconciliationMetadataExtension}`,
  )
}

async function acquireReconciliationLock(
  identity: ReconciliationLockIdentity,
  acquisitionDeadline: ReconciliationLockDeadline,
) {
  const { key } = identity
  const [incarnation, executionIdentity] = await Promise.all([
    getCurrentProcessIncarnation(),
    getCurrentProcessExecutionIdentity(),
  ])
  const lockPath = reconciliationLockPath(identity)
  await assertReconciliationAnchorUnchanged(identity)
  await assertReconciliationRequestedPathUnchanged(identity)
  await assertReconciliationLockRootUnchanged(identity)
  await removeStaleReconciliationCandidates(
    identity,
    lockPath,
    isReconciliationLockOwner,
  )
  await removeStaleReconciliationCandidates(
    identity,
    reconciliationReclaimPath(identity),
    isReconciliationReclaimOwner,
  )

  while (true) {
    assertReconciliationLockAcquisitionTimeRemaining(acquisitionDeadline, key)
    await assertReconciliationAnchorUnchanged(identity)
    await assertReconciliationRequestedPathUnchanged(identity)
    await assertReconciliationLockRootUnchanged(identity)
    await waitForReconciliationReclaim(identity, acquisitionDeadline)

    const token = randomUUID()
    const owner: ReconciliationLockOwner = {
      candidate: reconciliationCandidateName(lockPath, token),
      createdAt: Date.now(),
      boot: executionIdentity.boot,
      bootSession: executionIdentity.bootSession,
      incarnation,
      key,
      kind: reconciliationLockKind,
      machine: executionIdentity.machine,
      namespace: executionIdentity.namespace,
      pid: process.pid,
      token,
      version: reconciliationStateVersion,
    }
    let lockStats: Stats
    try {
      lockStats = await createExclusiveReconciliationMetadata(
        identity,
        lockPath,
        owner,
      )
    } catch (error) {
      if (isReconciliationCandidateCollisionError(error)) {
        continue
      }
      if (!(await reconciliationMetadataAlreadyExists(lockPath, error))) {
        throw error
      }
      const state = await inspectReconciliationLock(identity, lockPath)
      if (state?.unverifiableReason) {
        await waitForUnverifiableReconciliationLock(
          identity,
          lockPath,
          state,
          acquisitionDeadline,
        )
        continue
      }
      if (
        state?.owner &&
        state.stale &&
        (await tryReclaimStaleReconciliationLock(identity, lockPath, state))
      ) {
        continue
      }
      await delayReconciliationLockRetry(acquisitionDeadline, key)
      continue
    }

    try {
      await waitForReconciliationReclaim(identity, acquisitionDeadline)
      if (
        !(await reconciliationLockIsOwnedBy(
          identity,
          lockPath,
          lockStats,
          token,
        ))
      ) {
        throw new Error(
          `Lost filesystem reconciliation lock ownership before initialization: ${key}`,
        )
      }
      return maintainReconciliationLock(identity, lockPath, lockStats, token)
    } catch (error) {
      await cleanupFailedReconciliationLock(
        identity,
        lockPath,
        lockStats,
        token,
      )
      throw error
    }
  }
}

async function createExclusiveReconciliationMetadata(
  identity: ReconciliationLockIdentity,
  path: string,
  owner: ReconciliationMetadataOwner,
) {
  const candidatePath = reconciliationCandidatePath(path, owner.token)
  if (owner.candidate !== basename(candidatePath)) {
    throw new Error(
      `Invalid filesystem reconciliation candidate name: ${owner.candidate}`,
    )
  }

  await assertReconciliationLockRootUnchanged(identity)
  let handle
  try {
    handle = await open(candidatePath, 'wx', 0o644)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw reconciliationCandidateCollisionError(candidatePath)
    }
    throw error
  }
  const createdStats = await handle.stat()
  let published = false
  try {
    if (process.platform !== 'win32') {
      await handle.chmod(0o644)
    }
    await handle.writeFile(JSON.stringify(owner), 'utf8')
    await handle.sync()
    await handle.close()
    await assertReconciliationLockRootUnchanged(identity)
    try {
      await link(candidatePath, path)
      published = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw reconciliationMetadataExistsError(path)
      }
      if (isUnsupportedReconciliationHardLinkError(error)) {
        throw reconciliationHardLinkRequiredError(path, error)
      }
      throw error
    }
    await assertReconciliationLockRootUnchanged(identity)
    if (!(await reconciliationPathMatches(path, createdStats))) {
      throw new Error(`Lost filesystem reconciliation metadata: ${path}`)
    }
  } catch (error) {
    await handle.close().catch(() => {})
    try {
      await assertReconciliationLockRootUnchanged(identity)
      if (published) {
        await retireReconciliationPathIfMatches(
          identity,
          path,
          createdStats,
          async (retiredPath) =>
            (await readFile(retiredPath, 'utf8')) === JSON.stringify(owner),
        )
      }
      await removeReconciliationCandidateIfMatches(
        identity,
        candidatePath,
        createdStats,
      )
    } catch (cleanupError) {
      if (!isReconciliationAnchorChangedError(cleanupError)) {
        debug.warn(
          `Failed to clean up filesystem reconciliation metadata: ${errorMessage(cleanupError)}`,
        )
      }
    }
    throw error
  }

  try {
    await removeReconciliationCandidateIfMatches(
      identity,
      candidatePath,
      createdStats,
    )
  } catch (cleanupError) {
    if (!isReconciliationAnchorChangedError(cleanupError)) {
      debug.warn(
        `Failed to remove filesystem reconciliation publication candidate: ${errorMessage(cleanupError)}`,
      )
    }
  }
  return createdStats
}

async function cleanupFailedReconciliationLock(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  lockStats: Stats,
  token: string,
) {
  try {
    await waitForReconciliationReclaim(
      identity,
      createReconciliationLockDeadline(reconciliationLockCleanupTimeout),
    )
  } catch (cleanupError) {
    debug.warn(
      `Failed to wait for filesystem reconciliation reclaim during acquisition cleanup: ${errorMessage(cleanupError)}`,
    )
    if (
      isReconciliationAnchorChangedError(cleanupError) ||
      isReconciliationPathCollisionError(cleanupError)
    ) {
      return
    }
    scheduleFailedReconciliationLockCleanup(
      identity,
      lockPath,
      lockStats,
      token,
    )
    return
  }

  try {
    if (
      (await removeOwnedReconciliationLock(
        identity,
        lockPath,
        lockStats,
        token,
      )) === 'blocked'
    ) {
      scheduleFailedReconciliationLockCleanup(
        identity,
        lockPath,
        lockStats,
        token,
      )
    }
  } catch (cleanupError) {
    debug.warn(
      `Failed to clean up filesystem reconciliation lock after acquisition failure: ${errorMessage(cleanupError)}`,
    )
    if (
      !isReconciliationAnchorChangedError(cleanupError) &&
      !isReconciliationPathCollisionError(cleanupError)
    ) {
      scheduleFailedReconciliationLockCleanup(
        identity,
        lockPath,
        lockStats,
        token,
      )
    }
  }
}

function scheduleFailedReconciliationLockCleanup(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  lockStats: Stats,
  token: string,
) {
  const timer = scheduleTimeout(() => {
    void retryFailedReconciliationLockCleanup(
      identity,
      lockPath,
      lockStats,
      token,
    )
      .then((complete) => {
        if (!complete) {
          scheduleFailedReconciliationLockCleanup(
            identity,
            lockPath,
            lockStats,
            token,
          )
        }
      })
      .catch((cleanupError) => {
        debug.warn(
          `Failed to retry filesystem reconciliation lock cleanup: ${errorMessage(cleanupError)}`,
        )
        if (
          !isReconciliationAnchorChangedError(cleanupError) &&
          !isReconciliationPathCollisionError(cleanupError)
        ) {
          scheduleFailedReconciliationLockCleanup(
            identity,
            lockPath,
            lockStats,
            token,
          )
        }
      })
  }, reconciliationLockCleanupRetryInterval)
  timer.unref()
}

async function retryFailedReconciliationLockCleanup(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  lockStats: Stats,
  token: string,
) {
  await assertReconciliationLockRootUnchanged(identity)
  if (await pathExistsAsync(reconciliationReclaimPath(identity))) {
    await removeStaleReconciliationReclaim(identity)
    if (await pathExistsAsync(reconciliationReclaimPath(identity))) {
      return false
    }
  }
  return (
    (await removeOwnedReconciliationLock(
      identity,
      lockPath,
      lockStats,
      token,
    )) !== 'blocked'
  )
}

function isReconciliationAnchorChangedError(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ESTALE'
}

function maintainReconciliationLock(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  lockStats: Stats,
  token: string,
) {
  const { key } = identity
  return async () => {
    let anchorError: unknown
    if (identity.reportTopologyChange) {
      try {
        await assertReconciliationAnchorUnchanged(identity)
        await assertReconciliationRequestedPathUnchanged(identity)
      } catch (error) {
        anchorError = error
      }
    }
    await assertReconciliationLockRootUnchanged(identity)
    try {
      await waitForReconciliationReclaim(
        identity,
        createReconciliationLockDeadline(reconciliationLockCleanupTimeout),
      )
    } catch (error) {
      if (
        !isReconciliationAnchorChangedError(error) &&
        !isReconciliationPathCollisionError(error)
      ) {
        scheduleFailedReconciliationLockCleanup(
          identity,
          lockPath,
          lockStats,
          token,
        )
      }
      throw error
    }
    let cleanupResult: 'blocked' | 'not-owned' | 'removed'
    try {
      cleanupResult = await removeOwnedReconciliationLock(
        identity,
        lockPath,
        lockStats,
        token,
      )
    } catch (error) {
      if (
        !isReconciliationAnchorChangedError(error) &&
        !isReconciliationPathCollisionError(error)
      ) {
        scheduleFailedReconciliationLockCleanup(
          identity,
          lockPath,
          lockStats,
          token,
        )
      }
      throw error
    }
    if (cleanupResult === 'blocked') {
      scheduleFailedReconciliationLockCleanup(
        identity,
        lockPath,
        lockStats,
        token,
      )
      const error = new Error(
        `Filesystem reconciliation lock cleanup was blocked by a reclaimer: ${key}`,
      ) as NodeJS.ErrnoException
      error.code = 'EBUSY'
      throw error
    }
    if (anchorError !== undefined) {
      throw anchorError
    }
  }
}

async function removeOwnedReconciliationLock(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  lockStats: Stats,
  token: string,
): Promise<'blocked' | 'not-owned' | 'removed'> {
  await assertReconciliationLockRootUnchanged(identity)
  if (await pathExistsAsync(reconciliationReclaimPath(identity))) {
    return 'blocked'
  }
  if (
    !(await reconciliationLockIsOwnedBy(identity, lockPath, lockStats, token))
  ) {
    return 'not-owned'
  }
  if (await pathExistsAsync(reconciliationReclaimPath(identity))) {
    return 'blocked'
  }
  if (
    !(await reconciliationLockIsOwnedBy(identity, lockPath, lockStats, token))
  ) {
    return 'not-owned'
  }

  const retired = await retireReconciliationPathIfMatches(
    identity,
    lockPath,
    lockStats,
    async (retiredPath) => {
      try {
        const owner = JSON.parse(
          await readFile(retiredPath, 'utf8'),
        ) as ReconciliationLockOwner
        return (
          isReconciliationLockOwner(owner, identity.key, lockPath) &&
          owner.token === token
        )
      } catch {
        return false
      }
    },
  )
  if (!retired) {
    return 'not-owned'
  }
  await removeReconciliationCandidateBestEffort(
    identity,
    reconciliationCandidatePath(lockPath, token),
    lockStats,
  )
  return 'removed'
}

async function reconciliationLockIsOwnedBy(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  expectedStats: Stats,
  token: string,
) {
  try {
    const metadata = await readReconciliationMetadata(lockPath, 'lock-state')
    if (
      metadata.stats.dev !== expectedStats.dev ||
      metadata.stats.ino !== expectedStats.ino
    ) {
      return false
    }
    const owner = JSON.parse(metadata.content) as ReconciliationLockOwner
    return (
      isReconciliationLockOwner(owner, identity.key, lockPath) &&
      owner.token === token
    )
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof SyntaxError
    ) {
      return false
    }
    throw error
  }
}

async function inspectReconciliationLock(
  identity: ReconciliationLockIdentity,
  lockPath: string,
): Promise<ReconciliationLockState | undefined> {
  await assertReconciliationLockRootUnchanged(identity)
  let metadata: Awaited<ReturnType<typeof readReconciliationMetadata>>
  try {
    metadata = await readReconciliationMetadata(lockPath, 'lock-state')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return
    }
    if (isReconciliationPathCollisionError(error)) {
      throw error
    }
    throw reconciliationPathCollisionError(
      lockPath,
      `cannot be read as lock state: ${errorMessage(error)}`,
    )
  }

  let owner: unknown
  try {
    owner = JSON.parse(metadata.content)
  } catch {
    throw reconciliationPathCollisionError(
      lockPath,
      'contains malformed lock state',
    )
  }
  if (!isReconciliationLockOwner(owner, identity.key, lockPath)) {
    throw reconciliationPathCollisionError(
      lockPath,
      'contains unrecognized lock state',
    )
  }
  const ownerState = await processOwnerState(owner)
  return {
    lockStats: metadata.stats,
    owner,
    ownerContent: metadata.content,
    ...ownerState,
  }
}

function isReconciliationLockOwner(
  owner: unknown,
  key: string,
  path: string,
): owner is ReconciliationLockOwner {
  if (typeof owner !== 'object' || owner === null) {
    return false
  }
  const candidate = owner as Partial<ReconciliationLockOwner>
  return (
    candidate.kind === reconciliationLockKind &&
    candidate.version === reconciliationStateVersion &&
    candidate.key === key &&
    isValidReconciliationOwner(candidate) &&
    isReconciliationLockToken(candidate.token) &&
    candidate.candidate ===
      reconciliationCandidateName(path, candidate.token) &&
    isValidProcessIncarnation(candidate.incarnation) &&
    isValidProcessIdentityPart(candidate.boot) &&
    isValidProcessIdentityPart(candidate.bootSession) &&
    isValidProcessIdentityPart(candidate.machine) &&
    isValidProcessIdentityPart(candidate.namespace)
  )
}

function isReconciliationReclaimOwner(
  owner: unknown,
  key: string,
  path: string,
): owner is ReconciliationReclaimOwner {
  if (typeof owner !== 'object' || owner === null) {
    return false
  }
  const candidate = owner as Partial<ReconciliationReclaimOwner>
  return (
    candidate.kind === reconciliationReclaimKind &&
    candidate.version === reconciliationStateVersion &&
    candidate.key === key &&
    isValidReconciliationOwner(candidate) &&
    isReconciliationLockToken(candidate.token) &&
    candidate.candidate ===
      reconciliationCandidateName(path, candidate.token) &&
    isValidProcessIncarnation(candidate.incarnation) &&
    isValidProcessIdentityPart(candidate.boot) &&
    isValidProcessIdentityPart(candidate.bootSession) &&
    isValidProcessIdentityPart(candidate.machine) &&
    isValidProcessIdentityPart(candidate.namespace)
  )
}

function isValidReconciliationOwner(
  owner: Partial<ReconciliationLockOwner | ReconciliationReclaimOwner>,
) {
  return (
    Number.isSafeInteger(owner.createdAt) &&
    (owner.createdAt ?? 0) > 0 &&
    Number.isSafeInteger(owner.pid) &&
    (owner.pid ?? 0) > 0 &&
    isReconciliationLockToken(owner.token)
  )
}

async function tryReclaimStaleReconciliationLock(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  expectedState: ReconciliationLockState,
) {
  const reclaimPath = reconciliationReclaimPath(identity)
  const token = randomUUID()
  const [incarnation, executionIdentity] = await Promise.all([
    getCurrentProcessIncarnation(),
    getCurrentProcessExecutionIdentity(),
  ])
  const reclaimOwner: ReconciliationReclaimOwner = {
    candidate: reconciliationCandidateName(reclaimPath, token),
    createdAt: Date.now(),
    boot: executionIdentity.boot,
    bootSession: executionIdentity.bootSession,
    incarnation,
    key: identity.key,
    kind: reconciliationReclaimKind,
    machine: executionIdentity.machine,
    namespace: executionIdentity.namespace,
    pid: process.pid,
    token,
    version: reconciliationStateVersion,
  }
  let reclaimStats: Stats
  try {
    reclaimStats = await createExclusiveReconciliationMetadata(
      identity,
      reclaimPath,
      reclaimOwner,
    )
  } catch (error) {
    if (isReconciliationCandidateCollisionError(error)) {
      return false
    }
    if (!(await reconciliationMetadataAlreadyExists(reclaimPath, error))) {
      throw error
    }
    await removeStaleReconciliationReclaim(identity)
    return false
  }

  try {
    if (
      !(await reconciliationReclaimIsOwnedBy(
        identity,
        reclaimPath,
        reclaimStats,
        token,
      ))
    ) {
      return false
    }
    const currentState = await inspectReconciliationLock(identity, lockPath)
    if (
      !currentState?.owner ||
      !currentState.stale ||
      !reconciliationLockStatesMatch(expectedState, currentState)
    ) {
      return false
    }
    if (
      !(await reconciliationReclaimIsOwnedBy(
        identity,
        reclaimPath,
        reclaimStats,
        token,
      ))
    ) {
      return false
    }
    const finalState = await inspectReconciliationLock(identity, lockPath)
    if (
      !finalState?.owner ||
      !finalState.stale ||
      !reconciliationLockStatesMatch(currentState, finalState)
    ) {
      return false
    }

    const retired = await retireReconciliationPathIfMatches(
      identity,
      lockPath,
      finalState.lockStats,
      async (retiredPath) => {
        try {
          return (
            (await readFile(retiredPath, 'utf8')) === finalState.ownerContent
          )
        } catch {
          return false
        }
      },
    )
    if (!retired) {
      return false
    }
    await removeReconciliationCandidateBestEffort(
      identity,
      reconciliationCandidatePath(lockPath, currentState.owner.token),
      currentState.lockStats,
    )
    return true
  } finally {
    try {
      if (
        await reconciliationReclaimIsOwnedBy(
          identity,
          reclaimPath,
          reclaimStats,
          token,
        )
      ) {
        await retireReconciliationPathIfMatches(
          identity,
          reclaimPath,
          reclaimStats,
          async (retiredPath) => {
            try {
              const owner = JSON.parse(
                await readFile(retiredPath, 'utf8'),
              ) as ReconciliationReclaimOwner
              return (
                isReconciliationReclaimOwner(
                  owner,
                  identity.key,
                  reclaimPath,
                ) && owner.token === token
              )
            } catch {
              return false
            }
          },
        )
        await removeReconciliationCandidateBestEffort(
          identity,
          reconciliationCandidatePath(reclaimPath, token),
          reclaimStats,
        )
      }
    } catch (cleanupError) {
      if (!isReconciliationAnchorChangedError(cleanupError)) {
        debug.warn(
          `Failed to release filesystem reconciliation reclaim guard: ${errorMessage(cleanupError)}`,
        )
      }
    }
  }
}

function reconciliationLockStatesMatch(
  expected: ReconciliationLockState,
  current: ReconciliationLockState,
) {
  return (
    expected.lockStats.dev === current.lockStats.dev &&
    expected.lockStats.ino === current.lockStats.ino &&
    expected.ownerContent === current.ownerContent
  )
}

async function waitForUnverifiableReconciliationLock(
  identity: ReconciliationLockIdentity,
  lockPath: string,
  expected: ReconciliationLockState,
  acquisitionDeadline: ReconciliationLockDeadline,
) {
  const timeout = Math.min(
    reconciliationLockCleanupTimeout,
    Math.max(0, acquisitionDeadline.expiresAt - performance.now()),
  )
  const expiresAt = performance.now() + timeout
  let current = expected
  while (performance.now() < expiresAt) {
    await delay(Math.max(0, Math.min(20, expiresAt - performance.now())))
    const observed = await inspectReconciliationLock(identity, lockPath)
    if (
      !observed ||
      !reconciliationLockStatesMatch(expected, observed) ||
      !observed.unverifiableReason
    ) {
      return
    }
    current = observed
  }
  throw reconciliationOwnerCannotBeVerifiedError(
    lockPath,
    current.owner!,
    `${current.unverifiableReason}; it did not release the state within ${timeout}ms`,
  )
}

async function waitForReconciliationReclaim(
  identity: ReconciliationLockIdentity,
  acquisitionDeadline: ReconciliationLockDeadline,
) {
  await assertReconciliationLockRootUnchanged(identity)
  const reclaimPath = reconciliationReclaimPath(identity)
  while (await pathExistsAsync(reclaimPath)) {
    assertReconciliationLockAcquisitionTimeRemaining(
      acquisitionDeadline,
      identity.key,
    )
    await assertReconciliationLockRootUnchanged(identity)
    const state = await inspectReconciliationReclaim(identity)
    if (state?.unverifiableReason) {
      await waitForUnverifiableReconciliationReclaim(
        identity,
        state,
        acquisitionDeadline,
      )
      continue
    }
    await removeStaleReconciliationReclaim(identity)
    if (await pathExistsAsync(reclaimPath)) {
      await delayReconciliationLockRetry(acquisitionDeadline, identity.key)
    }
  }
}

async function waitForUnverifiableReconciliationReclaim(
  identity: ReconciliationLockIdentity,
  expected: ReconciliationReclaimState,
  acquisitionDeadline: ReconciliationLockDeadline,
) {
  const reclaimPath = reconciliationReclaimPath(identity)
  const timeout = Math.min(
    reconciliationLockCleanupTimeout,
    Math.max(0, acquisitionDeadline.expiresAt - performance.now()),
  )
  const expiresAt = performance.now() + timeout
  let current = expected
  while (performance.now() < expiresAt) {
    await delay(Math.max(0, Math.min(20, expiresAt - performance.now())))
    const observed = await inspectReconciliationReclaim(identity)
    if (
      !observed ||
      observed.reclaimStats.dev !== expected.reclaimStats.dev ||
      observed.reclaimStats.ino !== expected.reclaimStats.ino ||
      observed.ownerContent !== expected.ownerContent ||
      !observed.unverifiableReason
    ) {
      return
    }
    current = observed
  }
  throw reconciliationOwnerCannotBeVerifiedError(
    reclaimPath,
    current.owner,
    `${current.unverifiableReason}; it did not release the state within ${timeout}ms`,
  )
}

async function reconciliationReclaimIsOwnedBy(
  identity: ReconciliationLockIdentity,
  reclaimPath: string,
  expectedStats: Stats,
  token: string,
) {
  try {
    const metadata = await readReconciliationMetadata(
      reclaimPath,
      'reclaim-state',
    )
    if (
      metadata.stats.dev !== expectedStats.dev ||
      metadata.stats.ino !== expectedStats.ino
    ) {
      return false
    }
    const owner = JSON.parse(metadata.content) as ReconciliationReclaimOwner
    return (
      isReconciliationReclaimOwner(owner, identity.key, reclaimPath) &&
      owner.token === token
    )
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof SyntaxError
    ) {
      return false
    }
    throw error
  }
}

async function inspectReconciliationReclaim(
  identity: ReconciliationLockIdentity,
): Promise<ReconciliationReclaimState | undefined> {
  await assertReconciliationLockRootUnchanged(identity)
  const reclaimPath = reconciliationReclaimPath(identity)
  let metadata: Awaited<ReturnType<typeof readReconciliationMetadata>>
  try {
    metadata = await readReconciliationMetadata(reclaimPath, 'reclaim-state')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return
    }
    if (isReconciliationPathCollisionError(error)) {
      throw error
    }
    throw reconciliationPathCollisionError(
      reclaimPath,
      `cannot be read as reclaim state: ${errorMessage(error)}`,
    )
  }

  let owner: unknown
  try {
    owner = JSON.parse(metadata.content)
  } catch {
    throw reconciliationPathCollisionError(
      reclaimPath,
      'contains malformed reclaim state',
    )
  }
  if (!isReconciliationReclaimOwner(owner, identity.key, reclaimPath)) {
    throw reconciliationPathCollisionError(
      reclaimPath,
      'contains unrecognized reclaim state',
    )
  }
  const ownerState = await processOwnerState(owner)
  return {
    owner,
    ownerContent: metadata.content,
    reclaimStats: metadata.stats,
    ...ownerState,
  }
}

async function removeStaleReconciliationReclaim(
  identity: ReconciliationLockIdentity,
) {
  const reclaimPath = reconciliationReclaimPath(identity)
  const expectedState = await inspectReconciliationReclaim(identity)
  if (expectedState?.unverifiableReason) {
    throw reconciliationOwnerCannotBeVerifiedError(
      reclaimPath,
      expectedState.owner,
      expectedState.unverifiableReason,
    )
  }
  if (!expectedState?.stale) {
    return false
  }

  const currentState = await inspectReconciliationReclaim(identity)
  if (currentState?.unverifiableReason) {
    throw reconciliationOwnerCannotBeVerifiedError(
      reclaimPath,
      currentState.owner,
      currentState.unverifiableReason,
    )
  }
  if (
    !currentState ||
    !currentState.stale ||
    expectedState.reclaimStats.dev !== currentState.reclaimStats.dev ||
    expectedState.reclaimStats.ino !== currentState.reclaimStats.ino ||
    expectedState.ownerContent !== currentState.ownerContent
  ) {
    return false
  }

  const retired = await retireReconciliationPathIfMatches(
    identity,
    reclaimPath,
    currentState.reclaimStats,
    async (retiredPath) => {
      try {
        return (
          (await readFile(retiredPath, 'utf8')) === currentState.ownerContent
        )
      } catch {
        return false
      }
    },
  )
  if (!retired) {
    return false
  }
  try {
    await removeReconciliationCandidateIfMatches(
      identity,
      reconciliationCandidatePath(reclaimPath, currentState.owner.token),
      currentState.reclaimStats,
    )
  } catch (cleanupError) {
    if (!isReconciliationAnchorChangedError(cleanupError)) {
      debug.warn(
        `Failed to remove stale filesystem reconciliation reclaim state: ${errorMessage(cleanupError)}`,
      )
    }
  }
  return true
}

async function removeStaleReconciliationCandidates(
  identity: ReconciliationLockIdentity,
  path: string,
  isOwner: (
    owner: unknown,
    key: string,
    path: string,
  ) => owner is ReconciliationMetadataOwner,
) {
  await assertReconciliationLockRootUnchanged(identity)
  const prefix = `${basename(path, extname(path))}${reconciliationCandidateMarker}`
  const names = await readdir(identity.lockRootPath)
  for (const name of names) {
    if (
      !name.startsWith(prefix) ||
      !name.endsWith(reconciliationMetadataExtension)
    ) {
      continue
    }
    const token = name.slice(
      prefix.length,
      -reconciliationMetadataExtension.length,
    )
    if (
      !isReconciliationLockToken(token) ||
      name !== reconciliationCandidateName(path, token)
    ) {
      continue
    }
    const candidatePath = join(identity.lockRootPath, name)
    const expectedState = await inspectReconciliationCandidate(
      identity,
      path,
      candidatePath,
      isOwner,
    )
    if (!expectedState?.stale) {
      continue
    }
    const currentState = await inspectReconciliationCandidate(
      identity,
      path,
      candidatePath,
      isOwner,
    )
    if (
      !currentState?.stale ||
      expectedState.stats.dev !== currentState.stats.dev ||
      expectedState.stats.ino !== currentState.stats.ino ||
      expectedState.ownerContent !== currentState.ownerContent
    ) {
      continue
    }
    await removeReconciliationCandidateBestEffort(
      identity,
      candidatePath,
      currentState.stats,
    )
  }
}

async function inspectReconciliationCandidate(
  identity: ReconciliationLockIdentity,
  path: string,
  candidatePath: string,
  isOwner: (
    owner: unknown,
    key: string,
    path: string,
  ) => owner is ReconciliationMetadataOwner,
): Promise<ReconciliationCandidateState | undefined> {
  await assertReconciliationLockRootUnchanged(identity)
  let metadata: Awaited<ReturnType<typeof readReconciliationMetadata>>
  try {
    metadata = await readReconciliationMetadata(
      candidatePath,
      'publication-candidate',
    )
  } catch {
    return
  }

  let owner: unknown
  try {
    owner = JSON.parse(metadata.content)
  } catch {
    return
  }
  if (
    !isOwner(owner, identity.key, path) ||
    owner.candidate !== basename(candidatePath)
  ) {
    return
  }
  const ownerState = await processOwnerState(owner)
  return {
    owner,
    ownerContent: metadata.content,
    ...ownerState,
    stats: metadata.stats,
  }
}

async function removeReconciliationCandidateIfMatches(
  identity: ReconciliationLockIdentity,
  candidatePath: string,
  expectedStats: Stats,
) {
  await retireReconciliationPathIfMatches(
    identity,
    candidatePath,
    expectedStats,
  )
}

async function removeReconciliationCandidateBestEffort(
  identity: ReconciliationLockIdentity,
  candidatePath: string,
  expectedStats: Stats,
) {
  try {
    await removeReconciliationCandidateIfMatches(
      identity,
      candidatePath,
      expectedStats,
    )
  } catch (error) {
    if (!isReconciliationAnchorChangedError(error)) {
      debug.warn(
        `Failed to remove filesystem reconciliation publication candidate: ${errorMessage(error)}`,
      )
    }
  }
}

async function reconciliationPathMatches(path: string, expectedStats: Stats) {
  const currentStats = await lstatIfExists(path)
  return (
    currentStats?.isFile() === true &&
    currentStats.dev === expectedStats.dev &&
    currentStats.ino === expectedStats.ino
  )
}

async function retireReconciliationPathIfMatches(
  identity: ReconciliationLockIdentity,
  path: string,
  expectedStats: Stats,
  validate?: (retiredPath: string) => Promise<boolean>,
) {
  await assertReconciliationLockRootUnchanged(identity)
  const retiredPath = reconciliationRetiredPath(path)
  const retirementDeadline =
    performance.now() + reconciliationLockCleanupTimeout
  while (true) {
    try {
      await rename(path, retiredPath)
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return false
      }
      if (
        !isRetriableReconciliationRetirementError(error) ||
        performance.now() >= retirementDeadline
      ) {
        throw error
      }
      await delay(
        Math.max(0, Math.min(50, retirementDeadline - performance.now())),
      )
    }
  }

  const retiredStats = await lstatIfExists(retiredPath)
  let valid =
    retiredStats?.isFile() === true &&
    retiredStats.dev === expectedStats.dev &&
    retiredStats.ino === expectedStats.ino
  if (valid && validate !== undefined) {
    try {
      valid = await validate(retiredPath)
    } catch {
      valid = false
    }
  }
  if (!valid) {
    let restored = false
    if (retiredStats?.isFile() === true) {
      try {
        await link(retiredPath, path)
        restored = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          debug.warn(
            `Failed to restore replaced filesystem reconciliation metadata: ${errorMessage(error)}`,
          )
        }
      }
    }
    throw reconciliationPathCollisionError(
      path,
      restored
        ? `changed before retirement; the replacement was restored and preserved at ${retiredPath}`
        : `changed before retirement and was preserved at ${retiredPath}`,
    )
  }

  try {
    await unlinkReconciliationPathWithRetry(retiredPath)
  } catch (error) {
    if (!isRetriableReconciliationRetirementError(error)) {
      throw error
    }
    debug.warn(
      `Filesystem reconciliation metadata was retired but could not yet be removed: ${errorMessage(error)}`,
    )
    scheduleRetiredReconciliationPathCleanup(
      identity,
      retiredPath,
      retiredStats!,
    )
  }
  return true
}

async function unlinkReconciliationPathWithRetry(path: string) {
  const deadline = performance.now() + reconciliationLockCleanupTimeout
  while (true) {
    try {
      await unlink(path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      if (
        !isRetriableReconciliationRetirementError(error) ||
        performance.now() >= deadline
      ) {
        throw error
      }
      await delay(Math.max(0, Math.min(50, deadline - performance.now())))
    }
  }
}

function scheduleRetiredReconciliationPathCleanup(
  identity: ReconciliationLockIdentity,
  path: string,
  expectedStats: Stats,
) {
  const timer = scheduleTimeout(() => {
    void (async () => {
      await assertReconciliationLockRootUnchanged(identity)
      if (!(await reconciliationPathMatches(path, expectedStats))) {
        return
      }
      try {
        await unlinkReconciliationPathWithRetry(path)
      } catch (error) {
        if (isRetriableReconciliationRetirementError(error)) {
          scheduleRetiredReconciliationPathCleanup(
            identity,
            path,
            expectedStats,
          )
          return
        }
        throw error
      }
    })().catch((error) => {
      if (
        !isReconciliationAnchorChangedError(error) &&
        !isReconciliationPathCollisionError(error)
      ) {
        debug.warn(
          `Failed to clean up retired filesystem reconciliation metadata: ${errorMessage(error)}`,
        )
      }
    })
  }, reconciliationLockCleanupRetryInterval)
  timer.unref()
}

function isRetriableReconciliationRetirementError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM'
}

async function reconciliationMetadataAlreadyExists(
  path: string,
  error: unknown,
) {
  return (
    (error as { reconciliationMetadataExists?: boolean })
      .reconciliationMetadataExists === true ||
    (await lstatIfExists(path)) !== undefined
  )
}

function reconciliationCandidateCollisionError(path: string) {
  const error = new Error(
    `Filesystem reconciliation publication candidate already exists: ${path}`,
  ) as NodeJS.ErrnoException & { reconciliationCandidateCollision: true }
  error.code = 'EEXIST'
  error.path = path
  error.reconciliationCandidateCollision = true
  return error
}

function isReconciliationCandidateCollisionError(error: unknown) {
  return (
    (error as { reconciliationCandidateCollision?: boolean })
      .reconciliationCandidateCollision === true
  )
}

function reconciliationMetadataExistsError(path: string) {
  const error = new Error(
    `Filesystem reconciliation metadata already exists: ${path}`,
  ) as NodeJS.ErrnoException & { reconciliationMetadataExists: true }
  error.code = 'EEXIST'
  error.path = path
  error.reconciliationMetadataExists = true
  return error
}

function isUnsupportedReconciliationHardLinkError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code
  return (
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP' ||
    code === 'ENOSYS' ||
    code === 'EPERM'
  )
}

function reconciliationHardLinkRequiredError(path: string, cause: unknown) {
  // Publishing by hard link is the only Node filesystem operation that makes a
  // complete fsynced candidate visible without replacing a successor. Writing
  // the canonical path directly exposes partial JSON; rename() can clobber a
  // lock published concurrently, so neither is a safe fallback.
  const error = new Error(
    `Filesystem reconciliation requires hard-link support in ${dirname(path)} to atomically publish complete lock state without replacing another owner`,
    { cause },
  ) as NodeJS.ErrnoException
  error.code = 'ENOTSUP'
  error.path = path
  return error
}

function reconciliationOwnerCannotBeVerifiedError(
  path: string,
  owner: ReconciliationMetadataOwner,
  reason: string,
) {
  const candidatePath = join(dirname(path), owner.candidate)
  const error = new Error(
    `Filesystem reconciliation state at ${path} cannot be safely reclaimed: ${reason}. Verify on the owner system that PID ${owner.pid} no longer uses this filesystem, then manually remove ${path} and, if it still exists, ${candidatePath}`,
  ) as NodeJS.ErrnoException
  error.code = 'ENOTRECOVERABLE'
  error.path = path
  return error
}

function reconciliationPathCollisionError(path: string, message: string) {
  const error = new Error(
    `Filesystem reconciliation reserved path ${path} ${message}`,
  ) as NodeJS.ErrnoException & { reconciliationCollision: true }
  error.code = 'EEXIST'
  error.path = path
  error.reconciliationCollision = true
  return error
}

function isReconciliationPathCollisionError(error: unknown) {
  return (
    (error as { reconciliationCollision?: boolean }).reconciliationCollision ===
    true
  )
}

function isReconciliationLockToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    )
  )
}

function isValidProcessIncarnation(
  incarnation: unknown,
): incarnation is string | null | undefined {
  return (
    incarnation === undefined ||
    incarnation === null ||
    (typeof incarnation === 'string' &&
      incarnation.length > 0 &&
      incarnation.length <= 512 &&
      !hasControlCharacter(incarnation))
  )
}

function isValidProcessIdentityPart(
  value: unknown,
): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 1024 &&
      !hasControlCharacter(value))
  )
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

function processIncarnationFormat(incarnation: string) {
  if (
    /^linux-proc:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:\d+$/i.test(
      incarnation,
    )
  ) {
    return 'linux-proc'
  }
  if (/^windows-start:\d+$/.test(incarnation)) {
    return 'windows-start'
  }
  if (/^ps-lstart:[A-Za-z0-9_-]+$/.test(incarnation)) {
    return 'ps-lstart'
  }
}

// Reclamation is permitted only when execution identities are comparable and
// prove a prior boot, a dead PID, or PID reuse. Legacy, foreign-machine, and
// foreign-namespace states require explicit operator verification instead of a
// local PID guess that can destroy a live shared-volume owner's lock.
async function processOwnerState(
  owner: ReconciliationMetadataOwner,
): Promise<ProcessOwnerState> {
  if (
    typeof owner.machine !== 'string' ||
    typeof owner.boot !== 'string' ||
    typeof owner.namespace !== 'string'
  ) {
    return {
      stale: false,
      unverifiableReason:
        'the owner predates complete machine, boot-session, and process-namespace identity metadata',
    }
  }
  const current = await getCurrentProcessExecutionIdentity()
  if (
    current.machine === null ||
    current.boot === null ||
    current.namespace === null
  ) {
    return {
      stale: false,
      unverifiableReason:
        'the current system cannot determine a complete machine, boot-session, and process-namespace identity',
    }
  }
  if (current.machine !== owner.machine) {
    return {
      stale: false,
      unverifiableReason: `the owner machine identity (${owner.machine}) differs from this machine (${current.machine}), so this may be a live owner on a shared volume`,
    }
  }
  if (!processBootIdentitiesMatch(current, owner)) {
    return { stale: true }
  }
  if (current.namespace !== owner.namespace) {
    return {
      stale: false,
      unverifiableReason: `the owner process namespace (${owner.namespace}) differs from this process namespace (${current.namespace}), so local PID checks are not authoritative`,
    }
  }
  if (!processExists(owner.pid)) {
    return { stale: true }
  }
  if (owner.incarnation === undefined) {
    return {
      stale: false,
      unverifiableReason:
        'the live owner has no process-incarnation identity, so PID reuse cannot be ruled out',
    }
  }
  // A null observation means this platform could not capture an incarnation.
  // Unknown newer formats remain live and block normally; only comparable
  // identities can prove that a PID was reused.
  if (owner.incarnation === null) {
    return { stale: false }
  }
  const expectedFormat = processIncarnationFormat(owner.incarnation)
  if (expectedFormat === undefined) {
    return { stale: false }
  }
  const observedIncarnation = await observeProcessIncarnation(
    owner.pid,
    owner.incarnation,
  )
  return {
    stale:
      observedIncarnation !== null &&
      processIncarnationFormat(observedIncarnation) === expectedFormat &&
      observedIncarnation !== owner.incarnation,
  }
}

function processBootIdentitiesMatch(
  current: ProcessExecutionIdentity,
  owner: ReconciliationMetadataOwner,
) {
  if (
    typeof current.bootSession === 'string' &&
    typeof owner.bootSession === 'string'
  ) {
    return current.bootSession === owner.bootSession
  }
  if (current.boot === owner.boot) {
    return true
  }
  if (process.platform !== 'darwin') {
    return false
  }
  const currentBoots = new Set(
    [current.boot, current.bootSession].filter(
      (value): value is string => typeof value === 'string',
    ),
  )
  return [owner.boot, owner.bootSession].some(
    (value) => typeof value === 'string' && currentBoots.has(value),
  )
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function getCurrentProcessIncarnation() {
  if (currentProcessIncarnation !== undefined) {
    return Promise.resolve(currentProcessIncarnation)
  }
  if (currentProcessIncarnationProbe !== undefined) {
    return currentProcessIncarnationProbe
  }

  const probe = readProcessIncarnation(process.pid)
  currentProcessIncarnationProbe = probe
  void probe.then(
    (incarnation) => {
      if (incarnation !== null) {
        currentProcessIncarnation = incarnation
      }
      if (currentProcessIncarnationProbe === probe) {
        currentProcessIncarnationProbe = undefined
      }
    },
    () => {
      if (currentProcessIncarnationProbe === probe) {
        currentProcessIncarnationProbe = undefined
      }
    },
  )
  return probe
}

export function createProcessExecutionIdentityGetter(
  readIdentity: () => Promise<ProcessExecutionIdentity>,
  incompleteCacheDuration: number,
  now: () => number = () => performance.now(),
) {
  // Complete host identity is stable for this process. A missing component can
  // be a transient command timeout, so retain it only long enough to rate-limit
  // owner-state polling before probing again.
  let observation:
    | {
        identity: ProcessExecutionIdentity
        retryAt: number
      }
    | undefined
  let activeProbe: Promise<ProcessExecutionIdentity> | undefined

  return function getProcessExecutionIdentity() {
    if (
      observation !== undefined &&
      isCompleteProcessExecutionIdentity(observation.identity)
    ) {
      return Promise.resolve(observation.identity)
    }
    if (activeProbe !== undefined) {
      return activeProbe
    }
    if (observation !== undefined && now() < observation.retryAt) {
      return Promise.resolve(observation.identity)
    }

    const probe = readIdentity().then((identity) => {
      const previousIdentity = observation?.identity
      const mergedIdentity = {
        boot: identity.boot ?? previousIdentity?.boot ?? null,
        bootSession:
          identity.bootSession ?? previousIdentity?.bootSession ?? null,
        machine: identity.machine ?? previousIdentity?.machine ?? null,
        namespace: identity.namespace ?? previousIdentity?.namespace ?? null,
      }
      observation = {
        identity: mergedIdentity,
        retryAt: isCompleteProcessExecutionIdentity(mergedIdentity)
          ? Number.POSITIVE_INFINITY
          : now() + incompleteCacheDuration,
      }
      return mergedIdentity
    })
    activeProbe = probe
    void probe.then(
      () => {
        if (activeProbe === probe) {
          activeProbe = undefined
        }
      },
      () => {
        if (observation !== undefined) {
          observation.retryAt = now() + incompleteCacheDuration
        }
        if (activeProbe === probe) {
          activeProbe = undefined
        }
      },
    )
    return probe
  }
}

function isCompleteProcessExecutionIdentity(
  identity: ProcessExecutionIdentity,
) {
  return (
    identity.boot !== null &&
    identity.machine !== null &&
    identity.namespace !== null
  )
}

const getCurrentProcessExecutionIdentity = createProcessExecutionIdentityGetter(
  readProcessExecutionIdentity,
  incompleteProcessExecutionIdentityCacheDuration,
)

async function readProcessExecutionIdentity(): Promise<ProcessExecutionIdentity> {
  if (process.platform === 'linux') {
    const [bootId, machineId, productUuid, pidNamespace] = await Promise.all([
      readLinuxBootId(),
      readValidatedIdentityFile('/etc/machine-id', /^[0-9a-f]{32}$/i),
      readValidatedIdentityFile(
        '/sys/class/dmi/id/product_uuid',
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
      ),
      readlink('/proc/self/ns/pid').catch(() => null),
    ])
    return {
      boot: bootId,
      bootSession: null,
      machine: machineId
        ? `linux-machine:${machineId}:${productUuid ?? 'unknown'}`
        : null,
      namespace:
        pidNamespace !== null && /^pid:\[\d+\]$/.test(pidNamespace)
          ? `linux-pid-namespace:${pidNamespace}`
          : null,
    }
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot
    const reg = systemRoot ? join(systemRoot, 'System32', 'reg.exe') : 'reg.exe'
    const powershell = systemRoot
      ? join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        )
      : 'powershell.exe'
    const [machineOutput, boot] = await Promise.all([
      executeProcessIncarnationCommand(reg, [
        'query',
        String.raw`HKLM\SOFTWARE\Microsoft\Cryptography`,
        '/v',
        'MachineGuid',
      ]),
      executeProcessIncarnationCommand(powershell, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks',
      ]),
    ])
    const machineGuid = machineOutput?.match(
      /\bMachineGuid\s+REG_SZ\s+([0-9a-f-]+)\s*$/i,
    )?.[1]
    return {
      boot: boot !== null && /^\d+$/.test(boot) ? `windows-boot:${boot}` : null,
      bootSession: null,
      machine: machineGuid
        ? `windows-machine:${machineGuid.toLowerCase()}`
        : null,
      namespace: 'windows-global',
    }
  }
  if (process.platform === 'darwin') {
    const [machineOutput, bootSessionOutput, bootTimeOutput] =
      await Promise.all([
        executeProcessIncarnationCommand('/usr/sbin/ioreg', [
          '-rd1',
          '-c',
          'IOPlatformExpertDevice',
        ]),
        executeProcessIncarnationCommand('/usr/sbin/sysctl', [
          '-n',
          'kern.bootsessionuuid',
        ]),
        executeProcessIncarnationCommand('/usr/sbin/sysctl', [
          '-n',
          'kern.boottime',
        ]),
      ])
    const platformUuid = machineOutput?.match(
      /"IOPlatformUUID"\s*=\s*"([0-9a-f-]+)"/i,
    )?.[1]
    const bootSessionUuid = bootSessionOutput?.match(
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
    )?.[0]
    const bootSeconds = bootTimeOutput?.match(/\bsec\s*=\s*(\d+)/)?.[1]
    return {
      // Keep the seconds encoding in `boot` so old binaries compare the same
      // session safely. New binaries prefer the UUID and also recognize the
      // UUID-only encoding emitted by the short-lived intermediate format.
      boot: bootSeconds ? `darwin-boot:${bootSeconds}` : null,
      bootSession: bootSessionUuid
        ? `darwin-boot:${bootSessionUuid.toLowerCase()}`
        : null,
      machine: platformUuid
        ? `darwin-machine:${platformUuid.toLowerCase()}`
        : null,
      namespace: 'darwin-global',
    }
  }
  return {
    boot: null,
    bootSession: null,
    machine: null,
    namespace: null,
  }
}

async function readValidatedIdentityFile(path: string, pattern: RegExp) {
  try {
    const value = (await readFile(path, 'utf8')).trim().toLowerCase()
    return pattern.test(value) ? value : null
  } catch {
    return null
  }
}

async function observeProcessIncarnation(
  pid: number,
  expectedIncarnation: string,
) {
  if (pid === process.pid) {
    return getCurrentProcessIncarnation()
  }
  const now = performance.now()
  const cached = processIncarnationObservations.get(pid)
  // A cached equality can only delay PID-reuse detection. Never reclaim from
  // a cached mismatch because the PID may have been reused since observation.
  if (
    cached &&
    cached.expiresAt > now &&
    cached.incarnation === expectedIncarnation
  ) {
    return cached.incarnation
  }
  const incarnation = await readProcessIncarnation(pid)
  processIncarnationObservations.set(pid, {
    expiresAt: performance.now() + processIncarnationObservationCacheDuration,
    incarnation,
  })
  return incarnation
}

async function readProcessIncarnation(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    return readLinuxProcessIncarnation(pid)
  }
  if (process.platform === 'win32') {
    return readWindowsProcessIncarnation(pid)
  }
  return readPosixProcessIncarnation(pid)
}

async function readLinuxProcessIncarnation(pid: number) {
  try {
    const [content, bootId] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readLinuxBootId(),
    ])
    if (bootId === null) {
      return null
    }
    const commandEnd = content.lastIndexOf(')')
    if (commandEnd === -1) {
      return null
    }
    const fields = content
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/)
    const startTime = fields[19]
    return startTime && /^\d+$/.test(startTime)
      ? `linux-proc:${bootId}:${startTime}`
      : null
  } catch {
    return null
  }
}

async function readLinuxBootId() {
  if (linuxBootId !== undefined) {
    return linuxBootId
  }
  try {
    const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8'))
      .trim()
      .toLowerCase()
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(bootId)) {
      return null
    }
    linuxBootId = bootId
    return bootId
  } catch {
    return null
  }
}

async function readWindowsProcessIncarnation(pid: number) {
  const systemRoot = process.env.SystemRoot
  const powershell = systemRoot
    ? join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
    : 'powershell.exe'
  const startTime = await executeProcessIncarnationCommand(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `try { (Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks } catch { exit 1 }`,
  ])
  return startTime && /^\d+$/.test(startTime)
    ? `windows-start:${startTime}`
    : null
}

async function readPosixProcessIncarnation(pid: number) {
  const startTime = await executeProcessIncarnationCommand(
    '/bin/ps',
    ['-o', 'lstart=', '-p', String(pid)],
    {
      ...process.env,
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
  )
  return startTime
    ? `ps-lstart:${Buffer.from(startTime).toString('base64url')}`
    : null
}

function executeProcessIncarnationCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  return new Promise((resolveCommand) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        env,
        timeout: processIncarnationCommandTimeout,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolveCommand(null)
          return
        }
        const output = stdout.trim()
        resolveCommand(output || null)
      },
    )
  })
}

function assertReconciliationLockAcquisitionTimeRemaining(
  acquisitionDeadline: ReconciliationLockDeadline,
  key: string,
) {
  if (performance.now() < acquisitionDeadline.expiresAt) {
    return
  }
  const error = new Error(
    `Timed out after ${acquisitionDeadline.timeout}ms waiting for filesystem reconciliation lock: ${key}`,
  ) as NodeJS.ErrnoException
  error.code = 'ETIMEDOUT'
  throw error
}

async function delayReconciliationLockRetry(
  acquisitionDeadline: ReconciliationLockDeadline,
  key: string,
) {
  assertReconciliationLockAcquisitionTimeRemaining(acquisitionDeadline, key)
  await delay(
    Math.max(
      0,
      Math.min(20, acquisitionDeadline.expiresAt - performance.now()),
    ),
  )
}

function createReconciliationLockDeadline(
  timeout: number,
): ReconciliationLockDeadline {
  return {
    expiresAt: performance.now() + timeout,
    timeout,
  }
}

function resolveTransactionPath(root: string, path: string) {
  const resolved = resolve(path)
  const relativePath = relative(root, resolved)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath)
  ) {
    if (relativePath === '') {
      throw new Error(
        `A filesystem transaction cannot replace its root: ${path}`,
      )
    }
    throw new Error(`Filesystem transaction path escapes ${root}: ${path}`)
  }
  return resolved
}

async function resolveCanonicalTransactionPath(
  requestedRoot: string,
  canonicalRoot: string,
  path: string,
) {
  const requestedPath = resolveTransactionPath(requestedRoot, path)
  const canonicalParent = await canonicalizeReconciliationPath(
    dirname(requestedPath),
  )
  return resolveTransactionPath(
    canonicalRoot,
    join(canonicalParent, basename(requestedPath)),
  )
}

async function captureTransactionParentIdentity(
  root: string,
  parent: string,
): Promise<TransactionParentIdentity> {
  const canonicalParent = await canonicalizeReconciliationPath(parent)
  resolveTransactionPath(root, join(canonicalParent, '.napi-parent-check'))

  let identityPath = canonicalParent
  let identityStats = await lstatIfExists(identityPath, { bigint: true })
  while (!identityStats) {
    const next = dirname(identityPath)
    if (next === identityPath) {
      throw new Error(
        `Could not resolve filesystem transaction parent identity: ${parent}`,
      )
    }
    identityPath = next
    identityStats = await lstatIfExists(identityPath, { bigint: true })
  }
  if (!identityStats.isDirectory()) {
    throw new Error(
      `Filesystem transaction parent is not a directory: ${identityPath}`,
    )
  }
  return {
    canonicalParent,
    dev: String(identityStats.dev),
    identityPath,
    ino: String(identityStats.ino),
  }
}

async function assertTransactionParentUnchanged(
  root: string,
  path: string,
  parentIdentities: Map<string, TransactionParentIdentity>,
) {
  const parent = dirname(path)
  const expected = parentIdentities.get(parent)
  if (!expected) {
    throw new Error(
      `Filesystem transaction parent identity was not captured: ${parent}`,
    )
  }
  const canonicalParent = await canonicalizeReconciliationPath(parent)
  if (
    !pathsHaveEquivalentPlatformSpelling(
      expected.canonicalParent,
      canonicalParent,
    )
  ) {
    throw new Error(
      `Filesystem transaction parent changed from ${expected.canonicalParent} to ${canonicalParent}`,
    )
  }
  const identityStats = await lstatIfExists(expected.identityPath, {
    bigint: true,
  })
  if (
    !identityStats?.isDirectory() ||
    String(identityStats.dev) !== expected.dev ||
    String(identityStats.ino) !== expected.ino
  ) {
    throw new Error(
      `Filesystem transaction parent identity changed: ${expected.identityPath}`,
    )
  }
  resolveTransactionPath(root, join(canonicalParent, basename(path)))
}

function fileSystemTransactionJournalPath(root: string) {
  return join(root, fileSystemTransactionJournalName)
}

function fileSystemTransactionSiblingPath(
  root: string,
  marker: string,
  token: string,
) {
  return join(
    root,
    `${basename(
      fileSystemTransactionJournalName,
      extname(fileSystemTransactionJournalName),
    )}${marker}${token}${extname(fileSystemTransactionJournalName)}`,
  )
}

function fileSystemTransactionRetiredPath(
  root: string,
  excludedToken?: string,
) {
  let token: string
  do {
    token = randomUUID()
  } while (
    excludedToken !== undefined &&
    fileSystemTransactionTokensMatch(token, excludedToken)
  )
  return fileSystemTransactionSiblingPath(
    root,
    fileSystemTransactionRetiredMarker,
    token,
  )
}

function fileSystemTransactionTokensMatch(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase()
}

function parseFileSystemTransactionSiblingName(name: string) {
  const journalExtension = extname(fileSystemTransactionJournalName)
  const journalBase = basename(
    fileSystemTransactionJournalName,
    journalExtension,
  )
  const normalizedName = fileSystemTransactionPlatformPathKey(name)
  for (const [kind, marker] of [
    ['candidate', fileSystemTransactionCandidateMarker],
    ['retired', fileSystemTransactionRetiredMarker],
  ] as const) {
    const prefix = `${journalBase}${marker}`
    const normalizedPrefix = fileSystemTransactionPlatformPathKey(prefix)
    const normalizedExtension =
      fileSystemTransactionPlatformPathKey(journalExtension)
    if (
      !normalizedName.startsWith(normalizedPrefix) ||
      !normalizedName.endsWith(normalizedExtension)
    ) {
      continue
    }
    const token = name.slice(prefix.length, -journalExtension.length)
    if (
      isReconciliationLockToken(token) &&
      normalizedName ===
        fileSystemTransactionPlatformPathKey(
          `${prefix}${token}${journalExtension}`,
        )
    ) {
      return { kind, token }
    }
  }
}

async function createFileSystemTransactionCandidate(root: string) {
  while (true) {
    const token = randomUUID()
    const path = fileSystemTransactionSiblingPath(
      root,
      fileSystemTransactionCandidateMarker,
      token,
    )
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      throw error
    }
    const stats = await lstat(path, { bigint: true })
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        `Filesystem transaction candidate is not a directory: ${path}`,
      )
    }
    return { path, stats, token }
  }
}

/**
 * True when the file currently at a failed snapshot's destination pathname is
 * the exact inode this transaction created with `open(..., 'wx')`, so the
 * cleanup guard may safely unlink it. Identity is compared on the exact decimal
 * strings captured from a bigint stat, never the lossy Number dev/ino fields:
 * on Windows two distinct NTFS inodes past 2 ** 53 collapse onto a single JS
 * double, so a Number match would let the guard delete a successor file that
 * replaced our pathname and that the transaction never owned.
 */
export function snapshotLeftoverIsTransactionOwned(
  currentStats: BigIntStats | undefined,
  identity: FileSystemTransactionFileIdentity,
): boolean {
  return (
    currentStats?.isFile() === true &&
    String(currentStats.dev) === identity.dev &&
    String(currentStats.ino) === identity.ino
  )
}

async function snapshotFileSystemTransactionInput(
  source: string,
  destination: string,
  mode?: number,
  expectedStats?: BigIntStats,
  destinationMode = 0o400,
  createDestinationParent = true,
  assertDestinationParentUnchanged?: () => Promise<void>,
  recordDestinationIdentity?: (
    identity: FileSystemTransactionFileIdentity,
  ) => Promise<void>,
): Promise<FileSystemTransactionJournalFileState> {
  const initialPathStats = await lstatIfExists(source)
  if (!initialPathStats?.isFile()) {
    throw new Error(
      `Filesystem transaction source is not a regular file: ${source}`,
    )
  }
  if (expectedStats) {
    // Compare exact 64-bit identity, never the lossy Number dev/ino: a
    // Number-colliding external replacement of the source (two distinct inodes
    // past 2 ** 53 sharing one double) must be detected as a conflict rather than
    // silently adopted and snapshotted as if it were the expected file.
    const sourceIdentityStats = await lstatIfExists(source, { bigint: true })
    if (
      sourceIdentityStats?.isFile() !== true ||
      sourceIdentityStats.dev !== expectedStats.dev ||
      sourceIdentityStats.ino !== expectedStats.ino
    ) {
      throw fileSystemTransactionConflictError(
        source,
        'changed before it could be snapshotted',
      )
    }
  }
  let sourceHandle
  try {
    sourceHandle = await open(
      source,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    )
  } catch (error) {
    throw fileSystemTransactionOperationError(
      `Failed to open transaction source ${source}`,
      error,
    )
  }
  try {
    const sourceStats = await sourceHandle.stat()
    if (
      !sourceStats.isFile() ||
      sourceStats.dev !== initialPathStats.dev ||
      sourceStats.ino !== initialPathStats.ino
    ) {
      throw new Error(
        `Filesystem transaction source changed while it was opened: ${source}`,
      )
    }
    if (expectedStats) {
      // Re-bind the exact 64-bit identity to the descriptor we just opened. The
      // pre-open preflight validated the pathname, but `open` pins whatever inode
      // is at the path *now*; a Number-colliding successor swapped into the
      // pre-open window would still pass the lossy Number gate above (two distinct
      // inodes past 2 ** 53 share one JS double). Compare the pinned fd's exact
      // bigint dev/ino against the caller's expected identity so such a swap is
      // raised as a conflict instead of being snapshotted and recorded as the
      // original.
      const openedIdentityStats = await sourceHandle.stat({ bigint: true })
      if (
        openedIdentityStats.dev !== expectedStats.dev ||
        openedIdentityStats.ino !== expectedStats.ino
      ) {
        throw fileSystemTransactionConflictError(
          source,
          'changed before it could be snapshotted',
        )
      }
    }
    const finalMode = mode ?? sourceStats.mode & 0o7777
    if (createDestinationParent) {
      await mkdir(dirname(destination), { recursive: true })
    }
    await assertDestinationParentUnchanged?.()
    let destinationHandle
    try {
      destinationHandle = await open(destination, 'wx', 0o600)
    } catch (error) {
      throw fileSystemTransactionOperationError(
        `Failed to create transaction snapshot ${destination}`,
        error,
      )
    }
    let destinationStats: Stats | undefined
    let destinationIdentity: FileSystemTransactionFileIdentity | undefined
    let committed = false
    try {
      destinationStats = await destinationHandle.stat()
      if (!destinationStats.isFile()) {
        throw new Error(
          `Filesystem transaction snapshot is not a regular file: ${destination}`,
        )
      }
      // Capture the exact 64-bit identity of the transaction-owned inode from the
      // open handle once. The open descriptor pins the inode, so this is the
      // authoritative identity both for the recorded journal entry and for the
      // failed-snapshot cleanup guard that must not unlink a colliding successor.
      const destinationIdentityStats = await destinationHandle.stat({
        bigint: true,
      })
      destinationIdentity = {
        dev: String(destinationIdentityStats.dev),
        ino: String(destinationIdentityStats.ino),
      }
      await assertDestinationParentUnchanged?.()
      if (recordDestinationIdentity) {
        const destinationPathStats = await lstatIfExists(destination)
        if (
          destinationPathStats?.isFile() !== true ||
          destinationPathStats.dev !== destinationStats.dev ||
          destinationPathStats.ino !== destinationStats.ino
        ) {
          throw new Error(
            `Filesystem transaction snapshot path changed before its identity was recorded: ${destination}`,
          )
        }
        await recordDestinationIdentity(destinationIdentity)
      }
      const hash = createHash('sha256')
      const buffer = Buffer.allocUnsafe(64 * 1024)
      let position = 0
      while (true) {
        const { bytesRead } = await sourceHandle.read(
          buffer,
          0,
          buffer.length,
          position,
        )
        if (bytesRead === 0) {
          break
        }
        hash.update(buffer.subarray(0, bytesRead))
        let written = 0
        while (written < bytesRead) {
          const result = await destinationHandle.write(
            buffer,
            written,
            bytesRead - written,
            position + written,
          )
          written += result.bytesWritten
        }
        position += bytesRead
      }
      const [finalSourceStats, finalPathStats] = await Promise.all([
        sourceHandle.stat(),
        lstatIfExists(source),
      ])
      if (
        finalSourceStats.dev !== sourceStats.dev ||
        finalSourceStats.ino !== sourceStats.ino ||
        finalSourceStats.size !== sourceStats.size ||
        finalSourceStats.size !== position ||
        finalSourceStats.mode !== sourceStats.mode ||
        finalSourceStats.mtimeMs !== sourceStats.mtimeMs ||
        finalSourceStats.ctimeMs !== sourceStats.ctimeMs ||
        finalPathStats?.isFile() !== true ||
        finalPathStats.dev !== sourceStats.dev ||
        finalPathStats.ino !== sourceStats.ino
      ) {
        throw new Error(
          `Filesystem transaction source changed while it was snapshotted: ${source}`,
        )
      }
      await applyFileSystemTransactionMode(destinationHandle, destinationMode)
      await destinationHandle.sync()
      const finalDestinationStats = await destinationHandle.stat()
      if (
        !finalDestinationStats.isFile() ||
        finalDestinationStats.dev !== destinationStats.dev ||
        finalDestinationStats.ino !== destinationStats.ino
      ) {
        throw new Error(
          `Filesystem transaction snapshot changed while it was written: ${destination}`,
        )
      }
      await assertDestinationParentUnchanged?.()
      const finalDestinationPathStats = await lstatIfExists(destination)
      if (
        finalDestinationPathStats?.isFile() !== true ||
        finalDestinationPathStats.dev !== destinationStats.dev ||
        finalDestinationPathStats.ino !== destinationStats.ino
      ) {
        throw new Error(
          `Filesystem transaction snapshot path changed while it was written: ${destination}`,
        )
      }
      await destinationHandle.close()
      await syncDirectory(dirname(destination))
      committed = true
      const sourceIdentityStats = await sourceHandle.stat({ bigint: true })
      return {
        dev: String(sourceIdentityStats.dev),
        hash: hash.digest('hex'),
        ino: String(sourceIdentityStats.ino),
        mode: finalMode,
      }
    } finally {
      await destinationHandle.close().catch(() => {})
      if (!committed) {
        if (
          destinationStats === undefined ||
          destinationIdentity === undefined
        ) {
          // open('wx') created this unpredictable transaction-owned pathname.
          // There is no inode identity after a failed first fstat, so close the
          // handle first and make the best cleanup Node's pathname API permits.
          await unlinkFileIfExists(destination)
        } else {
          // Only unlink when the pathname still resolves to the exact inode this
          // transaction created. The identity match is on decimal-string dev/ino
          // (see snapshotLeftoverIsTransactionOwned), never lossy Number fields,
          // so a Number-colliding successor past 2 ** 53 is preserved, not
          // destroyed.
          const currentStats = await lstatIfExists(destination, {
            bigint: true,
          })
          if (
            snapshotLeftoverIsTransactionOwned(
              currentStats,
              destinationIdentity,
            )
          ) {
            await unlinkFileIfExists(destination)
          }
        }
      }
    }
  } finally {
    await sourceHandle.close()
  }
}

async function applyFileSystemTransactionMode(
  handle: FileHandle,
  mode: number,
) {
  // Node exposes only the owner write bit on Windows. Preserve that meaningful
  // read-only/writable distinction instead of silently ignoring requested mode.
  await handle.chmod(
    process.platform === 'win32' ? (mode & 0o200 ? 0o600 : 0o400) : mode,
  )
}

function fileSystemTransactionFileContents(
  state: FileSystemTransactionJournalFileState,
): FileSystemTransactionJournalFileState {
  return {
    hash: state.hash,
    mode: state.mode,
  }
}

function fileSystemTransactionRelativePath(
  root: string,
  path: string,
  label: string,
  allowRoot = false,
) {
  const resolvedPath = resolve(path)
  const relativePath = relative(root, resolvedPath)
  if (relativePath === '') {
    if (allowRoot) {
      return '.'
    }
    throw new Error(`${label} cannot be the transaction root: ${path}`)
  }
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes ${root}: ${path}`)
  }
  return relativePath
}

function resolveFileSystemTransactionRelativePath(
  root: string,
  relativePath: string,
  label: string,
  allowRoot = false,
) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > 8_192 ||
    relativePath.includes('\0')
  ) {
    throw new Error(`Invalid ${label.toLowerCase()} in transaction journal`)
  }
  const resolvedPath = resolve(root, relativePath)
  fileSystemTransactionRelativePath(root, resolvedPath, label, allowRoot)
  return resolvedPath
}

function assertFileSystemTransactionPathIsNotReserved(
  root: string,
  path: string,
) {
  const relativePath = relative(root, path)
  const firstSegment = relativePath.split(sep, 1)[0]
  const journalBase = basename(
    fileSystemTransactionJournalName,
    extname(fileSystemTransactionJournalName),
  )
  const segmentKey = fileSystemTransactionPlatformPathKey(firstSegment)
  const journalNameKey = fileSystemTransactionPlatformPathKey(
    fileSystemTransactionJournalName,
  )
  const candidatePrefixKey = fileSystemTransactionPlatformPathKey(
    `${journalBase}${fileSystemTransactionCandidateMarker}`,
  )
  const retiredPrefixKey = fileSystemTransactionPlatformPathKey(
    `${journalBase}${fileSystemTransactionRetiredMarker}`,
  )
  const extensionKey = fileSystemTransactionPlatformPathKey(
    extname(fileSystemTransactionJournalName),
  )
  const reserved =
    segmentKey === journalNameKey ||
    ((segmentKey.startsWith(candidatePrefixKey) ||
      segmentKey.startsWith(retiredPrefixKey)) &&
      segmentKey.endsWith(extensionKey))
  if (reserved) {
    throw new Error(
      `Filesystem transaction path overlaps reserved recovery state: ${path}`,
    )
  }
}

function fileSystemTransactionArtifactPath(
  path: string,
  token: string,
  index: number,
  kind: 'prepared' | 'retired' | 'rollback',
) {
  return join(dirname(path), `.${basename(path)}.${token}.${index}.${kind}.tmp`)
}

function isOwnedFileSystemTransactionArtifactPath(
  path: string,
  artifact: string,
  token: string,
  kind: 'prepared' | 'retired' | 'rollback',
) {
  if (
    !pathsHaveEquivalentPlatformSpelling(dirname(artifact), dirname(path)) ||
    pathsHaveEquivalentPlatformSpelling(artifact, path)
  ) {
    return false
  }
  const artifactName = fileSystemTransactionPlatformPathKey(basename(artifact))
  const prefix = fileSystemTransactionPlatformPathKey(
    `.${basename(path)}.${token}.`,
  )
  const suffix = fileSystemTransactionPlatformPathKey(`.${kind}.tmp`)
  if (
    !artifactName.startsWith(prefix) ||
    !artifactName.endsWith(suffix) ||
    artifactName.length <= prefix.length + suffix.length
  ) {
    return false
  }
  return /^(?:0|[1-9]\d*)$/.test(
    artifactName.slice(prefix.length, -suffix.length),
  )
}

async function fileSystemTransactionFileState(
  path: string,
  mode?: number,
): Promise<FileSystemTransactionJournalFileState> {
  const identity = await openFileSystemTransactionIdentity(path, mode)
  try {
    return identity.state
  } finally {
    await identity.handle.close()
  }
}

async function openFileSystemTransactionIdentity(
  path: string,
  mode?: number,
): Promise<OpenFileSystemTransactionIdentity> {
  const pathStats = await lstat(path)
  if (!pathStats.isFile()) {
    throw new Error(
      `Filesystem transaction path is not a regular file: ${path}`,
    )
  }
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    throw fileSystemTransactionOperationError(
      `Failed to open transaction file ${path}`,
      error,
    )
  }
  try {
    const stats = await handle.stat()
    // Capture 64-bit dev/ino from a bigint stat of the same open handle so the
    // recorded identity is exact even when it exceeds Number.MAX_SAFE_INTEGER.
    // The open descriptor pins the inode, so this matches the verified `stats`.
    const identityStats = await handle.stat({ bigint: true })
    if (
      !stats.isFile() ||
      stats.dev !== pathStats.dev ||
      stats.ino !== pathStats.ino
    ) {
      throw new Error(
        `Filesystem transaction path changed while it was opened: ${path}`,
      )
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      )
      if (bytesRead === 0) {
        break
      }
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    const [finalStats, finalPathStats] = await Promise.all([
      handle.stat(),
      lstatIfExists(path),
    ])
    if (
      finalStats.dev !== stats.dev ||
      finalStats.ino !== stats.ino ||
      finalStats.size !== stats.size ||
      finalStats.size !== position ||
      finalStats.mode !== stats.mode ||
      finalStats.mtimeMs !== stats.mtimeMs ||
      finalStats.ctimeMs !== stats.ctimeMs ||
      finalPathStats?.isFile() !== true ||
      finalPathStats.dev !== stats.dev ||
      finalPathStats.ino !== stats.ino
    ) {
      throw new Error(
        `Filesystem transaction file changed while it was read: ${path}`,
      )
    }
    return {
      handle,
      state: {
        dev: String(identityStats.dev),
        hash: hash.digest('hex'),
        ino: String(identityStats.ino),
        mode: mode ?? stats.mode & 0o7777,
      },
    }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function fileSystemTransactionFileStateIfExists(path: string) {
  try {
    return await fileSystemTransactionFileState(path)
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as Error & { cause?: NodeJS.ErrnoException }).cause?.code ===
        'ENOENT'
    ) {
      return
    }
    throw error
  }
}

function fileSystemTransactionFileContentsMatch(
  left: FileSystemTransactionJournalFileState | undefined,
  right: FileSystemTransactionJournalFileState | undefined,
) {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
        left.hash === right.hash &&
        fileSystemTransactionModesMatch(left.mode, right.mode)
}

function fileSystemTransactionModesMatch(left: number, right: number) {
  return process.platform === 'win32'
    ? (left & 0o200) === (right & 0o200)
    : left === right
}

function fileSystemTransactionFileStatesExactlyMatch(
  left: FileSystemTransactionJournalFileState | undefined,
  right: FileSystemTransactionJournalFileState | undefined,
) {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
        left.dev !== undefined &&
        left.ino !== undefined &&
        right.dev !== undefined &&
        right.ino !== undefined &&
        left.dev === right.dev &&
        left.ino === right.ino &&
        fileSystemTransactionFileContentsMatch(left, right)
}

function fileSystemTransactionConflictError(
  path: string,
  message: string,
  cause?: unknown,
) {
  const error = new Error(
    `Filesystem transaction conflict at ${path}: ${message}; the transaction refused to overwrite or discard the unexpected entry`,
    cause === undefined ? undefined : { cause },
  ) as NodeJS.ErrnoException
  error.code = 'ESTALE'
  error.path = path
  return error
}

function fileSystemTransactionOperationError(message: string, cause: unknown) {
  const error = new Error(message, { cause }) as NodeJS.ErrnoException
  if (cause && typeof cause === 'object') {
    const fileSystemCause = cause as NodeJS.ErrnoException
    error.code = fileSystemCause.code
    error.errno = fileSystemCause.errno
    error.path = fileSystemCause.path
    error.syscall = fileSystemCause.syscall
  }
  return error
}

async function prepareFileSystemTransactionReplacement(
  source: string,
  prepared: string,
  expected: FileSystemTransactionJournalFileState,
  assertParentUnchanged: () => Promise<void>,
  recordPreparedIdentity: (
    identity: FileSystemTransactionFileIdentity,
  ) => Promise<void>,
): Promise<FileSystemTransactionJournalFileState> {
  await assertParentUnchanged()
  const sourceState = await snapshotFileSystemTransactionInput(
    source,
    prepared,
    expected.mode,
    undefined,
    expected.mode,
    false,
    assertParentUnchanged,
    recordPreparedIdentity,
  )
  if (
    sourceState.hash !== expected.hash ||
    !fileSystemTransactionModesMatch(sourceState.mode, expected.mode)
  ) {
    throw new Error(
      `Filesystem transaction input changed before replacement preparation: ${source}`,
    )
  }
  await assertParentUnchanged()
  const state = await fileSystemTransactionFileState(prepared)
  if (
    state.hash !== expected.hash ||
    !fileSystemTransactionModesMatch(state.mode, expected.mode)
  ) {
    throw new Error(
      `Filesystem transaction replacement changed while it was prepared: ${prepared}`,
    )
  }
  return state
}

async function assertFileSystemTransactionPathMatches(
  path: string,
  expected: FileSystemTransactionJournalFileState | undefined,
  stage: string,
) {
  let current: FileSystemTransactionJournalFileState | undefined
  try {
    current = await fileSystemTransactionFileStateIfExists(path)
  } catch (error) {
    throw fileSystemTransactionConflictError(path, stage, error)
  }
  if (!fileSystemTransactionFileStatesExactlyMatch(current, expected)) {
    throw fileSystemTransactionConflictError(path, stage)
  }
}

async function restoreUnexpectedFileSystemTransactionRetirement(
  retired: string,
  destination: string,
  assertParentUnchanged: () => Promise<void>,
) {
  await assertParentUnchanged()
  try {
    await link(retired, destination)
    await syncDirectory(dirname(destination))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw fileSystemTransactionOperationError(
      `Failed to restore unexpected transaction entry from ${retired} to ${destination}`,
      error,
    )
  }
}

async function retireExactFileSystemTransactionPath(
  path: string,
  expected: FileSystemTransactionJournalFileState | undefined,
  retired: string,
  stage: string,
  assertParentUnchanged: () => Promise<void>,
) {
  await assertParentUnchanged()
  await assertFileSystemTransactionPathMatches(path, expected, stage)
  if (expected === undefined) {
    return
  }
  if ((await lstatIfExists(retired)) !== undefined) {
    throw fileSystemTransactionConflictError(
      retired,
      `the retirement path was occupied ${stage}`,
    )
  }

  const identity = await openFileSystemTransactionIdentity(path)
  if (!fileSystemTransactionFileStatesExactlyMatch(identity.state, expected)) {
    await identity.handle.close()
    throw fileSystemTransactionConflictError(path, stage)
  }
  try {
    await assertParentUnchanged()
    await assertFileSystemTransactionPathMatches(path, expected, stage)
    if ((await lstatIfExists(retired)) !== undefined) {
      throw fileSystemTransactionConflictError(
        retired,
        `the retirement path was occupied ${stage}`,
      )
    }

    // Node has no renameat2(RENAME_NOREPLACE) or directory-handle-relative
    // mutation. The random predeclared retirement pathname and the post-rename
    // inode check contain every race except this irreducible pathname interval.
    await rename(path, retired)
    await assertParentUnchanged()
    const retiredState = await fileSystemTransactionFileStateIfExists(retired)
    if (
      !fileSystemTransactionFileStatesExactlyMatch(retiredState, identity.state)
    ) {
      const restored = await restoreUnexpectedFileSystemTransactionRetirement(
        retired,
        path,
        assertParentUnchanged,
      )
      throw fileSystemTransactionConflictError(
        path,
        restored
          ? `${stage}; an unexpected entry was retired and restored`
          : `${stage}; an unexpected entry was preserved at ${retired} because a successor already occupies the destination`,
      )
    }
    await syncDirectory(dirname(path))
  } finally {
    await identity.handle.close()
  }
}

async function publishPreparedFileSystemTransactionReplacement(
  destination: string,
  expectedDestination: FileSystemTransactionJournalFileState | undefined,
  prepared: string,
  expectedPrepared: FileSystemTransactionJournalFileState,
  retired: string,
  assertParentUnchanged: () => Promise<void>,
) {
  if (expectedDestination !== undefined) {
    await retireExactFileSystemTransactionPath(
      destination,
      expectedDestination,
      retired,
      'before replacement',
      assertParentUnchanged,
    )
  } else {
    await assertParentUnchanged()
    await assertFileSystemTransactionPathMatches(
      destination,
      undefined,
      'the destination changed before publication',
    )
  }

  const identity = await openFileSystemTransactionIdentity(prepared)
  if (
    !fileSystemTransactionFileStatesExactlyMatch(
      identity.state,
      expectedPrepared,
    )
  ) {
    await identity.handle.close()
    throw fileSystemTransactionConflictError(
      prepared,
      'the transaction-owned prepared replacement changed before publication',
    )
  }
  try {
    await assertParentUnchanged()
    try {
      // link() is the no-replace publication primitive available in Node. The
      // prepared pathname remains as an identity anchor until the transaction
      // has committed or rolled back, preventing inode-number ABA.
      await link(prepared, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw fileSystemTransactionConflictError(
          destination,
          'a successor appeared before transaction publication',
          error,
        )
      }
      throw fileSystemTransactionOperationError(
        `Failed to publish transaction replacement at ${destination}`,
        error,
      )
    }
    await assertParentUnchanged()
    await syncDirectory(dirname(destination))
    await assertFileSystemTransactionPathMatches(
      destination,
      identity.state,
      'the published destination does not contain the transaction output',
    )
  } finally {
    await identity.handle.close()
  }
}

async function commitFileSystemTransactionReplacement(
  root: string,
  destination: string,
  parentIdentities: Map<string, TransactionParentIdentity>,
  expectedDestination: FileSystemTransactionJournalFileState | undefined,
  prepared: string,
  expectedPrepared: FileSystemTransactionJournalFileState,
  retired: string,
) {
  await publishPreparedFileSystemTransactionReplacement(
    destination,
    expectedDestination,
    prepared,
    expectedPrepared,
    retired,
    () => assertTransactionParentUnchanged(root, destination, parentIdentities),
  )
}

async function removeFileSystemTransactionPath(
  root: string,
  path: string,
  parentIdentities: Map<string, TransactionParentIdentity>,
  expected: FileSystemTransactionJournalFileState | undefined,
  retired: string,
  stage: string,
) {
  await retireExactFileSystemTransactionPath(
    path,
    expected,
    retired,
    stage,
    () => assertTransactionParentUnchanged(root, path, parentIdentities),
  )
}

async function writeFileSystemTransactionJournal(
  journalRoot: string,
  journal: FileSystemTransactionJournal,
) {
  const content = JSON.stringify(journal)
  if (Buffer.byteLength(content) > fileSystemTransactionStateMaximumSize) {
    throw new Error(
      `Filesystem transaction recovery state exceeds ${fileSystemTransactionStateMaximumSize} bytes`,
    )
  }
  await writeFileAtomic(
    join(journalRoot, fileSystemTransactionStateName),
    content,
    { mode: 0o644 },
  )
}

async function readBoundedRegularFile(
  path: string,
  maximumSize: number,
  label: string,
) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    throw fileSystemTransactionOperationError(
      `Failed to open ${label} ${path}`,
      error,
    )
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      throw new Error(`${label} is not a regular file: ${path}`)
    }
    if (stats.size > maximumSize) {
      throw new Error(`${label} exceeds ${maximumSize} bytes: ${path}`)
    }
    const content = Buffer.allocUnsafe(maximumSize + 1)
    let offset = 0
    while (offset < content.length) {
      const { bytesRead } = await handle.read(
        content,
        offset,
        content.length - offset,
        offset,
      )
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    if (offset > maximumSize) {
      throw new Error(`${label} exceeds ${maximumSize} bytes: ${path}`)
    }
    return content.subarray(0, offset).toString('utf8')
  } finally {
    await handle.close()
  }
}

// Filesystem identity components (dev/ino) are persisted as decimal strings so
// 64-bit values above Number.MAX_SAFE_INTEGER survive the journal round-trip
// exactly. Older journals recorded them as JSON numbers; those are still
// accepted as long as they are exact (safe, non-negative integers) and are
// canonicalised to the same decimal-string form. Imprecise numbers (values a
// double cannot represent, e.g. large Windows inodes) are rejected instead of
// being allowed to false-match a different inode.
function normalizeFileSystemTransactionIdentityComponent(
  value: unknown,
): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return String(BigInt(value))
  }
  return undefined
}

function normalizeFileSystemTransactionFileState(
  state: unknown,
): FileSystemTransactionJournalFileState | undefined {
  if (state === undefined) {
    return
  }
  if (typeof state !== 'object' || state === null) {
    throw new Error('Invalid file state in filesystem transaction journal')
  }
  const candidate = state as {
    dev?: unknown
    hash?: unknown
    ino?: unknown
    mode?: unknown
  }
  const hasDevice = candidate.dev !== undefined
  const hasInode = candidate.ino !== undefined
  const dev = hasDevice
    ? normalizeFileSystemTransactionIdentityComponent(candidate.dev)
    : undefined
  const ino = hasInode
    ? normalizeFileSystemTransactionIdentityComponent(candidate.ino)
    : undefined
  if (
    typeof candidate.hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(candidate.hash) ||
    !Number.isSafeInteger(candidate.mode) ||
    ((candidate.mode as number) & ~0o7777) !== 0 ||
    hasDevice !== hasInode ||
    (hasDevice && (dev === undefined || ino === undefined))
  ) {
    throw new Error('Invalid file state in filesystem transaction journal')
  }
  return {
    dev,
    hash: candidate.hash,
    ino,
    mode: candidate.mode as number,
  }
}

function normalizeFileSystemTransactionJournal(
  root: string,
  journal: unknown,
  owner: FileSystemTransactionJournalOwner,
): FileSystemTransactionJournal {
  const version =
    typeof journal === 'object' && journal !== null
      ? (journal as { version?: unknown }).version
      : undefined
  const phase =
    typeof journal === 'object' && journal !== null
      ? (journal as { phase?: unknown }).phase
      : undefined
  if (
    typeof journal !== 'object' ||
    journal === null ||
    (version !== legacyFileSystemTransactionStateVersion &&
      version !== previousFileSystemTransactionStateVersion &&
      version !== fileSystemTransactionStateVersion) ||
    version !== owner.version ||
    (phase !== 'prepared' &&
      phase !== 'committed' &&
      !(
        phase === 'preparing' && version === fileSystemTransactionStateVersion
      )) ||
    (journal as { token?: unknown }).token !== owner.token ||
    !Array.isArray((journal as { entries?: unknown }).entries) ||
    (journal as { entries: unknown[] }).entries.length >
      fileSystemTransactionMaximumEntries
  ) {
    throw new Error(
      `Invalid filesystem transaction journal at ${fileSystemTransactionJournalPath(root)}`,
    )
  }
  const normalizedVersion = version as FileSystemTransactionJournal['version']
  const normalizedPhase = phase as FileSystemTransactionJournal['phase']
  const usesIdentityArtifacts =
    normalizedVersion === previousFileSystemTransactionStateVersion ||
    normalizedVersion === fileSystemTransactionStateVersion
  const isPreparing = normalizedPhase === 'preparing'
  const paths = new Set<string>()
  const entries = (journal as { entries: unknown[] }).entries.map(
    (entry): FileSystemTransactionJournalEntry => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as { path?: unknown }).path !== 'string' ||
        typeof (entry as { parent?: unknown }).parent !== 'object' ||
        (entry as { parent?: unknown }).parent === null
      ) {
        throw new Error('Invalid entry in filesystem transaction journal')
      }
      const candidate = entry as {
        backup?: unknown
        final?: unknown
        original?: unknown
        parent: {
          canonicalParent?: unknown
          dev?: unknown
          identityPath?: unknown
          ino?: unknown
        }
        path: string
        prepared?: unknown
        retired?: unknown
        rollbackRetired?: unknown
      }
      const path = resolveFileSystemTransactionRelativePath(
        root,
        candidate.path,
        'Transaction path',
      )
      if (paths.has(path)) {
        throw new Error(
          `Duplicate path in filesystem transaction journal: ${path}`,
        )
      }
      paths.add(path)
      const original = normalizeFileSystemTransactionFileState(
        candidate.original,
      )
      const final = normalizeFileSystemTransactionFileState(candidate.final)
      if (
        usesIdentityArtifacts &&
        !isPreparing &&
        original !== undefined &&
        (original.dev === undefined || original.ino === undefined)
      ) {
        throw new Error(
          `Filesystem transaction journal omitted original file identity for ${path}`,
        )
      }
      if (
        usesIdentityArtifacts &&
        !isPreparing &&
        final !== undefined &&
        (final.dev === undefined || final.ino === undefined)
      ) {
        throw new Error(
          `Filesystem transaction journal omitted prepared file identity for ${path}`,
        )
      }
      if (isPreparing && (original !== undefined || final === undefined)) {
        throw new Error(
          `Filesystem transaction journal has invalid preparing state for ${path}`,
        )
      }
      let backup: string | undefined
      if (candidate.backup !== undefined) {
        if (typeof candidate.backup !== 'string') {
          throw new Error('Invalid backup in filesystem transaction journal')
        }
        backup = resolveFileSystemTransactionRelativePath(
          root,
          candidate.backup,
          'Transaction backup',
        )
        const backupRoot = join(
          fileSystemTransactionJournalPath(root),
          'backups',
        )
        fileSystemTransactionRelativePath(
          backupRoot,
          backup,
          'Transaction backup',
        )
      }
      if ((original === undefined) !== (backup === undefined)) {
        throw new Error(
          `Filesystem transaction journal has inconsistent backup state for ${path}`,
        )
      }
      if (
        isPreparing &&
        (backup !== undefined ||
          candidate.retired !== undefined ||
          candidate.rollbackRetired !== undefined)
      ) {
        throw new Error(
          `Filesystem transaction journal has invalid preparing artifacts for ${path}`,
        )
      }
      const normalizeArtifact = (
        value: unknown,
        label: string,
        required: boolean,
        kind: 'prepared' | 'retired' | 'rollback',
      ) => {
        if (value === undefined) {
          if (required) {
            throw new Error(
              `Filesystem transaction journal omitted ${label.toLowerCase()} for ${path}`,
            )
          }
          return
        }
        if (typeof value !== 'string') {
          throw new Error(
            `Invalid ${label.toLowerCase()} in filesystem transaction journal for ${path}`,
          )
        }
        const artifact = resolveFileSystemTransactionRelativePath(
          root,
          value,
          label,
        )
        if (
          !isOwnedFileSystemTransactionArtifactPath(
            path,
            artifact,
            owner.token,
            kind,
          )
        ) {
          throw new Error(
            `${label} is not a transaction-owned artifact for ${path}`,
          )
        }
        return value
      }
      const prepared = usesIdentityArtifacts
        ? normalizeArtifact(
            candidate.prepared,
            'Transaction prepared replacement',
            isPreparing || final !== undefined,
            'prepared',
          )
        : undefined
      const retired =
        usesIdentityArtifacts && !isPreparing
          ? normalizeArtifact(
              candidate.retired,
              'Transaction retirement path',
              true,
              'retired',
            )
          : undefined
      const rollbackRetired =
        usesIdentityArtifacts && !isPreparing
          ? normalizeArtifact(
              candidate.rollbackRetired,
              'Transaction rollback retirement path',
              true,
              'rollback',
            )
          : undefined
      if (
        usesIdentityArtifacts &&
        (final === undefined) !== (prepared === undefined)
      ) {
        throw new Error(
          `Filesystem transaction journal has inconsistent prepared state for ${path}`,
        )
      }
      const parent = candidate.parent
      const parentDev = normalizeFileSystemTransactionIdentityComponent(
        parent.dev,
      )
      const parentIno = normalizeFileSystemTransactionIdentityComponent(
        parent.ino,
      )
      if (
        typeof parent.canonicalParent !== 'string' ||
        typeof parent.identityPath !== 'string' ||
        parentDev === undefined ||
        parentIno === undefined
      ) {
        throw new Error(
          `Invalid parent identity in filesystem transaction journal for ${path}`,
        )
      }
      resolveFileSystemTransactionRelativePath(
        root,
        parent.canonicalParent,
        'Transaction canonical parent',
        true,
      )
      resolveFileSystemTransactionRelativePath(
        root,
        parent.identityPath,
        'Transaction parent identity',
        true,
      )
      return {
        backup: candidate.backup as string | undefined,
        final,
        original,
        parent: {
          canonicalParent: parent.canonicalParent,
          dev: parentDev,
          identityPath: parent.identityPath,
          ino: parentIno,
        },
        path: candidate.path,
        prepared,
        retired,
        rollbackRetired,
      }
    },
  )
  return {
    entries,
    phase: normalizedPhase,
    token: owner.token,
    version: normalizedVersion,
  }
}

async function readFileSystemTransactionOwnerAt(journalRoot: string) {
  const path = join(journalRoot, fileSystemTransactionOwnerName)
  const content = await readBoundedRegularFile(
    path,
    reconciliationMetadataMaximumSize,
    'Filesystem transaction owner',
  )
  let owner: unknown
  try {
    owner = JSON.parse(content)
  } catch (error) {
    throw new Error(`Malformed filesystem transaction owner at ${path}`, {
      cause: error,
    })
  }
  if (
    typeof owner !== 'object' ||
    owner === null ||
    (owner as { kind?: unknown }).kind !== fileSystemTransactionKind ||
    ((owner as { version?: unknown }).version !==
      legacyFileSystemTransactionStateVersion &&
      (owner as { version?: unknown }).version !==
        previousFileSystemTransactionStateVersion &&
      (owner as { version?: unknown }).version !==
        fileSystemTransactionStateVersion) ||
    !isReconciliationLockToken((owner as { token?: unknown }).token)
  ) {
    throw new Error(`Invalid filesystem transaction owner at ${path}`)
  }
  return owner as FileSystemTransactionJournalOwner
}

async function readFileSystemTransactionOwner(root: string) {
  return readFileSystemTransactionOwnerAt(
    fileSystemTransactionJournalPath(root),
  )
}

async function readFileSystemTransactionJournal(
  root: string,
  owner: FileSystemTransactionJournalOwner,
) {
  return readFileSystemTransactionJournalAt(
    root,
    fileSystemTransactionJournalPath(root),
    owner,
  )
}

async function readFileSystemTransactionJournalAt(
  root: string,
  journalRoot: string,
  owner: FileSystemTransactionJournalOwner,
) {
  const path = join(journalRoot, fileSystemTransactionStateName)
  const content = await readBoundedRegularFile(
    path,
    fileSystemTransactionStateMaximumSize,
    'Filesystem transaction journal',
  )
  let journal: unknown
  try {
    journal = JSON.parse(content)
  } catch (error) {
    throw new Error(`Malformed filesystem transaction journal at ${path}`, {
      cause: error,
    })
  }
  return normalizeFileSystemTransactionJournal(root, journal, owner)
}

async function assertFileSystemTransactionJournalParentUnchanged(
  root: string,
  entry: FileSystemTransactionJournalEntry,
) {
  const path = resolveFileSystemTransactionRelativePath(
    root,
    entry.path,
    'Transaction path',
  )
  const expectedParent = resolveFileSystemTransactionRelativePath(
    root,
    entry.parent.canonicalParent,
    'Transaction canonical parent',
    true,
  )
  const currentParent = await canonicalizeReconciliationPath(dirname(path))
  if (!pathsHaveEquivalentPlatformSpelling(expectedParent, currentParent)) {
    throw new Error(
      `Filesystem transaction parent changed from ${expectedParent} to ${currentParent}`,
    )
  }
  const identityPath = resolveFileSystemTransactionRelativePath(
    root,
    entry.parent.identityPath,
    'Transaction parent identity',
    true,
  )
  const identityStats = await lstatIfExists(identityPath, { bigint: true })
  if (
    !identityStats?.isDirectory() ||
    String(identityStats.dev) !== entry.parent.dev ||
    String(identityStats.ino) !== entry.parent.ino
  ) {
    throw new Error(
      `Filesystem transaction parent identity changed: ${identityPath}`,
    )
  }
}

async function rollbackFileSystemTransaction(
  root: string,
  journal: FileSystemTransactionJournal,
) {
  const errors: Error[] = []
  for (const entry of [...journal.entries].reverse()) {
    const path = resolveFileSystemTransactionRelativePath(
      root,
      entry.path,
      'Transaction path',
    )
    try {
      await assertFileSystemTransactionJournalParentUnchanged(root, entry)
      const current = await fileSystemTransactionFileStateIfExists(path)
      if (
        fileSystemTransactionFileStatesExactlyMatch(current, entry.original)
      ) {
        continue
      }
      const assertParentUnchanged = () =>
        assertFileSystemTransactionJournalParentUnchanged(root, entry)
      if (entry.final !== undefined) {
        const rollbackRetired = resolveFileSystemTransactionRelativePath(
          root,
          entry.rollbackRetired!,
          'Transaction rollback retirement path',
        )
        const rollbackRetiredState =
          await fileSystemTransactionFileStateIfExists(rollbackRetired)
        if (fileSystemTransactionFileStatesExactlyMatch(current, entry.final)) {
          await assertFileSystemTransactionPathMatches(
            resolveFileSystemTransactionRelativePath(
              root,
              entry.prepared!,
              'Transaction prepared replacement',
            ),
            entry.final,
            'the prepared identity anchor changed before rollback',
          )
          await retireExactFileSystemTransactionPath(
            path,
            entry.final,
            rollbackRetired,
            'the transaction output changed before rollback retirement',
            assertParentUnchanged,
          )
        } else if (
          current !== undefined ||
          (rollbackRetiredState !== undefined &&
            !fileSystemTransactionFileStatesExactlyMatch(
              rollbackRetiredState,
              entry.final,
            ))
        ) {
          throw fileSystemTransactionConflictError(
            path,
            'the destination changed outside the transaction before rollback',
          )
        }
      } else if (current !== undefined) {
        throw fileSystemTransactionConflictError(
          path,
          'the destination changed outside the transaction before rollback',
        )
      }
      if (entry.original !== undefined) {
        const retired = resolveFileSystemTransactionRelativePath(
          root,
          entry.retired!,
          'Transaction retirement path',
        )
        await publishFileSystemTransactionIdentityAnchor(
          retired,
          path,
          entry.original,
          assertParentUnchanged,
        )
      }
    } catch (error) {
      errors.push(
        fileSystemTransactionOperationError(
          `Failed to roll back filesystem transaction path ${path}: ${errorMessage(error)}`,
          error,
        ),
      )
    }
  }
  return errors
}

async function publishFileSystemTransactionIdentityAnchor(
  source: string,
  destination: string,
  expected: FileSystemTransactionJournalFileState,
  assertParentUnchanged: () => Promise<void>,
) {
  const identity = await openFileSystemTransactionIdentity(source)
  if (!fileSystemTransactionFileStatesExactlyMatch(identity.state, expected)) {
    await identity.handle.close()
    throw fileSystemTransactionConflictError(
      source,
      'the transaction identity anchor changed before restoration',
    )
  }
  try {
    await assertParentUnchanged()
    try {
      await link(source, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw fileSystemTransactionConflictError(
          destination,
          'a successor appeared before transaction restoration',
          error,
        )
      }
      throw fileSystemTransactionOperationError(
        `Failed to restore transaction identity anchor at ${destination}`,
        error,
      )
    }
    await assertParentUnchanged()
    await syncDirectory(dirname(destination))
    await assertFileSystemTransactionPathMatches(
      destination,
      identity.state,
      'the restored destination does not contain the original transaction entry',
    )
  } finally {
    await identity.handle.close()
  }
}

async function cleanupPreparedFileSystemTransactionArtifacts(
  preparedArtifacts: Map<string, FileSystemTransactionJournalFileState>,
) {
  for (const [path, expected] of preparedArtifacts) {
    const current = await fileSystemTransactionFileStateIfExists(path)
    if (current === undefined) {
      continue
    }
    if (!fileSystemTransactionFileStatesExactlyMatch(current, expected)) {
      throw fileSystemTransactionConflictError(
        path,
        'a prepared transaction artifact changed before cleanup',
      )
    }
    await unlink(path)
    await syncDirectory(dirname(path))
  }
}

async function cleanupFileSystemTransactionArtifacts(
  root: string,
  journal: FileSystemTransactionJournal,
) {
  const artifacts = new Map<
    string,
    {
      entry: FileSystemTransactionJournalEntry
      path: string
      state: FileSystemTransactionJournalFileState
    }
  >()
  for (const entry of journal.entries) {
    if (entry.prepared && entry.final) {
      const path = resolveFileSystemTransactionRelativePath(
        root,
        entry.prepared,
        'Transaction prepared replacement',
      )
      artifacts.set(fileSystemTransactionPlatformPathKey(path), {
        entry,
        path,
        state: entry.final,
      })
    }
    if (entry.retired && entry.original) {
      const path = resolveFileSystemTransactionRelativePath(
        root,
        entry.retired,
        'Transaction retirement path',
      )
      artifacts.set(fileSystemTransactionPlatformPathKey(path), {
        entry,
        path,
        state: entry.original,
      })
    }
    if (entry.rollbackRetired && entry.final) {
      const path = resolveFileSystemTransactionRelativePath(
        root,
        entry.rollbackRetired,
        'Transaction rollback retirement path',
      )
      artifacts.set(fileSystemTransactionPlatformPathKey(path), {
        entry,
        path,
        state: entry.final,
      })
    }
  }

  for (const { entry, path, state } of artifacts.values()) {
    const current = await fileSystemTransactionFileStateIfExists(path)
    if (current === undefined) {
      continue
    }
    if (!fileSystemTransactionFileStatesExactlyMatch(current, state)) {
      throw fileSystemTransactionConflictError(
        path,
        'a retained transaction identity anchor changed before cleanup',
      )
    }
    const cleanupRetired = atomicTemporaryPath(path)
    await retireExactFileSystemTransactionPath(
      path,
      state,
      cleanupRetired,
      'during transaction artifact cleanup',
      () => assertFileSystemTransactionJournalParentUnchanged(root, entry),
    )
    await unlink(cleanupRetired)
    await syncDirectory(dirname(path))
  }
}

async function recoverLegacyFileSystemTransaction(
  root: string,
  journal: FileSystemTransactionJournal,
  owner: FileSystemTransactionJournalOwner,
  journalStats: BigIntStats,
) {
  if (journal.phase === 'committed') {
    await removeFileSystemTransactionJournal(root, owner.token, journalStats)
    return
  }
  for (const entry of journal.entries) {
    await assertFileSystemTransactionJournalParentUnchanged(root, entry)
    const path = resolveFileSystemTransactionRelativePath(
      root,
      entry.path,
      'Transaction path',
    )
    const current = await fileSystemTransactionFileStateIfExists(path)
    if (!fileSystemTransactionFileContentsMatch(current, entry.original)) {
      const quarantined = await retireFileSystemTransactionState(
        root,
        fileSystemTransactionJournalPath(root),
        journalStats,
        owner.token,
      )
      const error = new Error(
        `Legacy filesystem transaction journal v1 cannot prove ownership of ${path}. It was quarantined at ${quarantined} so future reconciliation is not permanently blocked; inspect the preserved backups before removing it`,
      ) as NodeJS.ErrnoException
      error.code = 'ENOTRECOVERABLE'
      error.path = quarantined
      throw error
    }
  }
  await removeFileSystemTransactionJournal(root, owner.token, journalStats)
}

async function cleanupPreparingFileSystemTransactionArtifacts(
  root: string,
  journal: FileSystemTransactionJournal,
) {
  const artifacts = new Map<
    string,
    {
      entry: FileSystemTransactionJournalEntry
      path: string
      state: FileSystemTransactionJournalFileState
    }
  >()
  for (const entry of journal.entries) {
    const path = resolveFileSystemTransactionRelativePath(
      root,
      entry.prepared!,
      'Transaction prepared replacement',
    )
    artifacts.set(fileSystemTransactionPlatformPathKey(path), {
      entry,
      path,
      state: entry.final!,
    })
  }

  for (const { entry, path, state } of artifacts.values()) {
    await assertFileSystemTransactionJournalParentUnchanged(root, entry)
    const current = await fileSystemTransactionFileStateIfExists(path)
    if (current === undefined) {
      continue
    }
    // The predeclared pathname is not ownership proof: another process may
    // have created it after the transaction owner crashed.
    if (
      state.dev === undefined ||
      state.ino === undefined ||
      current.dev !== state.dev ||
      current.ino !== state.ino
    ) {
      throw fileSystemTransactionConflictError(
        path,
        state.dev === undefined || state.ino === undefined
          ? 'the preparing journal did not record ownership of the live artifact'
          : 'a successor replaced the preparing transaction artifact before cleanup',
      )
    }
    const cleanupRetired = atomicTemporaryPath(path)
    await retireExactFileSystemTransactionPath(
      path,
      current,
      cleanupRetired,
      'during preparing transaction artifact cleanup',
      () => assertFileSystemTransactionJournalParentUnchanged(root, entry),
    )
    await unlink(cleanupRetired)
    await syncDirectory(dirname(path))
  }
}

async function cleanupUnpublishedFileSystemTransactionArtifacts(
  root: string,
  journal: FileSystemTransactionJournal,
) {
  if (journal.phase === 'preparing') {
    await cleanupPreparingFileSystemTransactionArtifacts(root, journal)
    return
  }
  const preparedArtifacts = new Map<
    string,
    FileSystemTransactionJournalFileState
  >()
  for (const entry of journal.entries) {
    for (const [relativePath, label] of [
      [entry.retired, 'Transaction retirement path'],
      [entry.rollbackRetired, 'Transaction rollback retirement path'],
    ] as const) {
      if (relativePath === undefined) {
        continue
      }
      const path = resolveFileSystemTransactionRelativePath(
        root,
        relativePath,
        label,
      )
      if ((await lstatIfExists(path)) !== undefined) {
        throw fileSystemTransactionConflictError(
          path,
          'an unpublished transaction unexpectedly contains a retirement artifact',
        )
      }
    }
    if (entry.prepared && entry.final) {
      const path = resolveFileSystemTransactionRelativePath(
        root,
        entry.prepared,
        'Transaction prepared replacement',
      )
      const current = await fileSystemTransactionFileStateIfExists(path)
      if (current === undefined) {
        continue
      }
      if (!fileSystemTransactionFileStatesExactlyMatch(current, entry.final)) {
        throw fileSystemTransactionConflictError(
          path,
          'an unpublished transaction prepared artifact changed before recovery',
        )
      }
      preparedArtifacts.set(path, entry.final)
    }
  }
  await cleanupPreparedFileSystemTransactionArtifacts(preparedArtifacts)
}

async function assertRetiredFileSystemTransactionArtifactsAreAbsent(
  root: string,
  journal: FileSystemTransactionJournal,
) {
  for (const entry of journal.entries) {
    for (const [relativePath, label] of [
      [entry.prepared, 'Transaction prepared replacement'],
      [entry.retired, 'Transaction retirement path'],
      [entry.rollbackRetired, 'Transaction rollback retirement path'],
    ] as const) {
      if (relativePath === undefined) {
        continue
      }
      const path = resolveFileSystemTransactionRelativePath(
        root,
        relativePath,
        label,
      )
      if ((await lstatIfExists(path)) !== undefined) {
        throw fileSystemTransactionConflictError(
          path,
          'a retired transaction still references a live artifact',
        )
      }
    }
  }
}

async function scavengeFileSystemTransactionSiblings(root: string) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const sibling = parseFileSystemTransactionSiblingName(entry.name)
    if (!sibling) {
      continue
    }
    const path = join(root, entry.name)
    try {
      const stats = await lstatIfExists(path, { bigint: true })
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !stats?.isDirectory() ||
        stats.isSymbolicLink()
      ) {
        throw new Error(
          `Filesystem transaction sibling is not an owned directory: ${path}`,
        )
      }
      const owner = await readFileSystemTransactionOwnerAt(path)
      if (sibling.kind === 'candidate' && owner.token !== sibling.token) {
        throw new Error(
          `Filesystem transaction candidate owner does not match its reserved path: ${path}`,
        )
      }
      if (
        sibling.kind === 'retired' &&
        fileSystemTransactionTokensMatch(owner.token, sibling.token)
      ) {
        throw new Error(
          `Filesystem transaction retirement reused its owner token: ${path}`,
        )
      }
      const journal = await readFileSystemTransactionJournalAt(
        root,
        path,
        owner,
      )
      if (sibling.kind === 'candidate') {
        if (journal.phase !== 'preparing' && journal.phase !== 'prepared') {
          throw new Error(
            `Filesystem transaction candidate has an invalid ${journal.phase} phase: ${path}`,
          )
        }
        await cleanupUnpublishedFileSystemTransactionArtifacts(root, journal)
      } else {
        if (
          journal.version === legacyFileSystemTransactionStateVersion &&
          journal.phase !== 'committed'
        ) {
          throw new Error(
            `Legacy prepared filesystem transaction retirement may contain quarantined backups: ${path}`,
          )
        }
        await assertRetiredFileSystemTransactionArtifactsAreAbsent(
          root,
          journal,
        )
      }
      const retiredPath = await retireFileSystemTransactionState(
        root,
        path,
        stats,
        owner.token,
      )
      await removeFileSystemTransactionStateTree(retiredPath)
      await syncDirectory(root)
    } catch (error) {
      debug.warn(
        `Preserving filesystem transaction sibling ${path}: ${errorMessage(error)}`,
      )
    }
  }
}

async function recoverFileSystemTransaction(root: string) {
  const journalRoot = fileSystemTransactionJournalPath(root)
  const journalStats = await lstatIfExists(journalRoot, { bigint: true })
  if (!journalStats) {
    await scavengeFileSystemTransactionSiblings(root)
    return
  }
  if (!journalStats.isDirectory() || journalStats.isSymbolicLink()) {
    throw new Error(
      `Filesystem transaction recovery state is not a directory: ${journalRoot}`,
    )
  }
  const owner = await readFileSystemTransactionOwner(root)
  const statePath = join(journalRoot, fileSystemTransactionStateName)
  const stateStats = await lstatIfExists(statePath)
  if (!stateStats) {
    const error = new Error(
      `Filesystem transaction recovery state is incomplete because its journal is missing: ${statePath}`,
    ) as NodeJS.ErrnoException
    error.code = 'ENOTRECOVERABLE'
    error.path = statePath
    throw error
  }
  const journal = await readFileSystemTransactionJournal(root, owner)
  if (journal.version === legacyFileSystemTransactionStateVersion) {
    await recoverLegacyFileSystemTransaction(root, journal, owner, journalStats)
  } else {
    if (journal.phase === 'preparing') {
      await cleanupPreparingFileSystemTransactionArtifacts(root, journal)
    } else {
      if (journal.phase === 'prepared') {
        const rollbackErrors = await rollbackFileSystemTransaction(
          root,
          journal,
        )
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            rollbackErrors,
            `Failed to recover interrupted filesystem transaction at ${journalRoot}`,
            { cause: rollbackErrors[0] },
          )
        }
      }
      await cleanupFileSystemTransactionArtifacts(root, journal)
    }
    await removeFileSystemTransactionJournal(root, owner.token, journalStats)
  }
  await scavengeFileSystemTransactionSiblings(root)
}

export function fileSystemTransactionStateMatches(
  left: BigIntStats,
  right: BigIntStats | undefined,
) {
  return (
    right?.isDirectory() === true &&
    !right.isSymbolicLink() &&
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino)
  )
}

async function retireFileSystemTransactionState(
  root: string,
  path: string,
  expectedStats: BigIntStats,
  expectedToken?: string,
) {
  const currentStats = await lstatIfExists(path, { bigint: true })
  if (!fileSystemTransactionStateMatches(expectedStats, currentStats)) {
    throw new Error(`Filesystem transaction recovery state changed: ${path}`)
  }
  if (expectedToken !== undefined) {
    const owner = await readFileSystemTransactionOwnerAt(path)
    if (owner.token !== expectedToken) {
      throw new Error(
        `Filesystem transaction recovery state owner changed: ${path}`,
      )
    }
  }

  let retiredPath: string
  while (true) {
    retiredPath = fileSystemTransactionRetiredPath(root, expectedToken)
    if (await lstatIfExists(retiredPath)) {
      continue
    }
    try {
      await retryWindowsFileSystemTransactionCleanup(() =>
        rename(path, retiredPath),
      )
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      throw error
    }
  }
  await syncDirectory(root)

  const retiredStats = await lstatIfExists(retiredPath, { bigint: true })
  if (!fileSystemTransactionStateMatches(expectedStats, retiredStats)) {
    throw new Error(
      `Filesystem transaction recovery state changed while it was retired: ${retiredPath}`,
    )
  }
  if (expectedToken !== undefined) {
    const owner = await readFileSystemTransactionOwnerAt(retiredPath)
    if (owner.token !== expectedToken) {
      throw new Error(
        `Filesystem transaction recovery state owner changed while it was retired: ${retiredPath}`,
      )
    }
  }
  return retiredPath
}

async function retryWindowsFileSystemTransactionCleanup<T>(
  operation: () => Promise<T>,
) {
  const deadline = performance.now() + fileSystemTransactionCleanupTimeout
  let retryDelay = fileSystemTransactionCleanupInitialRetryDelay
  while (true) {
    try {
      return await operation()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (
        process.platform !== 'win32' ||
        !['EACCES', 'EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'].includes(
          code ?? '',
        ) ||
        performance.now() >= deadline
      ) {
        throw error
      }
      await delay(
        Math.max(0, Math.min(retryDelay, deadline - performance.now())),
      )
      retryDelay = Math.min(
        retryDelay * 2,
        fileSystemTransactionCleanupMaximumRetryDelay,
      )
    }
  }
}

async function removeFileSystemTransactionStateTree(path: string) {
  await retryWindowsFileSystemTransactionCleanup(async () => {
    try {
      await rm(path, { force: true, recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  })
}

async function removeFileSystemTransactionCandidate(
  root: string,
  candidateRoot: string,
  candidateStats: BigIntStats,
) {
  const retiredPath = await retireFileSystemTransactionState(
    root,
    candidateRoot,
    candidateStats,
  )
  await removeFileSystemTransactionStateTree(retiredPath)
  await syncDirectory(root)
}

async function removeFileSystemTransactionJournal(
  root: string,
  token: string,
  journalStats: BigIntStats,
) {
  const journalRoot = fileSystemTransactionJournalPath(root)
  const retiredPath = await retireFileSystemTransactionState(
    root,
    journalRoot,
    journalStats,
    token,
  )
  await removeFileSystemTransactionStateTree(retiredPath)
  await syncDirectory(root)
}

function pathsHaveEquivalentPlatformSpelling(left: string, right: string) {
  return (
    fileSystemTransactionPlatformPathKey(left) ===
    fileSystemTransactionPlatformPathKey(right)
  )
}

function fileSystemTransactionPlatformPathKey(path: string) {
  const normalized =
    process.platform === 'darwin' ? path.normalize('NFC') : path
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function atomicTemporaryPath(path: string) {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
}

async function syncFile(path: string) {
  let restoreMode: number | undefined
  if (process.platform === 'win32') {
    const mode = (await stat(path)).mode & 0o7777
    if ((mode & 0o200) === 0) {
      // FlushFileBuffers requires a write-capable handle. This path is owned
      // by the atomic operation, so make it writable only for the flush. If
      // flushing fails, leave it writable so the caller can remove it.
      await chmod(path, mode | 0o200)
      restoreMode = mode
    }
  }
  const handle = await open(path, process.platform === 'win32' ? 'r+' : 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (restoreMode !== undefined) {
    await chmod(path, restoreMode)
  }
}

async function syncDirectory(path: string) {
  if (process.platform === 'win32') {
    // Node cannot open and fsync Windows directories. File data is synced and
    // the journal handles process termination, but this does not claim durable
    // directory-entry ordering across sudden power loss on Windows.
    return
  }
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function pathExistsAsync(path: string) {
  return (await lstatIfExists(path)) !== undefined
}

async function unlinkFileIfExists(path: string) {
  try {
    await unlink(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function fileExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

export async function dirExistsAsync(path: string) {
  try {
    const stats = await statAsync(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

export function pick<O, K extends keyof O>(o: O, ...keys: K[]): Pick<O, K> {
  return keys.reduce((acc, key) => {
    acc[key] = o[key]
    return acc
  }, {} as O)
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergePackageJson(
  old: Record<string, any>,
  partial: Record<string, any>,
): Record<string, any> {
  const merged = { ...old }

  for (const [key, value] of Object.entries(partial)) {
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = mergePackageJson(merged[key], value)
    } else {
      merged[key] = value
    }
  }

  return merged
}

export async function updatePackageJson(
  path: string,
  partial: Record<string, any>,
) {
  const exists = await fileExists(path)
  if (!exists) {
    debug(`File not exists ${path}`)
    return
  }
  const old = JSON.parse(await readFileAsync(path, 'utf8'))
  await writeFileAsync(
    path,
    JSON.stringify(mergePackageJson(old, partial), null, 2),
  )
}

export const CLI_VERSION = pkgJson.version
