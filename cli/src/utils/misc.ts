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
} from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
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
const reconciliationLockRoot = join(
  tmpdir(),
  'napi-rs-filesystem-reconciliation',
)
const incompleteLockGracePeriod = 30_000
const reconciliationLeaseRefreshInterval = 5_000

interface ReconciliationLockOwner {
  createdAt: number
  key: string
  pid: number
  token: string
}

interface ReconciliationReclaimOwner {
  createdAt: number
  pid: number
  token: string
}

interface ReconciliationLockState {
  lockStats: Stats
  ownerContent?: string
  stale: boolean
}

interface TransactionParentIdentity {
  canonicalParent: string
  dev: number
  identityPath: string
  ino: number
}

export interface FileSystemTransactionWrite {
  destination: string
  mode?: number
  removeBeforeWrite?: string
  source: string
}

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
      await rename(temporaryPath, path)
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
      await rename(temporaryPath, destination)
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

  let releaseCrossProcessLock: (() => Promise<void>) | undefined
  try {
    await previous.catch(() => {})
    const key = await canonicalizeReconciliationPath(path)
    releaseCrossProcessLock = await acquireReconciliationLock(key)
    return await operation()
  } finally {
    try {
      await releaseCrossProcessLock?.()
    } finally {
      release()
      if (reconciliationTails.get(localKey) === tail) {
        reconciliationTails.delete(localKey)
      }
    }
  }
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
  const transactionRoot = await canonicalizeReconciliationPath(
    requestedTransactionRoot,
  )
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
  const backupRoot = await mkdirTemporaryChild(
    transactionRoot,
    'transaction-backup',
  )
  const backups = new Map<string, { mode: number; path: string }>()
  const touchedPaths = new Set<string>()
  let preserveBackupRoot = false

  try {
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
      const backup = join(backupRoot, relative(transactionRoot, path))
      const mode = stats.mode & 0o7777
      await copyFileAtomic(path, backup, mode)
      backups.set(path, { mode, path: backup })
    }

    try {
      for (const path of preWriteRemovals) {
        await assertTransactionParentUnchanged(
          transactionRoot,
          path,
          parentIdentities,
        )
        if (await unlinkFileIfExists(path)) {
          touchedPaths.add(path)
        }
      }
      for (const { destination, mode, source } of transactionWrites) {
        await assertTransactionParentUnchanged(
          transactionRoot,
          destination,
          parentIdentities,
        )
        await copyFileAtomic(source, destination, mode)
        touchedPaths.add(destination)
      }
      for (const path of affected) {
        if (!writesByDestination.has(path) && !preWriteRemovals.has(path)) {
          await assertTransactionParentUnchanged(
            transactionRoot,
            path,
            parentIdentities,
          )
          if (await unlinkFileIfExists(path)) {
            touchedPaths.add(path)
          }
        }
      }
    } catch (error) {
      const rollbackErrors: Error[] = []
      for (const path of [...touchedPaths].reverse()) {
        try {
          await assertTransactionParentUnchanged(
            transactionRoot,
            path,
            parentIdentities,
          )
          const backup = backups.get(path)
          if (backup) {
            await copyFileAtomic(backup.path, path, backup.mode)
          } else {
            await unlinkFileIfExists(path)
          }
        } catch (rollbackError) {
          rollbackErrors.push(
            new Error(
              `Failed to roll back filesystem transaction path ${path}: ${errorMessage(
                rollbackError,
              )}`,
              { cause: rollbackError },
            ),
          )
        }
      }
      if (rollbackErrors.length > 0) {
        preserveBackupRoot = true
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Filesystem transaction failed and rollback was incomplete; backups are preserved at ${backupRoot}`,
        )
      }
      throw error
    }
  } finally {
    if (!preserveBackupRoot) {
      await rm(backupRoot, { force: true, recursive: true })
    }
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

async function acquireReconciliationLock(key: string) {
  await mkdir(reconciliationLockRoot, { recursive: true })
  const lockPath = join(
    reconciliationLockRoot,
    createHash('sha256').update(key).digest('hex'),
  )
  const ownerPath = join(lockPath, 'owner.json')

  while (true) {
    try {
      await mkdir(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }

      const state = await inspectReconciliationLock(lockPath, ownerPath, key)
      if (
        state?.stale &&
        (await tryReclaimStaleReconciliationLock(
          lockPath,
          ownerPath,
          key,
          state,
        ))
      ) {
        continue
      }
      await delay(20)
      continue
    }

    const token = randomUUID()
    const owner: ReconciliationLockOwner = {
      createdAt: Date.now(),
      key,
      pid: process.pid,
      token,
    }
    try {
      await writeFileAtomic(ownerPath, JSON.stringify(owner), 'utf8')
      await waitForReconciliationReclaim(lockPath)
      const leasePath = reconciliationLeasePath(lockPath, token)
      if (
        !(await initializeReconciliationLease(ownerPath, leasePath, key, token))
      ) {
        throw new Error(
          `Lost filesystem reconciliation lock ownership before initialization: ${key}`,
        )
      }
      return maintainReconciliationLease(
        lockPath,
        ownerPath,
        leasePath,
        key,
        token,
      )
    } catch (error) {
      await waitForReconciliationReclaim(lockPath)
      if (await reconciliationLockIsOwnedBy(ownerPath, key, token)) {
        await rm(lockPath, { force: true, recursive: true })
      }
      throw error
    }
  }
}

function reconciliationLeasePath(lockPath: string, token: string) {
  return join(lockPath, `${token}.lease`)
}

function maintainReconciliationLease(
  lockPath: string,
  ownerPath: string,
  leasePath: string,
  key: string,
  token: string,
) {
  let refreshTail = Promise.resolve()
  const timer = setInterval(() => {
    refreshTail = refreshTail
      .then(async () => {
        await refreshReconciliationLease(ownerPath, leasePath, key, token)
      })
      .catch((error) => {
        debug.warn(
          `Failed to refresh filesystem reconciliation lease: ${(error as Error).message}`,
        )
      })
  }, reconciliationLeaseRefreshInterval)
  timer.unref()

  return async () => {
    clearInterval(timer)
    await refreshTail
    if (await reconciliationLockIsOwnedBy(ownerPath, key, token)) {
      await rm(lockPath, { force: true, recursive: true })
    }
  }
}

async function initializeReconciliationLease(
  ownerPath: string,
  leasePath: string,
  key: string,
  token: string,
) {
  const lockPath = dirname(ownerPath)
  await waitForReconciliationReclaim(lockPath)
  if (!(await reconciliationLockIsOwnedBy(ownerPath, key, token))) {
    return false
  }
  try {
    await writeFile(leasePath, String(Date.now()), {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return false
  }
  await waitForReconciliationReclaim(lockPath)
  if (await reconciliationLockIsOwnedBy(ownerPath, key, token)) {
    return true
  }
  await unlinkFileIfExists(leasePath)
  return false
}

async function refreshReconciliationLease(
  ownerPath: string,
  leasePath: string,
  key: string,
  token: string,
) {
  if (!(await reconciliationLockIsOwnedBy(ownerPath, key, token))) {
    return false
  }
  try {
    await writeFile(leasePath, String(Date.now()), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return false
  }
  return reconciliationLockIsOwnedBy(ownerPath, key, token)
}

async function reconciliationLockIsOwnedBy(
  ownerPath: string,
  key: string,
  token: string,
) {
  try {
    const owner = JSON.parse(
      await readFile(ownerPath, 'utf8'),
    ) as ReconciliationLockOwner
    return owner.key === key && owner.token === token
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
  lockPath: string,
  ownerPath: string,
  key: string,
): Promise<ReconciliationLockState | undefined> {
  const lockStats = await lstatIfExists(lockPath)
  if (!lockStats) {
    return
  }

  let ownerContent: string
  try {
    ownerContent = await readFile(ownerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return {
      lockStats,
      stale: Date.now() - lockStats.mtimeMs > incompleteLockGracePeriod,
    }
  }
  const ownerStats = await lstatIfExists(ownerPath)
  if (!ownerStats) {
    return {
      lockStats,
      stale: Date.now() - lockStats.mtimeMs > incompleteLockGracePeriod,
    }
  }
  const invalidOwnerIsStale =
    Date.now() - ownerStats.mtimeMs > incompleteLockGracePeriod

  try {
    const owner = JSON.parse(ownerContent) as ReconciliationLockOwner
    if (
      owner.key !== key ||
      !Number.isSafeInteger(owner.createdAt) ||
      owner.createdAt <= 0 ||
      owner.createdAt > Date.now() + incompleteLockGracePeriod ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      !isReconciliationLockToken(owner.token)
    ) {
      return {
        lockStats,
        ownerContent,
        stale: invalidOwnerIsStale,
      }
    }
    return {
      lockStats,
      ownerContent,
      stale: !processExists(owner.pid),
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    return {
      lockStats,
      ownerContent,
      stale: invalidOwnerIsStale,
    }
  }
}

async function tryReclaimStaleReconciliationLock(
  lockPath: string,
  ownerPath: string,
  key: string,
  expectedState: ReconciliationLockState,
) {
  const reclaimPath = reconciliationReclaimPath(lockPath)
  const token = randomUUID()
  const reclaimOwner: ReconciliationReclaimOwner = {
    createdAt: Date.now(),
    pid: process.pid,
    token,
  }
  try {
    await writeFile(reclaimPath, JSON.stringify(reclaimOwner), {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
    await removeStaleReconciliationReclaim(reclaimPath)
    return false
  }

  let reclaimed = false
  try {
    if (!(await reconciliationReclaimIsOwnedBy(reclaimPath, token))) {
      return false
    }
    const currentState = await inspectReconciliationLock(
      lockPath,
      ownerPath,
      key,
    )
    if (
      !currentState ||
      !reconciliationLockStatesMatch(expectedState, currentState) ||
      (expectedState.ownerContent !== undefined && !currentState.stale)
    ) {
      return false
    }
    if (!(await reconciliationReclaimIsOwnedBy(reclaimPath, token))) {
      return false
    }

    const stalePath = `${lockPath}.stale.${randomUUID()}`
    try {
      await rename(lockPath, stalePath)
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error as NodeJS.ErrnoException).code === 'EACCES' ||
        (error as NodeJS.ErrnoException).code === 'EPERM'
      ) {
        return false
      }
      throw error
    }
    reclaimed = true
    await rm(stalePath, { force: true, recursive: true })
    return true
  } finally {
    if (
      !reclaimed &&
      (await reconciliationReclaimIsOwnedBy(reclaimPath, token))
    ) {
      await unlinkFileIfExists(reclaimPath)
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

function reconciliationReclaimPath(lockPath: string) {
  return join(lockPath, 'reclaim.json')
}

async function waitForReconciliationReclaim(lockPath: string) {
  const reclaimPath = reconciliationReclaimPath(lockPath)
  while (await pathExistsAsync(reclaimPath)) {
    await removeStaleReconciliationReclaim(reclaimPath)
    if (await pathExistsAsync(reclaimPath)) {
      await delay(20)
    }
  }
}

async function reconciliationReclaimIsOwnedBy(
  reclaimPath: string,
  token: string,
) {
  try {
    const owner = JSON.parse(
      await readFile(reclaimPath, 'utf8'),
    ) as ReconciliationReclaimOwner
    return owner.token === token
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

async function removeStaleReconciliationReclaim(reclaimPath: string) {
  let stale = false
  try {
    const owner = JSON.parse(
      await readFile(reclaimPath, 'utf8'),
    ) as ReconciliationReclaimOwner
    stale =
      !Number.isSafeInteger(owner.createdAt) ||
      owner.createdAt <= 0 ||
      owner.createdAt > Date.now() + incompleteLockGracePeriod ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      !isReconciliationLockToken(owner.token) ||
      !processExists(owner.pid)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    const reclaimStats = await lstatIfExists(reclaimPath)
    stale =
      reclaimStats !== undefined &&
      Date.now() - reclaimStats.mtimeMs > incompleteLockGracePeriod
  }
  if (!stale) {
    return
  }

  const stalePath = `${reclaimPath}.stale.${randomUUID()}`
  try {
    await rename(reclaimPath, stalePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  await unlinkFileIfExists(stalePath)
}

function isReconciliationLockToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    )
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

async function mkdirTemporaryChild(path: string, label: string) {
  await mkdir(path, { recursive: true })
  while (true) {
    const candidate = join(path, `.napi-${label}.${randomUUID()}`)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }
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
