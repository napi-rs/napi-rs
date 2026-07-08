import {
  readFile,
  writeFile,
  unlink,
  copyFile,
  mkdir,
  stat,
  readdir,
  access,
  rename,
  rm,
  realpath,
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

export async function copyFileAtomic(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true })
  const temporaryPath = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${atomicWriteSequence++}.tmp`,
  )
  try {
    await copyFile(source, temporaryPath)
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
  const writesByDestination = new Map(
    writes.map((write) => [
      resolveTransactionPath(transactionRoot, write.destination),
      write.source,
    ]),
  )
  const affected = new Set([
    ...writesByDestination.keys(),
    ...removals.map((path) => resolveTransactionPath(transactionRoot, path)),
  ])
  const backupRoot = await mkdirTemporaryChild(
    transactionRoot,
    'transaction-backup',
  )
  const backups = new Map<string, string>()

  try {
    for (const path of affected) {
      if (!(await fileExists(path))) {
        continue
      }
      const backup = join(backupRoot, relative(transactionRoot, path))
      await copyFileAtomic(path, backup)
      backups.set(path, backup)
    }

    try {
      for (const [destination, source] of writesByDestination) {
        await copyFileAtomic(source, destination)
      }
      for (const path of affected) {
        if (!writesByDestination.has(path)) {
          await rm(path, { force: true, recursive: true })
        }
      }
    } catch (error) {
      await Promise.all(
        [...affected].map(async (path) => {
          const backup = backups.get(path)
          if (backup) {
            await copyFileAtomic(backup, path)
          } else {
            await rm(path, { force: true, recursive: true })
          }
        }),
      )
      throw error
    }
  } finally {
    await rm(backupRoot, { force: true, recursive: true })
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
