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
} from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
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
const processIncarnationObservationCacheDuration = 1_000
const fileSystemTransactionJournalName = '.napi-rs-filesystem-transaction.swp'
const fileSystemTransactionCandidateMarker = '.candidate.'
const fileSystemTransactionRetiredMarker = '.retired.'
const fileSystemTransactionOwnerName = 'owner.json'
const fileSystemTransactionStateName = 'state.json'
const fileSystemTransactionKind = 'napi-rs-filesystem-transaction'
const fileSystemTransactionStateVersion = 1
const fileSystemTransactionStateMaximumSize = 16 * 1024 * 1024
const fileSystemTransactionMaximumEntries = 100_000

interface ReconciliationLockOwner {
  candidate: string
  createdAt: number
  boot?: string | null
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
}

interface ReconciliationReclaimState {
  owner: ReconciliationReclaimOwner
  ownerContent: string
  reclaimStats: Stats
  stale: boolean
}

type ReconciliationMetadataOwner =
  ReconciliationLockOwner | ReconciliationReclaimOwner

interface ReconciliationCandidateState {
  owner: ReconciliationMetadataOwner
  ownerContent: string
  stats: Stats
  stale: boolean
}

interface ProcessIncarnationObservation {
  expiresAt: number
  incarnation: string | null
}

