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
import { createHash } from 'node:crypto'
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

let atomicWriteSequence = 0
const reconciliationTails = new Map<string, Promise<void>>()
const reconciliationLockRoot = join(
  tmpdir(),
  'napi-rs-filesystem-reconciliation',
)
const incompleteLockGracePeriod = 30_000

interface ReconciliationLockOwner {
  createdAt: number
  key: string
  pid: number
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
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${atomicWriteSequence++}.tmp`,
  )
  try {
    await writeFile(temporaryPath, data, options)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export async function copyFileAtomic(
  source: string,
  destination: string,
  mode?: number,
) {
  await mkdir(dirname(destination), { recursive: true })
  const temporaryPath = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${atomicWriteSequence++}.tmp`,
  )
  try {
    await copyFile(source, temporaryPath)
    if (mode !== undefined) {
      await chmod(temporaryPath, mode)
    }
    await rename(temporaryPath, destination)
  } finally {
    await rm(temporaryPath, { force: true })
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

  await previous.catch(() => {})
  const key = await canonicalizeReconciliationPath(path)
  const releaseCrossProcessLock = await acquireReconciliationLock(key)
  try {
    return await operation()
  } finally {
    try {
      await releaseCrossProcessLock()
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
  const transactionRoot = resolve(root)
  const transactionWrites = writes.map((write) => ({
    destination: resolveTransactionPath(transactionRoot, write.destination),
    mode: write.mode,
    removeBeforeWrite: write.removeBeforeWrite
      ? resolveTransactionPath(transactionRoot, write.removeBeforeWrite)
      : undefined,
    source: write.source,
  }))
  const writesByDestination = new Map(
    transactionWrites.map((write) => [write.destination, write]),
  )
  const resolvedRemovals = removals.map((path) =>
    resolveTransactionPath(transactionRoot, path),
  )
  const preWriteRemovals = new Set(
    transactionWrites.flatMap(({ removeBeforeWrite }) =>
      removeBeforeWrite ? [removeBeforeWrite] : [],
    ),
  )
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
    if (!(await fileExists(removeBeforeWrite))) {
      throw new Error(
        `Filesystem transaction replacement source does not exist: ${removeBeforeWrite}`,
      )
    }
    if (await fileExists(destination)) {
      if (
        !(await pathsReferToSameDirectoryEntry(removeBeforeWrite, destination))
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
  const affected = new Set([
    ...writesByDestination.keys(),
    ...resolvedRemovals,
    ...preWriteRemovals,
  ])
  const backupRoot = await mkdirTemporaryChild(
    transactionRoot,
    'transaction-backup',
  )
  const backups = new Map<string, { mode: number; path: string }>()

  try {
    for (const path of affected) {
      if (
        replacementAliasParents.has(path) &&
        !replacementBackupPaths.has(path)
      ) {
        continue
      }
      if (!(await fileExists(path))) {
        continue
      }
      const backup = join(backupRoot, relative(transactionRoot, path))
      const mode = (await stat(path)).mode & 0o7777
      await copyFileAtomic(path, backup, mode)
      backups.set(path, { mode, path: backup })
    }

    try {
      for (const path of preWriteRemovals) {
        await rm(path, { force: true, recursive: true })
      }
      for (const { destination, mode, source } of transactionWrites) {
        await copyFileAtomic(source, destination, mode)
      }
      for (const path of affected) {
        if (!writesByDestination.has(path) && !preWriteRemovals.has(path)) {
          await rm(path, { force: true, recursive: true })
        }
      }
    } catch (error) {
      for (const path of [...affected].reverse()) {
        await rm(path, { force: true, recursive: true })
      }
      for (const [path, backup] of backups) {
        await copyFileAtomic(backup.path, path, backup.mode)
      }
      throw error
    }
  } finally {
    await rm(backupRoot, { force: true, recursive: true })
  }
}

async function pathsReferToSameDirectoryEntry(left: string, right: string) {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  if (resolvedLeft === resolvedRight) {
    return true
  }

  const [leftPath, rightPath, leftStats, rightStats] = await Promise.all([
    realpath(left),
    realpath(right),
    lstat(left),
    lstat(right),
  ])
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
  if (
    resolvedLeft.toLowerCase() !== resolvedRight.toLowerCase() ||
    leftPath.toLowerCase() !== rightPath.toLowerCase()
  ) {
    return false
  }

  const entries = await readdir(dirname(left))
  const leftName = basename(left)
  const rightName = basename(right)
  return !(
    leftName !== rightName &&
    entries.includes(leftName) &&
    entries.includes(rightName)
  )
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
      const owner: ReconciliationLockOwner = {
        createdAt: Date.now(),
        key,
        pid: process.pid,
      }
      await writeFile(ownerPath, JSON.stringify(owner), 'utf8')
      return () => rm(lockPath, { force: true, recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }

    if (await isStaleReconciliationLock(lockPath, ownerPath, key)) {
      await rm(lockPath, { force: true, recursive: true })
      continue
    }
    await delay(20)
  }
}

async function isStaleReconciliationLock(
  lockPath: string,
  ownerPath: string,
  key: string,
) {
  try {
    const owner = JSON.parse(
      await readFile(ownerPath, 'utf8'),
    ) as ReconciliationLockOwner
    return (
      owner.key !== key ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      !processExists(owner.pid)
    )
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
      !(error instanceof SyntaxError)
    ) {
      throw error
    }
    try {
      const lockStat = await stat(lockPath)
      return Date.now() - lockStat.mtimeMs > incompleteLockGracePeriod
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw statError
    }
  }
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

async function mkdirTemporaryChild(path: string, label: string) {
  await mkdir(path, { recursive: true })
  for (let sequence = 0; ; sequence += 1) {
    const candidate = join(
      path,
      `.napi-${label}.${process.pid}.${atomicWriteSequence++}.${sequence}`,
    )
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