interface ProcessExecutionIdentity {
  boot: string | null
  machine: string | null
  namespace: string | null
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
let currentProcessExecutionIdentity: ProcessExecutionIdentity | undefined
let currentProcessExecutionIdentityProbe:
  Promise<ProcessExecutionIdentity> | undefined
let linuxBootId: string | undefined

interface TransactionParentIdentity {
  canonicalParent: string
  dev: number
  identityPath: string
  ino: number
}

interface FileSystemTransactionJournalParent {
  canonicalParent: string
  dev: number
  identityPath: string
  ino: number
}

interface FileSystemTransactionJournalFileState {
  hash: string
  mode: number
}

interface FileSystemTransactionJournalEntry {
  backup?: string
  final?: FileSystemTransactionJournalFileState
  original?: FileSystemTransactionJournalFileState
  parent: FileSystemTransactionJournalParent
  path: string
}

interface FileSystemTransactionJournal {
  entries: FileSystemTransactionJournalEntry[]
  phase: 'committed' | 'prepared'
  token: string
  version: typeof fileSystemTransactionStateVersion
}

interface FileSystemTransactionJournalOwner {
  kind: typeof fileSystemTransactionKind
  token: string
  version: typeof fileSystemTransactionStateVersion
}

interface FileSystemReconciliationCapability {
  roots: ReadonlySet<string>
}

interface PreparedFileSystemTransactionWrite {
  destination: string
  final: FileSystemTransactionJournalFileState
  input: string
  removeBeforeWrite?: string
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

export async function commitFileSystemTransaction(
  root: string,
  writes: FileSystemTransactionWrite[],
  removals: string[],
) {
  const requestedTransactionRoot = resolve(root)
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
    writes.map(async (write) => ({
      destination: await resolveCanonicalTransactionPath(
        requestedTransactionRoot,
        transactionRoot,
        write.destination,
      ),
      mode: write.mode,
      removeBeforeWrite: write.removeBeforeWrite
        ? await resolveCanonicalTransactionPath(
            requestedTransactionRoot,
            transactionRoot,
            write.removeBeforeWrite,
          )
        : undefined,
      source: write.source,
    })),
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
    const journalRelative = relative(journalRoot, path)
    if (
      journalRelative === '' ||
      (journalRelative !== '..' &&
        !journalRelative.startsWith(`..${sep}`) &&
        !isAbsolute(journalRelative))
    ) {
      throw new Error(
        `Filesystem transaction path overlaps reserved recovery state: ${path}`,
      )
    }
  }
  const affectedStats = new Map<string, Stats | undefined>()
  for (const path of affected) {
    const stats = await lstatIfExists(path)
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
  const publishedInputRoot = join(journalRoot, 'inputs')
  const backups = new Map<string, { mode: number; path: string }>()
  let preserveJournalRoot = false
  let journal: FileSystemTransactionJournal | undefined
  let committed = false
  let published = false
  let transactionError: unknown

  try {
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
        snapshot = {
          final: await snapshotFileSystemTransactionInput(
            write.source,
            inputPath,
          ),
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
      const mode = stats.mode & 0o7777
      await copyFileAtomic(path, backup, mode)
      backups.set(path, {
        mode,
        path: join(publishedBackupRoot, backupName),
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
    journal = {
      entries: await Promise.all(
        [...affected].map(async (path) => {
          const originalStats = affectedStats.get(path)
          const backup = backupForPath(path)
          const finalWrite = finalWriteForPath(path)
          const parentIdentity = parentIdentities.get(dirname(path))
          if (!parentIdentity) {
            throw new Error(
              `Filesystem transaction parent identity was not captured: ${dirname(path)}`,
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
            final: finalWrite ? finalWrite.final : undefined,
            original:
              originalStats && backup
                ? await fileSystemTransactionFileState(
                    join(candidateBackupRoot, basename(backup.path)),
                    backup.mode,
                  )
                : undefined,
            parent: {
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
            },
            path: fileSystemTransactionRelativePath(
              transactionRoot,
              path,
              'Transaction path',
            ),
          }
        }),
      ),
      phase: 'prepared',
      token: transactionToken,
      version: fileSystemTransactionStateVersion,
    }
    await writeFileAtomic(
      join(candidateRoot, fileSystemTransactionOwnerName),
      JSON.stringify({
        kind: fileSystemTransactionKind,
        token: transactionToken,
        version: fileSystemTransactionStateVersion,
      } satisfies FileSystemTransactionJournalOwner),
      { mode: 0o644 },
    )
    await writeFileSystemTransactionJournal(candidateRoot, journal)
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
    const publishedStats = await lstatIfExists(journalRoot)
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
      await assertTransactionParentUnchanged(
        transactionRoot,
        path,
        parentIdentities,
      )
      if (await unlinkFileIfExists(path)) {
        await syncDirectory(dirname(path))
      }
    }
    for (const { destination, final, input } of preparedWrites) {
      await assertTransactionParentUnchanged(
        transactionRoot,
        destination,
        parentIdentities,
      )
      await copyFileAtomic(
        join(publishedInputRoot, basename(input)),
        destination,
        final.mode,
      )
    }
    for (const path of affected) {
      if (!writesByDestination.has(path) && !preWriteRemovals.has(path)) {
        await assertTransactionParentUnchanged(
          transactionRoot,
          path,
          parentIdentities,
        )
        if (await unlinkFileIfExists(path)) {
          await syncDirectory(dirname(path))
        }
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
        await removeFileSystemTransactionJournal(
          transactionRoot,
          transactionToken,
          candidateStats,
        )
      } else {
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
  leftStats: Stats,
  rightStats: Stats,
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
  return {
    lockStats: metadata.stats,
    owner,
    ownerContent: metadata.content,
    stale: await processOwnerIsStale(owner),
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
    await removeStaleReconciliationReclaim(identity)
    if (await pathExistsAsync(reclaimPath)) {
      await delayReconciliationLockRetry(acquisitionDeadline, identity.key)
    }
  }
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
  return {
    owner,
    ownerContent: metadata.content,
    reclaimStats: metadata.stats,
    stale: await processOwnerIsStale(owner),
  }
}

async function removeStaleReconciliationReclaim(
  identity: ReconciliationLockIdentity,
) {
  const reclaimPath = reconciliationReclaimPath(identity)
  const expectedState = await inspectReconciliationReclaim(identity)
  if (!expectedState?.stale) {
    return false
  }

  const currentState = await inspectReconciliationReclaim(identity)
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
  return {
    owner,
    ownerContent: metadata.content,
    stale: await processOwnerIsStale(owner),
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

async function processOwnerIsStale(owner: ReconciliationMetadataOwner) {
  if (
    typeof owner.machine !== 'string' ||
    typeof owner.boot !== 'string' ||
    typeof owner.namespace !== 'string'
  ) {
    return false
  }
  const current = await getCurrentProcessExecutionIdentity()
  if (
    current.machine === null ||
    current.boot === null ||
    current.namespace === null ||
    current.machine !== owner.machine
  ) {
    return false
  }
  if (current.boot !== owner.boot) {
    return true
  }
  if (current.namespace !== owner.namespace) {
    return false
  }
  if (!processExists(owner.pid)) {
    return true
  }
  // Legacy, unavailable, and newer unknown identity formats fall back to the
  // live-PID check. Only a confirmed comparable mismatch permits reclamation.
  if (typeof owner.incarnation !== 'string') {
    return false
  }
  const expectedFormat = processIncarnationFormat(owner.incarnation)
  if (expectedFormat === undefined) {
    return false
  }
  const observedIncarnation = await observeProcessIncarnation(
    owner.pid,
    owner.incarnation,
  )
  return (
    observedIncarnation !== null &&
    processIncarnationFormat(observedIncarnation) === expectedFormat &&
    observedIncarnation !== owner.incarnation
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

function getCurrentProcessExecutionIdentity() {
  if (currentProcessExecutionIdentity !== undefined) {
    return Promise.resolve(currentProcessExecutionIdentity)
  }
  if (currentProcessExecutionIdentityProbe !== undefined) {
    return currentProcessExecutionIdentityProbe
  }

  const probe = readProcessExecutionIdentity()
  currentProcessExecutionIdentityProbe = probe
  void probe.then(
    (identity) => {
      currentProcessExecutionIdentity = identity
      if (currentProcessExecutionIdentityProbe === probe) {
        currentProcessExecutionIdentityProbe = undefined
      }
    },
    () => {
      if (currentProcessExecutionIdentityProbe === probe) {
        currentProcessExecutionIdentityProbe = undefined
      }
    },
  )
  return probe
}

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
      machine: machineGuid
        ? `windows-machine:${machineGuid.toLowerCase()}`
        : null,
      namespace: 'windows-global',
    }
  }
  if (process.platform === 'darwin') {
    const [machineOutput, bootOutput] = await Promise.all([
      executeProcessIncarnationCommand('/usr/sbin/ioreg', [
        '-rd1',
        '-c',
        'IOPlatformExpertDevice',
      ]),
      executeProcessIncarnationCommand('/usr/sbin/sysctl', [
        '-n',
        'kern.boottime',
      ]),
    ])
    const platformUuid = machineOutput?.match(
      /"IOPlatformUUID"\s*=\s*"([0-9a-f-]+)"/i,
    )?.[1]
    const bootSeconds = bootOutput?.match(/\bsec\s*=\s*(\d+)/)?.[1]
    return {
      boot: bootSeconds ? `darwin-boot:${bootSeconds}` : null,
      machine: platformUuid
        ? `darwin-machine:${platformUuid.toLowerCase()}`
        : null,
      namespace: 'darwin-global',
    }
  }
  return {
    boot: null,
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
    relativePath.startsWith('../')
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
  let identityStats = await lstatIfExists(identityPath)
  while (!identityStats) {
    const next = dirname(identityPath)
    if (next === identityPath) {
      throw new Error(
        `Could not resolve filesystem transaction parent identity: ${parent}`,
      )
    }
    identityPath = next
    identityStats = await lstatIfExists(identityPath)
  }
  if (!identityStats.isDirectory()) {
    throw new Error(
      `Filesystem transaction parent is not a directory: ${identityPath}`,
    )
  }
  return {
    canonicalParent,
    dev: identityStats.dev,
    identityPath,
    ino: identityStats.ino,
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
  const identityStats = await lstatIfExists(expected.identityPath)
  if (
    !identityStats?.isDirectory() ||
    identityStats.dev !== expected.dev ||
    identityStats.ino !== expected.ino
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

function fileSystemTransactionRetiredPath(root: string) {
  return fileSystemTransactionSiblingPath(
    root,
    fileSystemTransactionRetiredMarker,
    randomUUID(),
  )
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
    const stats = await lstat(path)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        `Filesystem transaction candidate is not a directory: ${path}`,
      )
    }
    return { path, stats, token }
  }
}

async function snapshotFileSystemTransactionInput(
  source: string,
  destination: string,
  mode?: number,
): Promise<FileSystemTransactionJournalFileState> {
  let sourceHandle
  try {
    sourceHandle = await open(
      source,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    )
  } catch (error) {
    throw new Error(`Failed to open transaction source ${source}`, {
      cause: error,
    })
  }
  try {
    const sourceStats = await sourceHandle.stat()
    if (!sourceStats.isFile()) {
      throw new Error(
        `Filesystem transaction source is not a regular file: ${source}`,
      )
    }
    const finalMode = mode ?? sourceStats.mode & 0o7777
    await mkdir(dirname(destination), { recursive: true })
    while (true) {
      const temporaryPath = atomicTemporaryPath(destination)
      let destinationHandle
      try {
        destinationHandle = await open(temporaryPath, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue
        }
        throw error
      }
      let committed = false
      try {
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
        const finalSourceStats = await sourceHandle.stat()
        if (
          finalSourceStats.dev !== sourceStats.dev ||
          finalSourceStats.ino !== sourceStats.ino ||
          finalSourceStats.size !== sourceStats.size ||
          finalSourceStats.size !== position ||
          finalSourceStats.mode !== sourceStats.mode ||
          finalSourceStats.mtimeMs !== sourceStats.mtimeMs ||
          finalSourceStats.ctimeMs !== sourceStats.ctimeMs
        ) {
          throw new Error(
            `Filesystem transaction source changed while it was snapshotted: ${source}`,
          )
        }
        if (process.platform !== 'win32') {
          await destinationHandle.chmod(0o400)
        }
        await destinationHandle.sync()
        await destinationHandle.close()
        await rename(temporaryPath, destination)
        await syncDirectory(dirname(destination))
        committed = true
        return {
          hash: hash.digest('hex'),
          mode: finalMode,
        }
      } finally {
        await destinationHandle.close().catch(() => {})
        if (!committed) {
          await unlinkFileIfExists(temporaryPath)
        }
      }
    }
  } finally {
    await sourceHandle.close()
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

async function fileSystemTransactionFileState(
  path: string,
  mode?: number,
): Promise<FileSystemTransactionJournalFileState> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    throw new Error(`Failed to open transaction file ${path}`, {
      cause: error,
    })
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      throw new Error(
        `Filesystem transaction path is not a regular file: ${path}`,
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
    const finalStats = await handle.stat()
    if (
      finalStats.dev !== stats.dev ||
      finalStats.ino !== stats.ino ||
      finalStats.size !== position
    ) {
      throw new Error(
        `Filesystem transaction file changed while it was read: ${path}`,
      )
    }
    return {
      hash: hash.digest('hex'),
      mode: mode ?? stats.mode & 0o7777,
    }
  } finally {
    await handle.close()
  }
}

async function fileSystemTransactionFileStateIfExists(path: string) {
  try {
    return await fileSystemTransactionFileState(path)
  } catch (error) {
    if (
      (error as Error & { cause?: NodeJS.ErrnoException }).cause?.code ===
      'ENOENT'
    ) {
      return
    }
    throw error
  }
}

function fileSystemTransactionFileStatesMatch(
  left: FileSystemTransactionJournalFileState | undefined,
  right: FileSystemTransactionJournalFileState | undefined,
) {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
        left.hash === right.hash &&
        left.mode === right.mode
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
    throw new Error(`Failed to open ${label} ${path}`, { cause: error })
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

function normalizeFileSystemTransactionFileState(
  state: unknown,
): FileSystemTransactionJournalFileState | undefined {
  if (state === undefined) {
    return
  }
  if (
    typeof state !== 'object' ||
    state === null ||
    typeof (state as { hash?: unknown }).hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test((state as { hash: string }).hash) ||
    !Number.isSafeInteger((state as { mode?: unknown }).mode) ||
    ((state as { mode: number }).mode & ~0o7777) !== 0
  ) {
    throw new Error('Invalid file state in filesystem transaction journal')
  }
  return state as FileSystemTransactionJournalFileState
}

function normalizeFileSystemTransactionJournal(
  root: string,
  journal: unknown,
  owner: FileSystemTransactionJournalOwner,
): FileSystemTransactionJournal {
  if (
    typeof journal !== 'object' ||
    journal === null ||
    (journal as { version?: unknown }).version !==
      fileSystemTransactionStateVersion ||
    ((journal as { phase?: unknown }).phase !== 'prepared' &&
      (journal as { phase?: unknown }).phase !== 'committed') ||
    (journal as { token?: unknown }).token !== owner.token ||
    !Array.isArray((journal as { entries?: unknown }).entries) ||
    (journal as { entries: unknown[] }).entries.length >
      fileSystemTransactionMaximumEntries
  ) {
    throw new Error(
      `Invalid filesystem transaction journal at ${fileSystemTransactionJournalPath(root)}`,
    )
  }
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
      const parent = candidate.parent
      if (
        typeof parent.canonicalParent !== 'string' ||
        typeof parent.identityPath !== 'string' ||
        !Number.isSafeInteger(parent.dev) ||
        !Number.isSafeInteger(parent.ino)
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
          dev: parent.dev as number,
          identityPath: parent.identityPath,
          ino: parent.ino as number,
        },
        path: candidate.path,
      }
    },
  )
  return {
    entries,
    phase: (journal as FileSystemTransactionJournal).phase,
    token: owner.token,
    version: fileSystemTransactionStateVersion,
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
    (owner as { version?: unknown }).version !==
      fileSystemTransactionStateVersion ||
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
  const path = join(
    fileSystemTransactionJournalPath(root),
    fileSystemTransactionStateName,
  )
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
  const identityStats = await lstatIfExists(identityPath)
  if (
    !identityStats?.isDirectory() ||
    identityStats.dev !== entry.parent.dev ||
    identityStats.ino !== entry.parent.ino
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
      if (fileSystemTransactionFileStatesMatch(current, entry.original)) {
        continue
      }
      if (!fileSystemTransactionFileStatesMatch(current, entry.final)) {
        throw new Error(
          `Filesystem transaction path changed outside the transaction: ${path}`,
        )
      }
      if (entry.original) {
        const backup = resolveFileSystemTransactionRelativePath(
          root,
          entry.backup!,
          'Transaction backup',
        )
        const backupState = await fileSystemTransactionFileState(backup)
        if (
          !fileSystemTransactionFileStatesMatch(backupState, entry.original)
        ) {
          throw new Error(
            `Filesystem transaction backup changed before recovery: ${backup}`,
          )
        }
        await copyFileAtomic(backup, path, entry.original.mode)
      } else if (await unlinkFileIfExists(path)) {
        await syncDirectory(dirname(path))
      }
    } catch (error) {
      errors.push(
        new Error(
          `Failed to roll back filesystem transaction path ${path}: ${errorMessage(error)}`,
          { cause: error },
        ),
      )
    }
  }
  return errors
}

async function recoverFileSystemTransaction(root: string) {
  const journalRoot = fileSystemTransactionJournalPath(root)
  const journalStats = await lstatIfExists(journalRoot)
  if (!journalStats) {
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
    await removeFileSystemTransactionJournal(root, owner.token, journalStats)
    return
  }
  const journal = await readFileSystemTransactionJournal(root, owner)
  if (journal.phase === 'prepared') {
    const rollbackErrors = await rollbackFileSystemTransaction(root, journal)
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        rollbackErrors,
        `Failed to recover interrupted filesystem transaction at ${journalRoot}`,
        { cause: rollbackErrors[0] },
      )
    }
  }
  await removeFileSystemTransactionJournal(root, owner.token, journalStats)
}

function fileSystemTransactionStateMatches(
  left: Stats,
  right: Stats | undefined,
) {
  return (
    right?.isDirectory() === true &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino
  )
}

async function retireFileSystemTransactionState(
  root: string,
  path: string,
  expectedStats: Stats,
  expectedToken?: string,
) {
  const currentStats = await lstatIfExists(path)
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
    retiredPath = fileSystemTransactionRetiredPath(root)
    if (await lstatIfExists(retiredPath)) {
      continue
    }
    try {
      await rename(path, retiredPath)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      throw error
    }
  }
  await syncDirectory(root)

  const retiredStats = await lstatIfExists(retiredPath)
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

async function removeFileSystemTransactionCandidate(
  root: string,
  candidateRoot: string,
  candidateStats: Stats,
) {
  const retiredPath = await retireFileSystemTransactionState(
    root,
    candidateRoot,
    candidateStats,
  )
  await rm(retiredPath, { force: true, recursive: true })
  await syncDirectory(root)
}

async function removeFileSystemTransactionJournal(
  root: string,
  token: string,
  journalStats: Stats,
) {
  const journalRoot = fileSystemTransactionJournalPath(root)
  const retiredPath = await retireFileSystemTransactionState(
    root,
    journalRoot,
    journalStats,
    token,
  )
  await rm(retiredPath, { force: true, recursive: true })
  await syncDirectory(root)
}

function pathsHaveEquivalentPlatformSpelling(left: string, right: string) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function atomicTemporaryPath(path: string) {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
}

async function syncFile(path: string) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(path: string) {
  if (process.platform === 'win32') {
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
