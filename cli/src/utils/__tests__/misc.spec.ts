import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import ava, { type TestFn } from 'ava'

import {
  commitFileSystemTransaction,
  copyFileAtomic,
  getPackageReconciliationRoot,
  updatePackageJson,
  withFileSystemReconciliation,
  writeFileAtomic,
} from '../misc.js'

const execFileAsync = promisify(execFile)
const reconciliationLockName = '.napi-rs-filesystem-reconciliation'
const reconciliationReclaimMarker = '.reclaim.'
const reconciliationMetadataExtension = '.swp'
const reconciliationLockKind = 'napi-rs-filesystem-reconciliation-lock'
const reconciliationReclaimKind = 'napi-rs-filesystem-reconciliation-reclaim'
const transactionJournalName = '.napi-rs-filesystem-transaction.swp'

function reconciliationLockPath(key: string) {
  return join(
    dirname(key),
    `${reconciliationLockName}.${createHash('sha256')
      .update(key)
      .digest('hex')}${reconciliationMetadataExtension}`,
  )
}

function reconciliationReclaimPath(key: string) {
  return join(
    dirname(key),
    `${reconciliationLockName}${reconciliationReclaimMarker}${createHash(
      'sha256',
    )
      .update(key)
      .digest('hex')}${reconciliationMetadataExtension}`,
  )
}

function reconciliationCandidatePath(path: string, token: string) {
  return join(
    dirname(path),
    `${basename(path, extname(path))}.candidate.${token}${reconciliationMetadataExtension}`,
  )
}

function transactionSiblingPath(
  root: string,
  marker: 'candidate' | 'retired',
  token: string,
) {
  return join(
    root,
    `${basename(transactionJournalName, extname(transactionJournalName))}.${marker}.${token}${extname(transactionJournalName)}`,
  )
}

function transactionArtifactPath(
  destination: string,
  token: string,
  index: number,
  kind: 'prepared' | 'retired' | 'rollback',
) {
  return join(
    dirname(destination),
    `.${basename(destination)}.${token}.${index}.${kind}.tmp`,
  )
}

function transactionOwner(token: string, version = 1) {
  return {
    kind: 'napi-rs-filesystem-transaction',
    token,
    version,
  }
}

async function transactionFileState(path: string) {
  const [content, stats] = await Promise.all([readFile(path), lstat(path)])
  return {
    dev: stats.dev,
    hash: createHash('sha256').update(content).digest('hex'),
    ino: stats.ino,
    mode: stats.mode & 0o7777,
  }
}

async function readFileIfExists(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function removeReconciliationLockState(key: string) {
  await Promise.all([
    rm(reconciliationLockPath(key), { force: true, recursive: true }),
    rm(reconciliationReclaimPath(key), { force: true, recursive: true }),
  ])
}

async function waitForTransactionCandidate(root: string) {
  const prefix = `${basename(
    transactionJournalName,
    extname(transactionJournalName),
  )}.candidate.`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const name = (await readdir(root)).find(
      (entry) =>
        entry.startsWith(prefix) &&
        entry.endsWith(extname(transactionJournalName)),
    )
    if (name) {
      return join(root, name)
    }
    await delay(1)
  }
  throw new Error('Timed out waiting for transaction candidate creation')
}

async function waitForTransactionCandidateBackup(root: string, index = 0) {
  const candidate = await waitForTransactionCandidate(root)
  const backup = join(candidate, 'backups', String(index))
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (existsSync(backup)) {
      return backup
    }
    await delay(1)
  }
  throw new Error('Timed out waiting for transaction backup creation')
}

function reconciliationLockOwner(
  key: string,
  overrides: Partial<{
    boot: string | null
    bootSession: string | null
    createdAt: number
    incarnation: string | null
    machine: string | null
    namespace: string | null
    pid: number
    token: string
  }> = {},
) {
  const token = overrides.token ?? '00000000-0000-4000-8000-000000000001'
  return {
    candidate: `${basename(
      reconciliationLockPath(key),
      reconciliationMetadataExtension,
    )}.candidate.${token}${reconciliationMetadataExtension}`,
    createdAt: Date.now(),
    key,
    kind: reconciliationLockKind,
    pid: process.pid,
    token,
    version: 1,
    ...overrides,
  }
}

function reconciliationReclaimOwner(
  key: string,
  overrides: Partial<{
    boot: string | null
    bootSession: string | null
    createdAt: number
    incarnation: string | null
    machine: string | null
    namespace: string | null
    pid: number
    token: string
  }> = {},
) {
  const token = overrides.token ?? '00000000-0000-4000-8000-000000000008'
  return {
    candidate: `${basename(
      reconciliationReclaimPath(key),
      reconciliationMetadataExtension,
    )}.candidate.${token}${reconciliationMetadataExtension}`,
    createdAt: Date.now(),
    key,
    kind: reconciliationReclaimKind,
    pid: process.pid,
    token,
    version: 1,
    ...overrides,
  }
}

async function currentProcessIncarnation(root: string) {
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  let incarnation: unknown
  await withFileSystemReconciliation(root, async () => {
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as Record<
      string,
      unknown
    >
    if (!Object.hasOwn(owner, 'incarnation')) {
      throw new Error('Reconciliation lock owner omitted its incarnation')
    }
    incarnation = owner.incarnation
  })
  if (typeof incarnation !== 'string') {
    throw new Error(
      `Process incarnation is unavailable on ${process.platform}: ${String(incarnation)}`,
    )
  }
  if (
    process.platform === 'linux' &&
    !/^linux-proc:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:\d+$/.test(
      incarnation,
    )
  ) {
    throw new Error(`Linux process incarnation omitted boot_id: ${incarnation}`)
  }
  return incarnation
}

async function currentProcessExecutionIdentity(root: string) {
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  let identity:
    | {
        boot: unknown
        bootSession: unknown
        machine: unknown
        namespace: unknown
      }
    | undefined
  await withFileSystemReconciliation(root, async () => {
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as Record<
      string,
      unknown
    >
    identity = {
      boot: owner.boot,
      bootSession: owner.bootSession,
      machine: owner.machine,
      namespace: owner.namespace,
    }
  })
  if (
    typeof identity?.boot !== 'string' ||
    (identity.bootSession !== null &&
      typeof identity.bootSession !== 'string') ||
    typeof identity.machine !== 'string' ||
    typeof identity.namespace !== 'string'
  ) {
    throw new Error(
      `Process execution identity is unavailable on ${process.platform}: ${JSON.stringify(identity)}`,
    )
  }
  return identity as {
    boot: string
    bootSession: string | null
    machine: string
    namespace: string
  }
}

function differentProcessIncarnation(incarnation: string) {
  return `${incarnation}0`
}

function differentProcessIncarnationFormat(incarnation: string) {
  return incarnation.startsWith('windows-start:')
    ? 'ps-lstart:QQ'
    : 'windows-start:1'
}

async function installReconciliationReclaimGuard(
  lockPath: string,
  reclaimPath: string,
  key: string,
  incarnation: string,
) {
  const lockOwner = JSON.parse(await readFile(lockPath, 'utf8')) as {
    boot?: string | null
    bootSession?: string | null
    machine?: string | null
    namespace?: string | null
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (!existsSync(lockPath)) {
      await delay(0)
      continue
    }
    try {
      await writeFile(
        reclaimPath,
        JSON.stringify(
          reconciliationReclaimOwner(key, {
            boot: lockOwner.boot,
            bootSession: lockOwner.bootSession,
            incarnation,
            machine: lockOwner.machine,
            namespace: lockOwner.namespace,
          }),
        ),
        { flag: 'wx' },
      )
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
  throw new Error('Timed out installing reconciliation reclaim guard')
}

const test = ava as TestFn<{
  tmpDir: string
}>
const windowsTest = process.platform === 'win32' ? test : test.skip

test.beforeEach(async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'napi-rs-misc-spec-'))
  t.context = {
    tmpDir,
  }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('updatePackageJson merges nested objects instead of overwriting them', async (t) => {
  const packageJsonPath = join(t.context.tmpDir, 'package.json')

  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        name: 'fixture',
        version: '1.0.0',
        optionalDependencies: {
          fsevents: '^2.3.3',
        },
      },
      null,
      2,
    ),
  )

  await updatePackageJson(packageJsonPath, {
    optionalDependencies: {
      '@napi-rs/fixture-darwin-arm64': '1.0.1',
    },
  })

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  t.deepEqual(packageJson.optionalDependencies, {
    fsevents: '^2.3.3',
    '@napi-rs/fixture-darwin-arm64': '1.0.1',
  })
})

test('writeFileAtomic replaces a file without leaving temporary output', async (t) => {
  const path = join(t.context.tmpDir, 'nested', 'output.txt')
  await writeFileAtomic(path, 'first', 'utf8')
  await writeFileAtomic(path, 'second', 'utf8')

  t.is(await readFile(path, 'utf8'), 'second')
})

test('copyFileAtomic replaces a file without exposing a partial destination', async (t) => {
  const source = join(t.context.tmpDir, 'source.bin')
  const destination = join(t.context.tmpDir, 'nested', 'destination.bin')
  await writeFile(source, 'first')
  await copyFileAtomic(source, destination)
  await writeFile(source, 'second')
  await copyFileAtomic(source, destination)

  t.is(await readFile(destination, 'utf8'), 'second')
})

windowsTest(
  'copyFileAtomic flushes Windows files while preserving read-only modes',
  async (t) => {
    const source = join(t.context.tmpDir, 'source.bin')
    const requestedModeDestination = join(
      t.context.tmpDir,
      'requested-mode.bin',
    )
    const inheritedModeDestination = join(
      t.context.tmpDir,
      'inherited-mode.bin',
    )
    await writeFile(source, 'replacement')

    await copyFileAtomic(source, requestedModeDestination, 0o444)

    t.is(await readFile(requestedModeDestination, 'utf8'), 'replacement')
    t.is((await stat(requestedModeDestination)).mode & 0o200, 0)

    await chmod(source, 0o444)
    await copyFileAtomic(source, inheritedModeDestination)

    t.is(await readFile(inheritedModeDestination, 'utf8'), 'replacement')
    t.is((await stat(inheritedModeDestination)).mode & 0o200, 0)
  },
)

test('atomic copies do not follow predictable temporary symlinks', async (t) => {
  const directory = join(t.context.tmpDir, 'atomic-symlink')
  const source = join(t.context.tmpDir, 'source.bin')
  const destination = join(directory, 'destination.bin')
  const outside = join(t.context.tmpDir, 'outside.bin')
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(source, 'replacement'),
    writeFile(outside, 'outside sentinel'),
  ])
  await Promise.all(
    Array.from({ length: 256 }, (_, sequence) =>
      symlink(
        outside,
        join(directory, `.destination.bin.${process.pid}.${sequence}.tmp`),
        'file',
      ),
    ),
  )

  await copyFileAtomic(source, destination)

  t.is(await readFile(outside, 'utf8'), 'outside sentinel')
  t.is(await readFile(destination, 'utf8'), 'replacement')
  t.true((await lstat(destination)).isFile())
})

test('filesystem transactions reject duplicate canonical destinations', async (t) => {
  const root = join(t.context.tmpDir, 'duplicate-destination-root')
  const realParent = join(root, 'real')
  const aliasParent = join(root, 'alias')
  const staging = join(t.context.tmpDir, 'duplicate-destination-staging')
  const firstSource = join(staging, 'first.txt')
  const secondSource = join(staging, 'second.txt')
  const destination = join(realParent, 'output.txt')
  await Promise.all([
    mkdir(realParent, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(firstSource, 'first'),
    writeFile(secondSource, 'second'),
  ])
  await symlink(
    realParent,
    aliasParent,
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  await t.throwsAsync(
    commitFileSystemTransaction(
      root,
      [
        { source: firstSource, destination },
        {
          source: secondSource,
          destination: join(aliasParent, 'output.txt'),
        },
      ],
      [],
    ),
    { message: /Duplicate canonical filesystem transaction destination/ },
  )

  t.false(existsSync(destination))
  t.false(existsSync(join(root, transactionJournalName)))
})

test('filesystem transactions reject reserved recovery paths before creating parents', async (t) => {
  const root = join(t.context.tmpDir, 'reserved-path-root')
  const staging = join(t.context.tmpDir, 'reserved-path-staging')
  const source = join(staging, 'source.txt')
  const reservedParent = join(root, transactionJournalName, 'nested')
  await Promise.all([mkdir(root), mkdir(staging)])
  await writeFile(source, 'replacement')

  await t.throwsAsync(
    commitFileSystemTransaction(
      root,
      [{ source, destination: join(reservedParent, 'destination.txt') }],
      [],
    ),
    { message: /overlaps reserved recovery state/ },
  )

  t.false(existsSync(join(root, transactionJournalName)))
  t.false(existsSync(reservedParent))
})

test('filesystem transactions publish transaction-owned source snapshots', async (t) => {
  const root = join(t.context.tmpDir, 'source-snapshot-root')
  const first = join(root, 'first.txt')
  const second = join(root, 'second.txt')
  await mkdir(root)
  await Promise.all([
    writeFile(first, 'first source'),
    writeFile(second, 'second source'),
  ])

  await commitFileSystemTransaction(
    root,
    [
      { source: first, destination: second },
      { source: second, destination: first },
    ],
    [],
  )

  t.is(await readFile(first, 'utf8'), 'second source')
  t.is(await readFile(second, 'utf8'), 'first source')
  t.false(existsSync(join(root, transactionJournalName)))
})

test('filesystem transactions preserve an external destination update made after backup', async (t) => {
  const root = join(t.context.tmpDir, 'transaction-commit-conflict')
  const staging = join(t.context.tmpDir, 'transaction-commit-conflict-staging')
  const source = join(staging, 'replacement.txt')
  const target = join(root, 'target.txt')
  const external = join(root, 'external.txt')
  await Promise.all([mkdir(root), mkdir(staging)])
  await Promise.all([
    writeFile(source, 'transaction replacement'),
    writeFile(target, 'original target'),
  ])

  const writes = [{ source, destination: target }]
  for (let index = 0; index < 128; index += 1) {
    const destination = join(root, `trailing-${index}.txt`)
    await writeFile(destination, `original ${index}`)
    writes.push({ source, destination })
  }

  const watcher = (async () => {
    // Backup 1 proves that target backup 0 is complete while later backups
    // still keep the candidate open long enough for deterministic sabotage.
    await waitForTransactionCandidateBackup(root, 1)
    await writeFile(external, 'external destination update')
    await rename(external, target)
  })()

  const error = (await t.throwsAsync(
    commitFileSystemTransaction(root, writes, []),
  )) as AggregateError
  await watcher

  t.true(error instanceof AggregateError)
  t.regex(error.message, /rollback was incomplete/)
  t.regex(String(error), /recovery state is preserved/)
  t.is(await readFile(target, 'utf8'), 'external destination update')
  t.true(existsSync(join(root, transactionJournalName)))
})

test('filesystem transaction recovery preserves a same-content external inode replacement', async (t) => {
  const root = join(t.context.tmpDir, 'transaction-rollback-conflict')
  const journalRoot = join(root, transactionJournalName)
  const backupRoot = join(journalRoot, 'backups')
  const token = '00000000-0000-4000-8000-000000000113'
  const destination = join(root, 'destination.txt')
  const backup = join(backupRoot, '0')
  const prepared = transactionArtifactPath(destination, token, 0, 'prepared')
  const retired = transactionArtifactPath(destination, token, 0, 'retired')
  const rollbackRetired = transactionArtifactPath(
    destination,
    token,
    0,
    'rollback',
  )
  await mkdir(backupRoot, { recursive: true })
  await writeFile(destination, 'original content')
  const original = await transactionFileState(destination)
  await writeFile(backup, 'original content')
  await rename(destination, retired)
  await writeFile(prepared, 'transaction content')
  const final = await transactionFileState(prepared)
  await writeFile(destination, 'transaction content')
  const external = await transactionFileState(destination)
  const parent = await lstat(root)

  await Promise.all([
    writeFile(
      join(journalRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token, 2)),
    ),
    writeFile(
      join(journalRoot, 'state.json'),
      JSON.stringify({
        entries: [
          {
            backup: join(transactionJournalName, 'backups', '0'),
            final,
            original,
            parent: {
              canonicalParent: '.',
              dev: parent.dev,
              identityPath: '.',
              ino: parent.ino,
            },
            path: basename(destination),
            prepared: basename(prepared),
            retired: basename(retired),
            rollbackRetired: basename(rollbackRetired),
          },
        ],
        phase: 'prepared',
        token,
        version: 2,
      }),
    ),
  ])

  const error = (await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {}),
  )) as AggregateError

  t.true(error instanceof AggregateError)
  t.regex(error.message, /Failed to recover interrupted filesystem transaction/)
  t.regex(String(error.errors[0]), /changed outside the transaction/)
  t.is(await readFile(destination, 'utf8'), 'transaction content')
  const preserved = await lstat(destination)
  t.is(preserved.dev, external.dev)
  t.is(preserved.ino, external.ino)
  t.true(existsSync(journalRoot))
})

test('filesystem transaction recovery does not mistake original contents for the original inode', async (t) => {
  const root = join(t.context.tmpDir, 'transaction-original-content-conflict')
  const journalRoot = join(root, transactionJournalName)
  const backupRoot = join(journalRoot, 'backups')
  const token = '00000000-0000-4000-8000-000000000115'
  const destination = join(root, 'destination.txt')
  const backup = join(backupRoot, '0')
  const prepared = transactionArtifactPath(destination, token, 0, 'prepared')
  const retired = transactionArtifactPath(destination, token, 0, 'retired')
  const rollbackRetired = transactionArtifactPath(
    destination,
    token,
    0,
    'rollback',
  )
  await mkdir(backupRoot, { recursive: true })
  await writeFile(destination, 'original content')
  const original = await transactionFileState(destination)
  await writeFile(backup, 'original content')
  await rename(destination, retired)
  await writeFile(prepared, 'transaction content')
  const final = await transactionFileState(prepared)
  await writeFile(destination, 'original content')
  const external = await transactionFileState(destination)
  const parent = await lstat(root)

  await Promise.all([
    writeFile(
      join(journalRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token, 2)),
    ),
    writeFile(
      join(journalRoot, 'state.json'),
      JSON.stringify({
        entries: [
          {
            backup: join(transactionJournalName, 'backups', '0'),
            final,
            original,
            parent: {
              canonicalParent: '.',
              dev: parent.dev,
              identityPath: '.',
              ino: parent.ino,
            },
            path: basename(destination),
            prepared: basename(prepared),
            retired: basename(retired),
            rollbackRetired: basename(rollbackRetired),
          },
        ],
        phase: 'prepared',
        token,
        version: 2,
      }),
    ),
  ])

  const error = (await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {}),
  )) as AggregateError

  t.true(error instanceof AggregateError)
  t.regex(error.message, /Failed to recover interrupted filesystem transaction/)
  t.regex(String(error.errors[0]), /changed outside the transaction/)
  t.is(await readFile(destination, 'utf8'), 'original content')
  const preserved = await lstat(destination)
  t.is(preserved.dev, external.dev)
  t.is(preserved.ino, external.ino)
  t.true(existsSync(retired))
  t.true(existsSync(journalRoot))
})

test('filesystem transaction recovery restores an original retired before publication', async (t) => {
  const root = join(t.context.tmpDir, 'transaction-pre-publication-retirement')
  const journalRoot = join(root, transactionJournalName)
  const backupRoot = join(journalRoot, 'backups')
  const token = '00000000-0000-4000-8000-000000000114'
  const destination = join(root, 'destination.txt')
  const backup = join(backupRoot, '0')
  const prepared = transactionArtifactPath(destination, token, 0, 'prepared')
  const retired = transactionArtifactPath(destination, token, 0, 'retired')
  const rollbackRetired = transactionArtifactPath(
    destination,
    token,
    0,
    'rollback',
  )
  await mkdir(backupRoot, { recursive: true })
  await writeFile(destination, 'original content')
  const original = await transactionFileState(destination)
  await writeFile(backup, 'original content')
  await rename(destination, retired)
  await writeFile(prepared, 'transaction content')
  const final = await transactionFileState(prepared)
  const parent = await lstat(root)

  await Promise.all([
    writeFile(
      join(journalRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token, 2)),
    ),
    writeFile(
      join(journalRoot, 'state.json'),
      JSON.stringify({
        entries: [
          {
            backup: join(transactionJournalName, 'backups', '0'),
            final,
            original,
            parent: {
              canonicalParent: '.',
              dev: parent.dev,
              identityPath: '.',
              ino: parent.ino,
            },
            path: basename(destination),
            prepared: basename(prepared),
            retired: basename(retired),
            rollbackRetired: basename(rollbackRetired),
          },
        ],
        phase: 'prepared',
        token,
        version: 2,
      }),
    ),
  ])

  await withFileSystemReconciliation(root, async () => {})

  t.is(await readFile(destination, 'utf8'), 'original content')
  const restored = await lstat(destination)
  t.is(restored.dev, original.dev)
  t.is(restored.ino, original.ino)
  t.false(existsSync(journalRoot))
  t.false(existsSync(prepared))
  t.false(existsSync(retired))
})

test('filesystem transaction recovery removes an already-restored legacy v1 journal', async (t) => {
  const root = join(t.context.tmpDir, 'legacy-v1-restored')
  const journalRoot = join(root, transactionJournalName)
  const backupRoot = join(journalRoot, 'backups')
  const destination = join(root, 'destination.txt')
  const backup = join(backupRoot, '0')
  const token = '00000000-0000-4000-8000-000000000115'
  await mkdir(backupRoot, { recursive: true })
  await Promise.all([
    writeFile(destination, 'original content'),
    writeFile(backup, 'original content'),
  ])
  const original = await transactionFileState(destination)
  const parent = await lstat(root)
  await Promise.all([
    writeFile(
      join(journalRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token)),
    ),
    writeFile(
      join(journalRoot, 'state.json'),
      JSON.stringify({
        entries: [
          {
            backup: join(transactionJournalName, 'backups', '0'),
            final: {
              hash: createHash('sha256')
                .update('transaction content')
                .digest('hex'),
              mode: original.mode,
            },
            original: { hash: original.hash, mode: original.mode },
            parent: {
              canonicalParent: '.',
              dev: parent.dev,
              identityPath: '.',
              ino: parent.ino,
            },
            path: basename(destination),
          },
        ],
        phase: 'prepared',
        token,
        version: 1,
      }),
    ),
  ])

  let entered = false
  await withFileSystemReconciliation(root, async () => {
    entered = true
  })

  t.true(entered)
  t.is(await readFile(destination, 'utf8'), 'original content')
  t.false(existsSync(journalRoot))
})

test('filesystem transaction recovery quarantines ambiguous legacy v1 journals without permanent poison', async (t) => {
  const root = join(t.context.tmpDir, 'legacy-v1-ambiguous')
  const journalRoot = join(root, transactionJournalName)
  const backupRoot = join(journalRoot, 'backups')
  const destination = join(root, 'destination.txt')
  const backup = join(backupRoot, '0')
  const token = '00000000-0000-4000-8000-000000000116'
  await mkdir(backupRoot, { recursive: true })
  await Promise.all([
    writeFile(destination, 'transaction or external content'),
    writeFile(backup, 'original content'),
  ])
  const parent = await lstat(root)
  const originalMode = (await lstat(backup)).mode & 0o7777
  await Promise.all([
    writeFile(
      join(journalRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token)),
    ),
    writeFile(
      join(journalRoot, 'state.json'),
      JSON.stringify({
        entries: [
          {
            backup: join(transactionJournalName, 'backups', '0'),
            final: {
              hash: createHash('sha256')
                .update('transaction or external content')
                .digest('hex'),
              mode: originalMode,
            },
            original: {
              hash: createHash('sha256')
                .update('original content')
                .digest('hex'),
              mode: originalMode,
            },
            parent: {
              canonicalParent: '.',
              dev: parent.dev,
              identityPath: '.',
              ino: parent.ino,
            },
            path: basename(destination),
          },
        ],
        phase: 'prepared',
        token,
        version: 1,
      }),
    ),
  ])

  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {}),
    {
      message:
        /Legacy filesystem transaction journal v1 cannot prove ownership/,
    },
  )
  t.is((error as NodeJS.ErrnoException).code, 'ENOTRECOVERABLE')
  t.false(existsSync(journalRoot))
  t.true(existsSync((error as NodeJS.ErrnoException).path!))
  t.is(await readFile(destination, 'utf8'), 'transaction or external content')

  let entered = false
  await withFileSystemReconciliation(root, async () => {
    entered = true
  })
  t.true(entered)
})

test('filesystem transaction recovery preserves unowned journal artifact paths', async (t) => {
  const root = join(t.context.tmpDir, 'unowned-journal-artifact')
  const journalRoot = join(root, transactionJournalName)
  const token = '00000000-0000-4000-8000-000000000117'
  const destination = join(root, 'destination.txt')
  const userFile = join(root, 'user.txt')
  await mkdir(journalRoot, { recursive: true })
  await writeFile(userFile, 'user content')
  const final = await transactionFileState(userFile)
  const parent = await lstat(root)
  await Promise.all([
    writeFile(
      join(journalRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token, 2)),
    ),
    writeFile(
      join(journalRoot, 'state.json'),
      JSON.stringify({
        entries: [
          {
            final,
            parent: {
              canonicalParent: '.',
              dev: parent.dev,
              identityPath: '.',
              ino: parent.ino,
            },
            path: basename(destination),
            prepared: basename(userFile),
            retired: basename(
              transactionArtifactPath(destination, token, 0, 'retired'),
            ),
            rollbackRetired: basename(
              transactionArtifactPath(destination, token, 0, 'rollback'),
            ),
          },
        ],
        phase: 'committed',
        token,
        version: 2,
      }),
    ),
  ])

  await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {}),
    { message: /is not a transaction-owned artifact/ },
  )

  t.is(await readFile(userFile, 'utf8'), 'user content')
  t.true(existsSync(journalRoot))
})

test('filesystem transaction recovery preserves an owner-only canonical journal', async (t) => {
  const root = join(t.context.tmpDir, 'owner-only-journal')
  const journalRoot = join(root, transactionJournalName)
  const sentinel = join(journalRoot, 'sentinel.txt')
  const token = '00000000-0000-4000-8000-000000000118'
  await mkdir(journalRoot, { recursive: true })
  await Promise.all([
    writeFile(
      join(journalRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token, 2)),
    ),
    writeFile(sentinel, 'preserve me'),
  ])

  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {}),
    { message: /recovery state is incomplete/ },
  )

  t.is((error as NodeJS.ErrnoException).code, 'ENOTRECOVERABLE')
  t.is(
    (error as NodeJS.ErrnoException).path,
    join(await realpath(root), transactionJournalName, 'state.json'),
  )
  t.is(await readFile(sentinel, 'utf8'), 'preserve me')
  t.true(existsSync(journalRoot))
})

test('filesystem transaction recovery preserves missing-owner error metadata', async (t) => {
  const root = join(t.context.tmpDir, 'missing-journal-owner')
  const journalRoot = join(root, transactionJournalName)
  await mkdir(journalRoot, { recursive: true })

  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {}),
  )

  t.is((error as NodeJS.ErrnoException).code, 'ENOENT')
  t.is(
    (error as NodeJS.ErrnoException).path,
    join(await realpath(root), transactionJournalName, 'owner.json'),
  )
  t.true(existsSync(journalRoot))
})

test('filesystem transactions restore prior outputs after a commit failure', async (t) => {
  const root = join(t.context.tmpDir, 'transaction')
  const staging = join(t.context.tmpDir, 'staging')
  const first = join(root, 'first.txt')
  const second = join(root, 'second.txt')
  const oldName = join(root, 'old-name.txt')
  const newName = join(root, 'new-name.txt')
  const stagedFirst = join(staging, 'first.txt')
  const stagedRename = join(staging, 'renamed.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(first, 'prior first'),
    writeFile(second, 'prior second'),
    writeFile(oldName, 'prior renamed file'),
    writeFile(stagedFirst, 'replacement first'),
    writeFile(stagedRename, 'replacement renamed file'),
  ])
  if (process.platform !== 'win32') {
    await Promise.all([
      chmod(first, 0o755),
      chmod(second, 0o640),
      chmod(oldName, 0o751),
    ])
  }

  await t.throwsAsync(() =>
    commitFileSystemTransaction(
      root,
      [
        { source: stagedFirst, destination: first, mode: 0o600 },
        {
          source: stagedRename,
          destination: newName,
          mode: 0o700,
          removeBeforeWrite: oldName,
        },
        { source: join(staging, 'missing.txt'), destination: second },
      ],
      [],
    ),
  )

  t.is(await readFile(first, 'utf8'), 'prior first')
  t.is(await readFile(second, 'utf8'), 'prior second')
  t.is(await readFile(oldName, 'utf8'), 'prior renamed file')
  t.false(existsSync(newName))
  if (process.platform !== 'win32') {
    t.is((await stat(first)).mode & 0o7777, 0o755)
    t.is((await stat(second)).mode & 0o7777, 0o640)
    t.is((await stat(oldName)).mode & 0o7777, 0o751)
  }
})

test('filesystem transactions restore same-path replacements after a later failure', async (t) => {
  const root = join(t.context.tmpDir, 'same-path-transaction')
  const staging = join(t.context.tmpDir, 'same-path-staging')
  const existing = join(root, 'existing.txt')
  const stagedExisting = join(staging, 'existing.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(existing, 'prior existing'),
    writeFile(stagedExisting, 'replacement existing'),
  ])
  if (process.platform !== 'win32') {
    await chmod(existing, 0o751)
  }

  await t.throwsAsync(() =>
    commitFileSystemTransaction(
      root,
      [
        {
          source: stagedExisting,
          destination: existing,
          mode: 0o600,
          removeBeforeWrite: existing,
        },
        {
          source: join(staging, 'missing.txt'),
          destination: join(root, 'later.txt'),
        },
      ],
      [],
    ),
  )

  t.is(await readFile(existing, 'utf8'), 'prior existing')
  t.false(existsSync(join(root, 'later.txt')))
  if (process.platform !== 'win32') {
    t.is((await stat(existing)).mode & 0o7777, 0o751)
  }
})

const crashRecoveryTest = process.platform === 'win32' ? test.skip : test

crashRecoveryTest(
  'filesystem transactions recover a process killed after partial commit',
  async (t) => {
    // This exercises process-crash recovery. On Windows, Node cannot fsync
    // directories, so the implementation makes no power-loss durability claim.
    t.timeout(60_000)
    const root = join(t.context.tmpDir, 'transaction-crash-recovery')
    const staging = join(t.context.tmpDir, 'transaction-crash-staging')
    const workerPath = join(t.context.tmpDir, 'transaction-crash-worker.mjs')
    const source = join(staging, 'replacement.txt')
    const fileCount = 400
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(staging, { recursive: true }),
    ])
    await writeFile(source, 'replacement')
    await Promise.all(
      Array.from({ length: fileCount }, (_, index) =>
        writeFile(join(root, `${index}.txt`), `prior ${index}`),
      ),
    )
    await writeFile(
      workerPath,
      `import { once } from 'node:events'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { commitFileSystemTransaction } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

const [root, source, count] = process.argv.slice(2)
const lastIndex = Number(count) - 1
const watcher = new Worker(
  \`
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { parentPort, workerData } = require('node:worker_threads')
const wait = new Int32Array(new SharedArrayBuffer(4))
parentPort.postMessage('ready')
while (true) {
  try {
    if (
      readFileSync(join(workerData.root, '0.txt'), 'utf8') === 'replacement' &&
      readFileSync(join(workerData.root, workerData.last + '.txt'), 'utf8') ===
        'prior ' + workerData.last
    ) {
      process.kill(workerData.pid, 'SIGKILL')
    }
  } catch {}
  Atomics.wait(wait, 0, 0, 1)
}
\`,
  {
    eval: true,
    workerData: {
      last: lastIndex,
      pid: process.pid,
      root,
    },
  },
)
await once(watcher, 'message')
try {
  await commitFileSystemTransaction(
    root,
    Array.from({ length: Number(count) }, (_, index) => ({
      source,
      destination: join(root, \`\${index}.txt\`),
    })),
    [],
  )
} finally {
  await watcher.terminate()
}
throw new Error('Transaction completed before the crash observer saw a partial commit')
`,
    )

    const child = spawn(
      process.execPath,
      [
        '--import',
        '@oxc-node/core/register',
        workerPath,
        root,
        source,
        String(fileCount),
      ],
      { cwd: process.cwd(), stdio: 'ignore' },
    )
    t.teardown(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    })
    const childClosed = new Promise<NodeJS.Signals | null>(
      (resolveClosed, rejectClosed) => {
        child.once('error', rejectClosed)
        child.once('close', (_code, signal) => resolveClosed(signal))
      },
    )
    t.is(await childClosed, 'SIGKILL')

    const journalRoot = join(root, '.napi-rs-filesystem-transaction.swp')
    t.true(existsSync(journalRoot))
    await withFileSystemReconciliation(root, async () => {})

    t.false(existsSync(journalRoot))
    for (let index = 0; index < fileCount; index += 1) {
      t.is(await readFile(join(root, `${index}.txt`), 'utf8'), `prior ${index}`)
    }
  },
)

test('filesystem transactions ignore a crash residue created before candidate ownership', async (t) => {
  const root = join(t.context.tmpDir, 'pre-owner-crash-root')
  const staging = join(t.context.tmpDir, 'pre-owner-crash-staging')
  const candidateRoot = transactionSiblingPath(
    root,
    'candidate',
    '00000000-0000-4000-8000-000000000101',
  )
  const sentinel = join(candidateRoot, 'pre-owner-sentinel.txt')
  const source = join(staging, 'source.txt')
  const destination = join(root, 'destination.txt')
  await Promise.all([
    mkdir(candidateRoot, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(sentinel, 'unpublished candidate'),
    writeFile(source, 'committed'),
  ])

  await commitFileSystemTransaction(root, [{ source, destination }], [])

  t.is(await readFile(destination, 'utf8'), 'committed')
  t.is(await readFile(sentinel, 'utf8'), 'unpublished candidate')
  t.false(existsSync(join(root, transactionJournalName)))
})

test('filesystem transactions ignore a prepared candidate that crashed before publication', async (t) => {
  const root = join(t.context.tmpDir, 'pre-publication-crash-root')
  const staging = join(t.context.tmpDir, 'pre-publication-crash-staging')
  const token = '00000000-0000-4000-8000-000000000102'
  const candidateRoot = transactionSiblingPath(root, 'candidate', token)
  const source = join(staging, 'source.txt')
  const destination = join(root, 'destination.txt')
  await Promise.all([
    mkdir(join(candidateRoot, 'backups'), { recursive: true }),
    mkdir(join(candidateRoot, 'inputs'), { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(candidateRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token)),
    ),
    writeFile(
      join(candidateRoot, 'state.json'),
      JSON.stringify({
        entries: [],
        phase: 'prepared',
        token,
        version: 1,
      }),
    ),
    writeFile(source, 'committed'),
  ])

  await commitFileSystemTransaction(root, [{ source, destination }], [])

  t.is(await readFile(destination, 'utf8'), 'committed')
  t.true(existsSync(candidateRoot))
  t.false(existsSync(join(root, transactionJournalName)))
})

test('filesystem transactions ignore cleanup state retired before a crash', async (t) => {
  const root = join(t.context.tmpDir, 'retired-cleanup-crash-root')
  const staging = join(t.context.tmpDir, 'retired-cleanup-crash-staging')
  const token = '00000000-0000-4000-8000-000000000103'
  const retiredRoot = transactionSiblingPath(root, 'retired', token)
  const source = join(staging, 'source.txt')
  const destination = join(root, 'destination.txt')
  await Promise.all([
    mkdir(join(retiredRoot, 'backups'), { recursive: true }),
    mkdir(join(retiredRoot, 'inputs'), { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(retiredRoot, 'owner.json'),
      JSON.stringify(transactionOwner(token)),
    ),
    writeFile(
      join(retiredRoot, 'state.json'),
      JSON.stringify({
        entries: [],
        phase: 'committed',
        token,
        version: 1,
      }),
    ),
    writeFile(source, 'committed'),
  ])

  await commitFileSystemTransaction(root, [{ source, destination }], [])

  t.is(await readFile(destination, 'utf8'), 'committed')
  t.true(existsSync(retiredRoot))
  t.false(existsSync(join(root, transactionJournalName)))
})

const permissionsTest = process.platform === 'win32' ? test.skip : test

permissionsTest(
  'filesystem transactions continue rollback and preserve backups after a restoration failure',
  async (t) => {
    const root = join(t.context.tmpDir, 'incomplete-rollback')
    const staging = join(t.context.tmpDir, 'incomplete-rollback-staging')
    const lockedDirectory = join(root, 'locked')
    const failureDirectory = join(root, 'failure')
    const first = join(root, 'first.txt')
    const locked = join(lockedDirectory, 'locked.txt')
    const stagedReplacement = join(staging, 'replacement.txt')
    await Promise.all([
      mkdir(lockedDirectory, { recursive: true }),
      mkdir(failureDirectory, { recursive: true }),
      mkdir(staging, { recursive: true }),
    ])
    await Promise.all([
      writeFile(first, 'prior first'),
      writeFile(locked, 'prior locked'),
      writeFile(stagedReplacement, 'replacement'),
    ])

    const writes = [
      { source: stagedReplacement, destination: first },
      { source: stagedReplacement, destination: locked },
    ]
    for (let index = 0; index < 200; index += 1) {
      const destination = join(root, `trailing-${index}.txt`)
      await writeFile(destination, `prior ${index}`)
      writes.push({ source: stagedReplacement, destination })
    }
    writes.push({
      source: stagedReplacement,
      destination: join(failureDirectory, 'failure.txt'),
    })

    let watcherFinished = false
    const watcher = (async () => {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        if ((await readFileIfExists(locked)) === 'replacement') {
          await Promise.all([
            chmod(lockedDirectory, 0o555),
            chmod(failureDirectory, 0o555),
          ])
          watcherFinished = true
          return
        }
        await delay(1)
      }
      throw new Error('Timed out waiting for the locked destination write')
    })()

    try {
      const error = (await t.throwsAsync(
        commitFileSystemTransaction(root, writes, []),
      )) as AggregateError
      await watcher

      t.true(watcherFinished)
      t.true(error instanceof AggregateError)
      t.true(error.errors.length >= 2)
      t.regex(error.message, /rollback was incomplete/)
      t.is(await readFile(first, 'utf8'), 'prior first')
      t.is(await readFile(locked, 'utf8'), 'replacement')
      t.is(await readFile(join(root, 'trailing-0.txt'), 'utf8'), 'prior 0')

      const backupRoot = error.message.match(
        /recovery state is preserved at (.+)$/,
      )?.[1]
      t.truthy(backupRoot)
      t.true(existsSync(backupRoot!))
    } finally {
      await Promise.all([
        chmod(lockedDirectory, 0o755),
        chmod(failureDirectory, 0o755),
      ])
    }
  },
)

permissionsTest(
  'filesystem transactions wait for every replacement preparation before cleanup',
  async (t) => {
    const root = join(t.context.tmpDir, 'preparation-cleanup')
    const staging = join(t.context.tmpDir, 'preparation-cleanup-staging')
    const lockedDirectory = join(root, 'locked')
    const source = join(staging, 'replacement.txt')
    const firstDestination = join(root, 'first.txt')
    const blockedDestination = join(lockedDirectory, 'blocked.txt')
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(lockedDirectory, { recursive: true }),
      mkdir(staging, { recursive: true }),
    ])
    await writeFile(source, Buffer.alloc(8 * 1024 * 1024, 0x61))
    await chmod(lockedDirectory, 0o555)

    let preparedPath: string | undefined
    try {
      const failure = t.throwsAsync(
        commitFileSystemTransaction(
          root,
          [
            { source, destination: firstDestination },
            { source, destination: blockedDestination },
          ],
          [],
        ),
      )
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const entry = (await readdir(root)).find(
          (name) =>
            name.startsWith(`.${basename(firstDestination)}.`) &&
            name.endsWith('.0.prepared.tmp'),
        )
        if (entry) {
          preparedPath = join(root, entry)
          break
        }
        await delay(1)
      }
      t.truthy(preparedPath)

      const error = await failure
      t.is((error as NodeJS.ErrnoException).code, 'EACCES')
      t.false(existsSync(preparedPath!))
      t.false(existsSync(join(root, transactionJournalName)))
      t.false(
        (await readdir(root)).some((entry) =>
          entry.startsWith(
            `${basename(transactionJournalName, extname(transactionJournalName))}.candidate.`,
          ),
        ),
      )
    } finally {
      await chmod(lockedDirectory, 0o755)
    }
  },
)

test('filesystem transactions reject distinct case-sensitive hardlink replacements', async (t) => {
  const root = join(t.context.tmpDir, 'hardlink-transaction')
  const staging = join(t.context.tmpDir, 'hardlink-staging')
  const oldName = join(root, 'entry.txt')
  const caseVariant = join(root, 'ENTRY.txt')
  const stagedReplacement = join(staging, 'replacement.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(oldName, 'prior entry'),
    writeFile(stagedReplacement, 'replacement entry'),
  ])
  try {
    await link(oldName, caseVariant)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      t.pass()
      return
    }
    throw error
  }
  if (process.platform !== 'win32') {
    await chmod(oldName, 0o751)
  }

  await t.throwsAsync(
    commitFileSystemTransaction(
      root,
      [
        {
          source: stagedReplacement,
          destination: caseVariant,
          mode: 0o600,
          removeBeforeWrite: oldName,
        },
      ],
      [],
    ),
    { message: /replacement destination is occupied/ },
  )

  t.is(await readFile(oldName, 'utf8'), 'prior entry')
  t.is(await readFile(caseVariant, 'utf8'), 'prior entry')
  if (process.platform !== 'win32') {
    t.is((await stat(oldName)).mode & 0o7777, 0o751)
    t.is((await stat(caseVariant)).mode & 0o7777, 0o751)
  }
})

const macOsNormalizationTest = process.platform === 'darwin' ? test : test.skip

macOsNormalizationTest(
  'filesystem transactions accept macOS normalization aliases for one directory entry',
  async (t) => {
    const root = join(t.context.tmpDir, 'normalization-alias')
    const staging = join(t.context.tmpDir, 'normalization-staging')
    const composed = join(root, '\u00e9.txt')
    const decomposed = join(root, 'e\u0301.txt')
    const replacement = join(staging, 'replacement.txt')
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(staging, { recursive: true }),
    ])
    await Promise.all([
      writeFile(composed, 'prior'),
      writeFile(replacement, 'replacement'),
    ])
    if (!existsSync(decomposed)) {
      t.pass()
      return
    }

    await commitFileSystemTransaction(
      root,
      [
        {
          source: replacement,
          destination: decomposed,
          removeBeforeWrite: composed,
        },
      ],
      [],
    )

    t.is(await readFile(decomposed, 'utf8'), 'replacement')
  },
)

macOsNormalizationTest(
  'filesystem transaction rollback restores macOS normalization aliases',
  async (t) => {
    const root = join(t.context.tmpDir, 'normalization-rollback')
    const staging = join(t.context.tmpDir, 'normalization-rollback-staging')
    const composed = join(root, '\u00e9.txt')
    const decomposed = join(root, 'e\u0301.txt')
    const blocked = join(root, 'blocked.txt')
    const external = join(root, 'external.txt')
    const replacement = join(staging, 'replacement.txt')
    await Promise.all([mkdir(root), mkdir(staging)])
    await Promise.all([
      writeFile(composed, 'prior'),
      writeFile(replacement, 'replacement'),
    ])
    if (!existsSync(decomposed)) {
      t.pass()
      return
    }

    const watcher = (async () => {
      const candidate = await waitForTransactionCandidate(root)
      const backup = join(candidate, 'backups', '0')
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        if (existsSync(backup)) {
          await writeFile(external, 'external successor')
          await rename(external, blocked)
          return
        }
        await delay(1)
      }
      throw new Error('Timed out waiting for normalization rollback backup')
    })()

    await t.throwsAsync(
      commitFileSystemTransaction(
        root,
        [
          {
            source: replacement,
            destination: decomposed,
            removeBeforeWrite: composed,
          },
          { source: replacement, destination: blocked },
        ],
        [],
      ),
    )
    await watcher

    t.is(await readFile(composed, 'utf8'), 'prior')
    t.is(await readFile(decomposed, 'utf8'), 'prior')
    t.is(await readFile(blocked, 'utf8'), 'external successor')
  },
)

test('filesystem transactions reject live symlink replacements before mutation', async (t) => {
  const root = join(t.context.tmpDir, 'live-symlink-transaction')
  const staging = join(t.context.tmpDir, 'live-symlink-staging')
  const existing = join(root, 'existing.txt')
  const target = join(t.context.tmpDir, 'live-target.txt')
  const replacementSource = join(root, 'replacement-source.txt')
  const replacementDestination = join(root, 'replacement-destination.txt')
  const stagedExisting = join(staging, 'existing.txt')
  const stagedReplacement = join(staging, 'replacement.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(existing, 'prior existing'),
    writeFile(target, 'prior target'),
    writeFile(stagedExisting, 'replacement existing'),
    writeFile(stagedReplacement, 'replacement symlink'),
  ])
  await symlink(target, replacementSource, 'file')

  await t.throwsAsync(
    commitFileSystemTransaction(
      root,
      [
        { source: stagedExisting, destination: existing },
        {
          source: stagedReplacement,
          destination: replacementDestination,
          removeBeforeWrite: replacementSource,
        },
      ],
      [],
    ),
    { message: /path is not a regular file/ },
  )

  t.is(await readFile(existing, 'utf8'), 'prior existing')
  t.is(await readFile(target, 'utf8'), 'prior target')
  t.true((await lstat(replacementSource)).isSymbolicLink())
  t.is(await readlink(replacementSource), target)
  t.false(existsSync(replacementDestination))
})

test('filesystem transactions reject dangling symlink removals before mutation', async (t) => {
  const root = join(t.context.tmpDir, 'dangling-symlink-transaction')
  const staging = join(t.context.tmpDir, 'dangling-symlink-staging')
  const existing = join(root, 'existing.txt')
  const danglingTarget = join(root, 'missing.txt')
  const danglingLink = join(root, 'dangling.txt')
  const stagedExisting = join(staging, 'existing.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(existing, 'prior existing'),
    writeFile(stagedExisting, 'replacement existing'),
  ])
  await symlink(danglingTarget, danglingLink, 'file')

  await t.throwsAsync(
    commitFileSystemTransaction(
      root,
      [{ source: stagedExisting, destination: existing }],
      [danglingLink],
    ),
    { message: /path is not a regular file/ },
  )

  t.is(await readFile(existing, 'utf8'), 'prior existing')
  t.true((await lstat(danglingLink)).isSymbolicLink())
  t.is(await readlink(danglingLink), danglingTarget)
  t.false(existsSync(danglingTarget))
})

test('filesystem transactions reject existing destinations through escaping symlink parents', async (t) => {
  const root = join(t.context.tmpDir, 'existing-parent-escape')
  const outside = join(t.context.tmpDir, 'existing-parent-outside')
  const staging = join(t.context.tmpDir, 'existing-parent-staging')
  const existing = join(root, 'existing.txt')
  const outsideDestination = join(outside, 'destination.txt')
  const stagedExisting = join(staging, 'existing.txt')
  const stagedOutside = join(staging, 'outside.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(outside, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(existing, 'prior existing'),
    writeFile(outsideDestination, 'outside sentinel'),
    writeFile(stagedExisting, 'replacement existing'),
    writeFile(stagedOutside, 'outside replacement'),
  ])
  await symlink(
    outside,
    join(root, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  await t.throwsAsync(
    commitFileSystemTransaction(
      root,
      [
        { source: stagedExisting, destination: existing },
        {
          source: stagedOutside,
          destination: join(root, 'escape', 'destination.txt'),
        },
      ],
      [],
    ),
    { message: /path escapes/ },
  )

  t.is(await readFile(existing, 'utf8'), 'prior existing')
  t.is(await readFile(outsideDestination, 'utf8'), 'outside sentinel')
  t.true((await lstat(join(root, 'escape'))).isSymbolicLink())
})

test('filesystem transactions reject missing destinations through escaping symlink parents', async (t) => {
  const root = join(t.context.tmpDir, 'missing-parent-escape')
  const outside = join(t.context.tmpDir, 'missing-parent-outside')
  const staging = join(t.context.tmpDir, 'missing-parent-staging')
  const existing = join(root, 'existing.txt')
  const outsideDestination = join(outside, 'missing.txt')
  const stagedExisting = join(staging, 'existing.txt')
  const stagedOutside = join(staging, 'outside.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(outside, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(existing, 'prior existing'),
    writeFile(stagedExisting, 'replacement existing'),
    writeFile(stagedOutside, 'outside replacement'),
  ])
  await symlink(
    outside,
    join(root, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  await t.throwsAsync(
    commitFileSystemTransaction(
      root,
      [
        { source: stagedExisting, destination: existing },
        {
          source: stagedOutside,
          destination: join(root, 'escape', 'missing.txt'),
        },
      ],
      [],
    ),
    { message: /path escapes/ },
  )

  t.is(await readFile(existing, 'utf8'), 'prior existing')
  t.false(existsSync(outsideDestination))
  t.true((await lstat(join(root, 'escape'))).isSymbolicLink())
})

const parentSwapTest = process.platform === 'win32' ? test.skip : test

parentSwapTest(
  'filesystem transactions fail closed when a destination parent is swapped after preflight',
  async (t) => {
    const root = join(t.context.tmpDir, 'parent-swap-root')
    const staging = join(t.context.tmpDir, 'parent-swap-staging')
    const inside = join(root, 'inside')
    const originalInside = join(root, 'inside-original')
    const outside = join(t.context.tmpDir, 'parent-swap-outside')
    const source = join(staging, 'replacement.txt')
    await Promise.all([
      mkdir(inside, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(staging, { recursive: true }),
    ])
    await writeFile(source, 'replacement')

    const writes = []
    for (let index = 0; index < 100; index += 1) {
      const destination = join(root, `existing-${index}.txt`)
      await writeFile(destination, `prior ${index}`)
      writes.push({ source, destination })
    }
    const escapedDestination = join(inside, 'escaped.txt')
    writes.push({ source, destination: escapedDestination })

    const watcher = (async () => {
      await waitForTransactionCandidateBackup(root)
      await rename(inside, originalInside)
      await symlink(outside, inside, 'dir')
    })()

    const error = (await t.throwsAsync(
      commitFileSystemTransaction(root, writes, []),
    )) as AggregateError
    await watcher

    t.true(error instanceof AggregateError)
    t.regex(error.message, /rollback was incomplete/)
    t.true(
      error.errors.some((cause) =>
        /transaction parent changed/.test(String(cause)),
      ),
    )
    t.false(existsSync(join(outside, 'escaped.txt')))
    t.is(await readFile(join(root, 'existing-0.txt'), 'utf8'), 'prior 0')
    t.true((await lstat(inside)).isSymbolicLink())
  },
)

test('filesystem transactions detect same-path parent directory replacement', async (t) => {
  const root = join(t.context.tmpDir, 'parent-identity-root')
  const staging = join(t.context.tmpDir, 'parent-identity-staging')
  const inside = join(root, 'inside')
  const originalInside = join(root, 'inside-original')
  const attacker = join(root, 'attacker')
  const source = join(staging, 'replacement.txt')
  await Promise.all([
    mkdir(inside, { recursive: true }),
    mkdir(attacker, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await writeFile(source, 'replacement')

  const writes = []
  for (let index = 0; index < 100; index += 1) {
    const destination = join(root, `identity-existing-${index}.txt`)
    await writeFile(destination, `prior ${index}`)
    writes.push({ source, destination })
  }
  const replacedParentDestination = join(inside, 'escaped.txt')
  writes.push({ source, destination: replacedParentDestination })

  const watcher = (async () => {
    await waitForTransactionCandidateBackup(root)
    await rename(inside, originalInside)
    await rename(attacker, inside)
  })()

  const error = (await t.throwsAsync(
    commitFileSystemTransaction(root, writes, []),
  )) as AggregateError
  await watcher

  t.true(error instanceof AggregateError)
  t.regex(error.message, /rollback was incomplete/)
  t.true(
    error.errors.some((cause) =>
      /transaction parent identity changed/.test(String(cause)),
    ),
  )
  t.false(existsSync(replacedParentDestination))
  t.false(existsSync(join(originalInside, 'escaped.txt')))
  t.is(await readFile(join(root, 'identity-existing-0.txt'), 'utf8'), 'prior 0')
})

test('filesystem transactions never recursively remove a swapped directory', async (t) => {
  const root = join(t.context.tmpDir, 'file-swap-root')
  const staging = join(t.context.tmpDir, 'file-swap-staging')
  const source = join(staging, 'replacement.txt')
  const victim = join(root, 'victim.txt')
  const originalVictim = join(root, 'victim-original.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(source, 'replacement'),
    writeFile(victim, 'prior victim'),
  ])

  const writes = [
    {
      source,
      destination: join(root, 'victim-new.txt'),
      removeBeforeWrite: victim,
    },
  ]
  for (let index = 0; index < 100; index += 1) {
    const oldName = join(root, `old-${index}.txt`)
    await writeFile(oldName, `prior ${index}`)
    writes.push({
      source,
      destination: join(root, `new-${index}.txt`),
      removeBeforeWrite: oldName,
    })
  }

  const watcher = (async () => {
    await waitForTransactionCandidateBackup(root)
    await rename(victim, originalVictim)
    await mkdir(victim)
    await writeFile(join(victim, 'sentinel.txt'), 'must survive')
  })()

  await t.throwsAsync(commitFileSystemTransaction(root, writes, []))
  await watcher

  t.is(await readFile(join(victim, 'sentinel.txt'), 'utf8'), 'must survive')
  t.is(await readFile(originalVictim, 'utf8'), 'prior victim')
  t.false(existsSync(join(root, 'victim-new.txt')))
})

test('filesystem transactions apply requested modes to writes and staged renames', async (t) => {
  const root = join(t.context.tmpDir, 'transaction-modes')
  const staging = join(t.context.tmpDir, 'transaction-mode-staging')
  const existing = join(root, 'existing.txt')
  const oldName = join(root, 'old-name.txt')
  const newName = join(root, 'new-name.txt')
  const stagedExisting = join(staging, 'existing.txt')
  const stagedRename = join(staging, 'renamed.txt')
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(staging, { recursive: true }),
  ])
  await Promise.all([
    writeFile(existing, 'prior existing'),
    writeFile(oldName, 'prior renamed file'),
    writeFile(stagedExisting, 'replacement existing'),
    writeFile(stagedRename, 'replacement renamed file'),
  ])

  await commitFileSystemTransaction(
    root,
    [
      { source: stagedExisting, destination: existing, mode: 0o755 },
      {
        source: stagedRename,
        destination: newName,
        mode: 0o751,
        removeBeforeWrite: oldName,
      },
    ],
    [],
  )

  t.is(await readFile(existing, 'utf8'), 'replacement existing')
  t.false(existsSync(oldName))
  t.is(await readFile(newName, 'utf8'), 'replacement renamed file')
  if (process.platform !== 'win32') {
    t.is((await stat(existing)).mode & 0o7777, 0o755)
    t.is((await stat(newName)).mode & 0o7777, 0o751)
  }
})

const windowsModeTest = process.platform === 'win32' ? test : test.skip

windowsModeTest(
  'filesystem transactions honor the Windows owner write-bit mode',
  async (t) => {
    const root = join(t.context.tmpDir, 'windows-mode-root')
    const staging = join(t.context.tmpDir, 'windows-mode-staging')
    const source = join(staging, 'source.txt')
    const destination = join(root, 'destination.txt')
    await Promise.all([mkdir(root), mkdir(staging)])
    await writeFile(source, 'replacement')

    await commitFileSystemTransaction(
      root,
      [{ source, destination, mode: 0o444 }],
      [],
    )
    t.is((await stat(destination)).mode & 0o200, 0)

    await commitFileSystemTransaction(
      root,
      [{ source, destination, mode: 0o644 }],
      [],
    )
    t.is((await stat(destination)).mode & 0o200, 0o200)
  },
)

test('filesystem transactions serialize direct concurrent callers', async (t) => {
  const root = join(t.context.tmpDir, 'concurrent-transaction-root')
  const staging = join(t.context.tmpDir, 'concurrent-transaction-staging')
  const firstSource = join(staging, 'first.txt')
  const secondSource = join(staging, 'second.txt')
  const fileCount = 64
  await Promise.all([mkdir(root), mkdir(staging)])
  await Promise.all([
    writeFile(firstSource, 'first transaction'),
    writeFile(secondSource, 'second transaction'),
  ])
  const writes = (source: string) =>
    Array.from({ length: fileCount }, (_, index) => ({
      source,
      destination: join(root, `${index}.txt`),
    }))

  await Promise.all([
    commitFileSystemTransaction(root, writes(firstSource), []),
    commitFileSystemTransaction(root, writes(secondSource), []),
  ])

  const contents = new Set(
    await Promise.all(
      Array.from({ length: fileCount }, (_, index) =>
        readFile(join(root, `${index}.txt`), 'utf8'),
      ),
    ),
  )
  t.is(contents.size, 1)
  t.true(
    contents.has('first transaction') || contents.has('second transaction'),
  )
  t.false(existsSync(join(root, transactionJournalName)))
})

test('filesystem transactions reuse an exact reconciliation capability', async (t) => {
  const root = join(t.context.tmpDir, 'reentrant-transaction-root')
  const staging = join(t.context.tmpDir, 'reentrant-transaction-staging')
  const source = join(staging, 'source.txt')
  const destination = join(root, 'destination.txt')
  await Promise.all([mkdir(root), mkdir(staging)])
  await writeFile(source, 'committed')

  await withFileSystemReconciliation(root, () =>
    commitFileSystemTransaction(root, [{ source, destination }], []),
  )

  t.is(await readFile(destination, 'utf8'), 'committed')
  t.false(existsSync(join(root, transactionJournalName)))
})

test('filesystem reconciliation serializes operations for one output root', async (t) => {
  const events: string[] = []
  let releaseFirst!: () => void
  let markFirstStarted!: () => void
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve
  })

  const first = withFileSystemReconciliation(t.context.tmpDir, async () => {
    events.push('first:start')
    markFirstStarted()
    await firstBlocked
    events.push('first:end')
  })
  const second = withFileSystemReconciliation(t.context.tmpDir, async () => {
    events.push('second:start')
    events.push('second:end')
  })

  await firstStarted
  t.deepEqual(events, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  t.deepEqual(events, [
    'first:start',
    'first:end',
    'second:start',
    'second:end',
  ])
})

test.serial(
  'filesystem reconciliation stores readable lock state outside the package root',
  async (t) => {
    const root = join(t.context.tmpDir, 'project-lock-state')
    const workerPath = join(t.context.tmpDir, 'lock-state-worker.mjs')
    const resultPath = join(t.context.tmpDir, 'lock-state.json')
    await mkdir(root)
    await writeFile(
      workerPath,
      `import { lstat, readFile, writeFile } from 'node:fs/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

if (process.platform !== 'win32') process.umask(0o077)
const [root, resultPath, lockPath] = process.argv.slice(2)
await withFileSystemReconciliation(root, async () => {
  const lockStats = await lstat(lockPath)
  const owner = JSON.parse(await readFile(lockPath, 'utf8'))
  await writeFile(
    resultPath,
    JSON.stringify({
      kind: owner.kind,
      lockMode: lockStats.mode & 0o7777,
      regularFile: lockStats.isFile(),
    }),
  )
})
`,
    )

    await execFileAsync(
      process.execPath,
      [
        '--import',
        '@oxc-node/core/register',
        workerPath,
        root,
        resultPath,
        reconciliationLockPath(await realpath(root)),
      ],
      { cwd: process.cwd() },
    )

    const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
      kind: string
      lockMode: number
      regularFile: boolean
    }
    t.true(result.regularFile)
    t.is(result.kind, reconciliationLockKind)
    if (process.platform !== 'win32') {
      t.is(result.lockMode, 0o644)
    }
    const key = await realpath(root)
    t.false(existsSync(reconciliationLockPath(key)))
    t.false(existsSync(reconciliationReclaimPath(key)))
  },
)

permissionsTest(
  'filesystem reconciliation supports a writable root with a read-only parent',
  async (t) => {
    const parent = join(t.context.tmpDir, 'read-only-parent')
    const root = join(parent, 'project')
    await mkdir(root, { recursive: true })
    await chmod(root, 0o777)
    await chmod(parent, 0o555)
    try {
      let entered = false
      await withFileSystemReconciliation(root, async () => {
        entered = true
      })
      t.true(entered)
      t.deepEqual(await readdir(root), [])
    } finally {
      await chmod(parent, 0o755)
    }
  },
)

test('filesystem reconciliation metadata is excluded from parent package tarballs', async (t) => {
  const packageRoot = join(t.context.tmpDir, 'package')
  const root = join(packageRoot, 'config')
  await mkdir(root, { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'reconciliation-pack-test', version: '1.0.0' }),
  )
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  const candidatePath = reconciliationCandidatePath(
    lockPath,
    '00000000-0000-4000-8000-000000000011',
  )
  await writeFile(candidatePath, '{')

  let packedFiles: Array<{ path: string }> = []
  await withFileSystemReconciliation(root, async () => {
    const { stdout } = await execFileAsync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: packageRoot },
    )
    packedFiles = (
      JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>
    )[0].files
  })

  t.false(
    packedFiles.some((file) =>
      file.path.includes('napi-rs-filesystem-reconciliation'),
    ),
  )
  t.is(await readFile(candidatePath, 'utf8'), '{')
})

test('filesystem reconciliation rejects a missing reconciliation root', async (t) => {
  const root = join(t.context.tmpDir, 'missing-project-root')
  let entered = false
  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {
      entered = true
    }),
  )
  t.is((error as NodeJS.ErrnoException).code, 'ENOENT')
  t.false(entered)
})

const transactionJournalSymlinkTest =
  process.platform === 'win32' ? test.skip : test

transactionJournalSymlinkTest(
  'filesystem reconciliation does not follow a transaction journal symlink',
  async (t) => {
    const root = join(t.context.tmpDir, 'journal-symlink-root')
    const outside = join(t.context.tmpDir, 'journal-symlink-outside')
    const sentinel = join(outside, 'sentinel.txt')
    await Promise.all([mkdir(root), mkdir(outside)])
    await writeFile(sentinel, 'outside')
    await symlink(
      outside,
      join(root, '.napi-rs-filesystem-transaction.swp'),
      'dir',
    )

    let entered = false
    await t.throwsAsync(
      withFileSystemReconciliation(root, async () => {
        entered = true
      }),
      { message: /recovery state is not a directory/ },
    )

    t.false(entered)
    t.is(await readFile(sentinel, 'utf8'), 'outside')
  },
)

test('filesystem reconciliation rejects oversized transaction recovery state', async (t) => {
  const root = join(t.context.tmpDir, 'oversized-journal-root')
  const journalRoot = join(root, '.napi-rs-filesystem-transaction.swp')
  const token = '00000000-0000-4000-8000-000000000012'
  await mkdir(join(journalRoot, 'backups'), { recursive: true })
  await writeFile(
    join(journalRoot, 'owner.json'),
    JSON.stringify({
      kind: 'napi-rs-filesystem-transaction',
      token,
      version: 1,
    }),
  )
  await writeFile(
    join(journalRoot, 'state.json'),
    Buffer.alloc(16 * 1024 * 1024 + 1, 0x20),
  )

  let entered = false
  await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {
      entered = true
    }),
    { message: /journal exceeds/ },
  )

  t.false(entered)
  t.is((await stat(join(journalRoot, 'state.json'))).size, 16 * 1024 * 1024 + 1)
})

const symlinkLoopTest = process.platform === 'win32' ? test.skip : test

symlinkLoopTest(
  'filesystem reconciliation releases its local queue after acquisition failure',
  async (t) => {
    const loopPath = join(t.context.tmpDir, 'loop')
    await symlink('loop', loopPath, 'dir')

    await t.throwsAsync(withFileSystemReconciliation(loopPath, async () => {}))
    const secondResult = await Promise.race([
      withFileSystemReconciliation(loopPath, async () => {}).then(
        () => 'resolved',
        () => 'rejected',
      ),
      delay(1_000).then(() => 'timed-out'),
    ])

    t.is(secondResult, 'rejected')
  },
)

const darwinExecutionIdentityTest =
  process.platform === 'darwin' ? test : test.skip

darwinExecutionIdentityTest(
  'filesystem reconciliation uses the Darwin boot-session UUID',
  async (t) => {
    const root = join(t.context.tmpDir, 'darwin-execution-identity')
    await mkdir(root)
    const [executionIdentity, bootSession, bootTime, platform] =
      await Promise.all([
        currentProcessExecutionIdentity(root),
        execFileAsync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']),
        execFileAsync('/usr/sbin/sysctl', ['-n', 'kern.boottime']),
        execFileAsync('/usr/sbin/ioreg', [
          '-rd1',
          '-c',
          'IOPlatformExpertDevice',
        ]),
      ])
    const bootSessionUuid = bootSession.stdout.trim().toLowerCase()
    const bootSeconds = bootTime.stdout.match(/\bsec\s*=\s*(\d+)/)?.[1]
    const platformUuid = platform.stdout
      .match(/"IOPlatformUUID"\s*=\s*"([0-9a-f-]+)"/i)?.[1]
      ?.toLowerCase()

    t.regex(bootSessionUuid, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
    t.is(executionIdentity.boot, `darwin-boot:${bootSeconds}`)
    t.is(executionIdentity.bootSession, `darwin-boot:${bootSessionUuid}`)
    t.is(executionIdentity.machine, `darwin-machine:${platformUuid}`)
  },
)

darwinExecutionIdentityTest(
  'filesystem reconciliation accepts the intermediate Darwin UUID-only boot encoding',
  async (t) => {
    const root = join(t.context.tmpDir, 'darwin-uuid-only-owner')
    await mkdir(root)
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const [incarnation, executionIdentity] = await Promise.all([
      currentProcessIncarnation(root),
      currentProcessExecutionIdentity(root),
    ])
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          ...executionIdentity,
          boot: executionIdentity.bootSession!,
          bootSession: undefined,
          incarnation,
        }),
      ),
    )

    let entered = false
    const pending = withFileSystemReconciliation(root, async () => {
      entered = true
    })
    await delay(100)
    t.false(entered)
    await removeReconciliationLockState(key)
    await pending
    t.true(entered)
  },
)

test.serial(
  'filesystem reconciliation does not reclaim a lock owned by a live PID',
  async (t) => {
    t.timeout(5_000)
    const root = join(t.context.tmpDir, 'expired-live-pid')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1_000)
    const [incarnation, executionIdentity] = await Promise.all([
      currentProcessIncarnation(root),
      currentProcessExecutionIdentity(root),
    ])
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          ...executionIdentity,
          createdAt: expiredAt.getTime(),
          incarnation,
        }),
      ),
    )

    let completed = false
    const pending = withFileSystemReconciliation(root, async () => {
      completed = true
    })

    await delay(100)
    t.false(completed)
    await removeReconciliationLockState(key)
    await pending

    t.true(completed)
    t.false(existsSync(lockPath))
    t.deepEqual(await readdir(root), [])
  },
)

test.serial(
  'filesystem reconciliation waits boundedly for a legacy owner without comparable execution identity',
  async (t) => {
    const root = join(t.context.tmpDir, 'bounded-live-pid')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          token: '00000000-0000-4000-8000-000000000007',
        }),
      ),
    )

    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now')
    const initialNow = performance.now()
    let observations = 0
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => {
        observations += 1
        return observations < 6
          ? initialNow
          : initialNow + observations * 10_000
      },
    })
    try {
      const error = await t.throwsAsync(
        withFileSystemReconciliation(root, async () => {}),
        {
          message:
            /cannot be safely reclaimed: the owner predates complete machine, boot-session, and process-namespace identity metadata; it did not release the state within 5000ms.*manually remove/,
        },
      )
      t.is((error as NodeJS.ErrnoException).code, 'ENOTRECOVERABLE')
      t.true(existsSync(lockPath))
    } finally {
      if (originalNow) {
        Object.defineProperty(performance, 'now', originalNow)
      } else {
        Reflect.deleteProperty(performance, 'now')
      }
      await removeReconciliationLockState(key)
    }
  },
)

test.serial(
  'filesystem reconciliation does not reclaim a dead PID from another machine',
  async (t) => {
    const root = join(t.context.tmpDir, 'remote-machine-owner')
    await mkdir(root)
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          ...executionIdentity,
          machine: `${executionIdentity.machine}-remote`,
          pid: 999_999_999,
        }),
      ),
    )

    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now')
    const initialNow = performance.now()
    let observations = 0
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => {
        observations += 1
        return observations < 6
          ? initialNow
          : initialNow + observations * 10_000
      },
    })
    try {
      const error = await t.throwsAsync(
        withFileSystemReconciliation(root, async () => {}),
        {
          message:
            /cannot be safely reclaimed: the owner machine identity .* may be a live owner on a shared volume; it did not release the state within 5000ms.*manually remove/,
        },
      )
      t.is((error as NodeJS.ErrnoException).code, 'ENOTRECOVERABLE')
      t.true(existsSync(lockPath))
    } finally {
      if (originalNow) {
        Object.defineProperty(performance, 'now', originalNow)
      } else {
        Reflect.deleteProperty(performance, 'now')
      }
      await removeReconciliationLockState(key)
    }
  },
)

test.serial(
  'filesystem reconciliation lets an unverifiable remote owner release during the bounded wait',
  async (t) => {
    const root = join(t.context.tmpDir, 'remote-owner-release')
    await mkdir(root)
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          ...executionIdentity,
          machine: `${executionIdentity.machine}-remote`,
          pid: 999_999_999,
        }),
      ),
    )

    let entered = false
    const pending = withFileSystemReconciliation(root, async () => {
      entered = true
    })
    await delay(50)
    t.false(entered)
    await rm(lockPath)
    await pending

    t.true(entered)
  },
)

test.serial(
  'filesystem reconciliation reclaims an owner from a prior boot on the same machine',
  async (t) => {
    const root = join(t.context.tmpDir, 'prior-boot-owner')
    await mkdir(root)
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          ...executionIdentity,
          boot: `${executionIdentity.boot}-prior`,
          bootSession: executionIdentity.bootSession
            ? `${executionIdentity.bootSession}-prior`
            : null,
        }),
      ),
    )

    let entered = false
    await withFileSystemReconciliation(root, async () => {
      entered = true
    })

    t.true(entered)
    t.false(existsSync(lockPath))
  },
)

test.serial(
  'filesystem reconciliation eventually cleans its owner after a blocked release',
  async (t) => {
    t.timeout(15_000)
    const root = join(t.context.tmpDir, 'eventual-owner-cleanup')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const reclaimPath = reconciliationReclaimPath(key)
    const incarnation = await currentProcessIncarnation(root)
    let releaseOperation!: () => void
    let markOperationEntered!: () => void
    const operationBlocked = new Promise<void>((resolve) => {
      releaseOperation = resolve
    })
    const operationEntered = new Promise<void>((resolve) => {
      markOperationEntered = resolve
    })

    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now')
    const initialNow = performance.now()
    let advanceClock = false
    let currentNow = initialNow
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => {
        if (advanceClock) {
          currentNow += 10_000
        }
        return currentNow
      },
    })

    try {
      const pending = withFileSystemReconciliation(root, async () => {
        markOperationEntered()
        await operationBlocked
      })
      await operationEntered
      await installReconciliationReclaimGuard(
        lockPath,
        reclaimPath,
        key,
        incarnation,
      )
      advanceClock = true
      releaseOperation()
      const error = await t.throwsAsync(pending, {
        message:
          /Timed out after 5000ms waiting for filesystem reconciliation lock/,
      })
      t.is((error as NodeJS.ErrnoException).code, 'ETIMEDOUT')
    } finally {
      if (originalNow) {
        Object.defineProperty(performance, 'now', originalNow)
      } else {
        Reflect.deleteProperty(performance, 'now')
      }
    }

    await rm(reclaimPath, { force: true })
    const cleanupDeadline = Date.now() + 5_000
    while (existsSync(lockPath) && Date.now() < cleanupDeadline) {
      await delay(25)
    }
    t.false(existsSync(lockPath))
  },
)

test.serial(
  'filesystem reconciliation reclaims a lock when its live PID has a different incarnation',
  async (t) => {
    t.timeout(10_000)
    const root = join(t.context.tmpDir, 'reused-owner-pid')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const token = '00000000-0000-4000-8000-000000000004'
    const incarnation = await currentProcessIncarnation(root)
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          incarnation: differentProcessIncarnation(incarnation),
          ...executionIdentity,
          token,
        }),
      ),
    )

    let completed = false
    await withFileSystemReconciliation(root, async () => {
      completed = true
    })

    t.true(completed)
    t.false(existsSync(lockPath))
    t.deepEqual(await readdir(root), [])
  },
)

test.serial(
  'filesystem reconciliation removes a reclaim candidate when its live PID has a different incarnation',
  async (t) => {
    t.timeout(10_000)
    const root = join(t.context.tmpDir, 'reused-reclaim-pid')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const incarnation = await currentProcessIncarnation(root)
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          incarnation: null,
          pid: 999_999_999,
          ...executionIdentity,
          token: '00000000-0000-4000-8000-000000000005',
        }),
      ),
    )
    await writeFile(
      reconciliationReclaimPath(key),
      JSON.stringify(
        reconciliationReclaimOwner(key, {
          incarnation: differentProcessIncarnation(incarnation),
          ...executionIdentity,
          token: '00000000-0000-4000-8000-000000000006',
        }),
      ),
    )

    let completed = false
    await withFileSystemReconciliation(root, async () => {
      completed = true
    })

    t.true(completed)
    t.false(existsSync(lockPath))
    t.deepEqual(await readdir(root), [])
  },
)

test.serial(
  'filesystem reconciliation conservatively retains an unknown live-owner incarnation format',
  async (t) => {
    t.timeout(5_000)
    const root = join(t.context.tmpDir, 'future-owner-incarnation')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const incarnation = await currentProcessIncarnation(root)
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          incarnation: `future-v2:${incarnation}`,
          ...executionIdentity,
          token: '00000000-0000-4000-8000-000000000009',
        }),
      ),
    )

    let completed = false
    const pending = withFileSystemReconciliation(root, async () => {
      completed = true
    })
    await delay(100)
    t.false(completed)
    await removeReconciliationLockState(key)
    await pending
    t.true(completed)
  },
)

test.serial(
  'filesystem reconciliation compares only matching live-owner incarnation formats',
  async (t) => {
    t.timeout(5_000)
    const root = join(t.context.tmpDir, 'cross-format-owner-incarnation')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const incarnation = await currentProcessIncarnation(root)
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          incarnation: differentProcessIncarnationFormat(incarnation),
          ...executionIdentity,
          token: '00000000-0000-4000-8000-00000000000a',
        }),
      ),
    )

    let completed = false
    const pending = withFileSystemReconciliation(root, async () => {
      completed = true
    })
    await delay(100)
    t.false(completed)
    await removeReconciliationLockState(key)
    await pending
    t.true(completed)
  },
)

test('filesystem reconciliation preserves malformed canonical lock state', async (t) => {
  const root = join(t.context.tmpDir, 'malformed-owner')
  await mkdir(root, { recursive: true })
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  await writeFile(lockPath, '{')

  let completed = false
  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {
      completed = true
    }),
  )

  t.is((error as NodeJS.ErrnoException).code, 'EEXIST')
  t.false(completed)
  t.is(await readFile(lockPath, 'utf8'), '{')
})

test('filesystem reconciliation rejects oversized canonical lock state', async (t) => {
  const root = join(t.context.tmpDir, 'oversized-owner')
  await mkdir(root, { recursive: true })
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  await writeFile(lockPath, Buffer.alloc(64 * 1024 + 1, 0x20))

  let completed = false
  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {
      completed = true
    }),
  )

  t.is((error as NodeJS.ErrnoException).code, 'EEXIST')
  t.false(completed)
  t.is((await stat(lockPath)).size, 64 * 1024 + 1)
})

test('filesystem reconciliation recovers a complete unpublished lock candidate', async (t) => {
  const root = join(t.context.tmpDir, 'unpublished-lock-candidate')
  await mkdir(root)
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  const token = '00000000-0000-4000-8000-00000000000b'
  const executionIdentity = await currentProcessExecutionIdentity(root)
  const candidatePath = reconciliationCandidatePath(lockPath, token)
  await writeFile(
    candidatePath,
    JSON.stringify(
      reconciliationLockOwner(key, {
        pid: 999_999_999,
        ...executionIdentity,
        token,
      }),
    ),
  )

  await withFileSystemReconciliation(root, async () => {})

  t.false(existsSync(candidatePath))
  t.false(existsSync(lockPath))
  t.deepEqual(await readdir(root), [])
})

test('filesystem reconciliation recovers a published lock candidate after a crash', async (t) => {
  const root = join(t.context.tmpDir, 'published-lock-candidate')
  await mkdir(root)
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  const token = '00000000-0000-4000-8000-00000000000c'
  const executionIdentity = await currentProcessExecutionIdentity(root)
  const candidatePath = reconciliationCandidatePath(lockPath, token)
  await writeFile(
    candidatePath,
    JSON.stringify(
      reconciliationLockOwner(key, {
        pid: 999_999_999,
        ...executionIdentity,
        token,
      }),
    ),
  )
  await link(candidatePath, lockPath)

  await withFileSystemReconciliation(root, async () => {})

  t.false(existsSync(candidatePath))
  t.false(existsSync(lockPath))
  t.deepEqual(await readdir(root), [])
})

test('filesystem reconciliation recovers reclaim publication residues', async (t) => {
  const root = join(t.context.tmpDir, 'reclaim-publication-candidates')
  await mkdir(root)
  const key = await realpath(root)
  const reclaimPath = reconciliationReclaimPath(key)
  const executionIdentity = await currentProcessExecutionIdentity(root)
  const unpublishedToken = '00000000-0000-4000-8000-00000000000f'
  const unpublishedCandidatePath = reconciliationCandidatePath(
    reclaimPath,
    unpublishedToken,
  )
  const publishedToken = '00000000-0000-4000-8000-000000000010'
  const publishedCandidatePath = reconciliationCandidatePath(
    reclaimPath,
    publishedToken,
  )
  await writeFile(
    unpublishedCandidatePath,
    JSON.stringify(
      reconciliationReclaimOwner(key, {
        pid: 999_999_999,
        ...executionIdentity,
        token: unpublishedToken,
      }),
    ),
  )
  await writeFile(
    publishedCandidatePath,
    JSON.stringify(
      reconciliationReclaimOwner(key, {
        pid: 999_999_999,
        ...executionIdentity,
        token: publishedToken,
      }),
    ),
  )
  await link(publishedCandidatePath, reclaimPath)

  await withFileSystemReconciliation(root, async () => {})

  t.false(existsSync(unpublishedCandidatePath))
  t.false(existsSync(publishedCandidatePath))
  t.false(existsSync(reclaimPath))
  t.deepEqual(await readdir(root), [])
})

test('filesystem reconciliation preserves partial publication candidates', async (t) => {
  const root = join(t.context.tmpDir, 'partial-publication-candidates')
  await mkdir(root)
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  const reclaimPath = reconciliationReclaimPath(key)
  const lockCandidatePath = reconciliationCandidatePath(
    lockPath,
    '00000000-0000-4000-8000-00000000000d',
  )
  const reclaimCandidatePath = reconciliationCandidatePath(
    reclaimPath,
    '00000000-0000-4000-8000-00000000000e',
  )
  await writeFile(lockCandidatePath, '{')
  await writeFile(reclaimCandidatePath, 'user reclaim candidate')

  await withFileSystemReconciliation(root, async () => {})

  t.is(await readFile(lockCandidatePath, 'utf8'), '{')
  t.is(await readFile(reclaimCandidatePath, 'utf8'), 'user reclaim candidate')
  t.false(existsSync(lockPath))
  t.false(existsSync(reclaimPath))
})

test.serial(
  'filesystem reconciliation serializes contenders while reclaiming a dead owner',
  async (t) => {
    const contenderCount = process.platform === 'win32' ? 8 : 24
    t.timeout(process.platform === 'win32' ? 120_000 : 30_000)
    const root = join(t.context.tmpDir, 'dead-owner-stress')
    const workerPath = join(t.context.tmpDir, 'dead-owner-worker.mjs')
    const criticalPath = join(t.context.tmpDir, 'dead-owner-critical')
    const overlapPath = join(t.context.tmpDir, 'dead-owner-overlap.log')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const token = '00000000-0000-4000-8000-000000000003'
    const executionIdentity = await currentProcessExecutionIdentity(root)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, {
          pid: 999_999_999,
          ...executionIdentity,
          token,
        }),
      ),
    )
    await writeFile(
      workerPath,
      `import { appendFile, open, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

const [root, criticalPath, overlapPath] = process.argv.slice(2)
await withFileSystemReconciliation(root, async () => {
  let critical
  try {
    critical = await open(criticalPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') {
      await appendFile(overlapPath, 'overlap\\n')
      return
    }
    throw error
  }
  try {
    await delay(40)
  } finally {
    await critical.close()
    await rm(criticalPath, { force: true })
  }
})
`,
    )

    await Promise.all(
      Array.from({ length: contenderCount }, () =>
        execFileAsync(
          process.execPath,
          [
            '--import',
            '@oxc-node/core/register',
            workerPath,
            root,
            criticalPath,
            overlapPath,
          ],
          { cwd: process.cwd() },
        ),
      ),
    )

    t.false(existsSync(overlapPath))
    t.false(existsSync(lockPath))
    t.deepEqual(await readdir(root), [])
  },
)

test.serial(
  'filesystem reconciliation release preserves a replacement lock token',
  async (t) => {
    const root = join(t.context.tmpDir, 'replacement-owner')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const replacementToken = '00000000-0000-4000-8000-000000000002'

    await withFileSystemReconciliation(root, async () => {
      await writeFile(
        lockPath,
        JSON.stringify(
          reconciliationLockOwner(key, { token: replacementToken }),
        ),
      )
    })

    t.true(existsSync(lockPath))
    t.is(JSON.parse(await readFile(lockPath, 'utf8')).token, replacementToken)
    await removeReconciliationLockState(key)
  },
)

test.serial(
  'filesystem reconciliation releases ownership after wall clock rollback',
  async (t) => {
    const root = join(t.context.tmpDir, 'clock-rollback-release')
    await mkdir(root)
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const originalNow = Object.getOwnPropertyDescriptor(Date, 'now')

    try {
      await withFileSystemReconciliation(root, async () => {
        Object.defineProperty(Date, 'now', {
          configurable: true,
          value: () => 1,
        })
      })
    } finally {
      if (originalNow) {
        Object.defineProperty(Date, 'now', originalNow)
      }
    }

    t.false(existsSync(lockPath))
  },
)

test.serial(
  'filesystem reconciliation serializes a replacement root before reporting stale ownership',
  async (t) => {
    const root = join(t.context.tmpDir, 'replace-anchor')
    const movedRoot = join(t.context.tmpDir, 'replace-anchor-original')
    const workerPath = join(t.context.tmpDir, 'replace-anchor-worker.mjs')
    const resultPath = join(t.context.tmpDir, 'replace-anchor-result')
    await mkdir(root)
    await writeFile(
      workerPath,
      `import { writeFile } from 'node:fs/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

const [root, resultPath] = process.argv.slice(2)
await withFileSystemReconciliation(root, async () => {
  await writeFile(resultPath, 'entered')
})
`,
    )

    let contender: Promise<unknown> | undefined
    const error = await t.throwsAsync(
      withFileSystemReconciliation(root, async () => {
        await rename(root, movedRoot)
        await mkdir(root)
        contender = execFileAsync(
          process.execPath,
          ['--import', '@oxc-node/core/register', workerPath, root, resultPath],
          { cwd: process.cwd() },
        )
        await delay(200)
        t.false(existsSync(resultPath))
      }),
    )

    t.is((error as NodeJS.ErrnoException).code, 'ESTALE')
    await contender
    t.is(await readFile(resultPath, 'utf8'), 'entered')
    t.false(existsSync(reconciliationLockPath(root)))
  },
)

const reconciliationLockSymlinkTest =
  process.platform === 'win32' ? test.serial.skip : test.serial

reconciliationLockSymlinkTest(
  'filesystem reconciliation does not follow a replacement anchor symlink',
  async (t) => {
    const root = join(t.context.tmpDir, 'replace-anchor-symlink')
    const movedRoot = join(t.context.tmpDir, 'replace-anchor-symlink-original')
    const replacementRoot = join(
      t.context.tmpDir,
      'replace-anchor-symlink-target',
    )
    await Promise.all([mkdir(root), mkdir(replacementRoot)])

    const error = await t.throwsAsync(
      withFileSystemReconciliation(root, async () => {
        await rename(root, movedRoot)
        await symlink(replacementRoot, root, 'dir')
      }),
    )

    t.is((error as NodeJS.ErrnoException).code, 'ESTALE')
    t.true((await lstat(root)).isSymbolicLink())
    t.false(existsSync(reconciliationLockPath(root)))
    t.false(existsSync(reconciliationLockPath(movedRoot)))
  },
)

reconciliationLockSymlinkTest(
  'filesystem reconciliation serializes a retargeted writable alias',
  async (t) => {
    const firstRoot = join(t.context.tmpDir, 'alias-first-root')
    const secondRoot = join(t.context.tmpDir, 'alias-second-root')
    const aliasRoot = join(t.context.tmpDir, 'writable-alias')
    const workerPath = join(t.context.tmpDir, 'alias-retarget-worker.mjs')
    const resultPath = join(t.context.tmpDir, 'alias-retarget-result')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)])
    await symlink(firstRoot, aliasRoot, 'dir')
    await writeFile(
      workerPath,
      `import { writeFile } from 'node:fs/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

const [root, resultPath] = process.argv.slice(2)
await withFileSystemReconciliation(root, async () => {
  await writeFile(resultPath, 'entered')
})
`,
    )

    let contender: Promise<unknown> | undefined
    const error = await t.throwsAsync(
      withFileSystemReconciliation(aliasRoot, async () => {
        await rm(aliasRoot)
        await symlink(secondRoot, aliasRoot, 'dir')
        contender = execFileAsync(
          process.execPath,
          [
            '--import',
            '@oxc-node/core/register',
            workerPath,
            aliasRoot,
            resultPath,
          ],
          { cwd: process.cwd() },
        )
        await delay(200)
        t.false(existsSync(resultPath))
      }),
    )

    t.is((error as NodeJS.ErrnoException).code, 'ESTALE')
    await contender
    t.is(await readFile(resultPath, 'utf8'), 'entered')
  },
)

reconciliationLockSymlinkTest(
  'filesystem reconciliation does not follow a lock path symlink',
  async (t) => {
    const root = join(t.context.tmpDir, 'lock-symlink-root')
    const target = join(t.context.tmpDir, 'lock-symlink-target')
    await Promise.all([mkdir(root), mkdir(target)])
    const lockPath = reconciliationLockPath(await realpath(root))
    await symlink(target, lockPath, 'dir')

    let entered = false
    const error = await t.throwsAsync(
      withFileSystemReconciliation(root, async () => {
        entered = true
      }),
    )

    t.is((error as NodeJS.ErrnoException).code, 'EEXIST')
    t.false(entered)
    t.true((await lstat(lockPath)).isSymbolicLink())
    t.true((await lstat(target)).isDirectory())
  },
)

test('filesystem reconciliation preserves a colliding lock-state file', async (t) => {
  const root = join(t.context.tmpDir, 'lock-file-collision')
  await mkdir(root)
  const lockPath = reconciliationLockPath(await realpath(root))
  const content = JSON.stringify({ user: 'content' })
  await writeFile(lockPath, content)

  let entered = false
  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {
      entered = true
    }),
  )

  t.is((error as NodeJS.ErrnoException).code, 'EEXIST')
  t.false(entered)
  t.is(await readFile(lockPath, 'utf8'), content)
})

test('filesystem reconciliation preserves a colliding lock-state directory', async (t) => {
  const root = join(t.context.tmpDir, 'lock-directory-collision')
  await mkdir(root)
  const lockPath = reconciliationLockPath(await realpath(root))
  const childPath = join(lockPath, 'user-file')
  await mkdir(lockPath)
  await writeFile(childPath, 'user content')

  let entered = false
  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {
      entered = true
    }),
  )

  t.is((error as NodeJS.ErrnoException).code, 'EEXIST')
  t.false(entered)
  t.is(await readFile(childPath, 'utf8'), 'user content')
})

test('filesystem reconciliation preserves a colliding reclaim-state file', async (t) => {
  const root = join(t.context.tmpDir, 'reclaim-file-collision')
  await mkdir(root)
  const key = await realpath(root)
  const reclaimPath = reconciliationReclaimPath(key)
  const content = JSON.stringify({ user: 'content' })
  await writeFile(reclaimPath, content)

  let entered = false
  const error = await t.throwsAsync(
    withFileSystemReconciliation(root, async () => {
      entered = true
    }),
  )

  t.is((error as NodeJS.ErrnoException).code, 'EEXIST')
  t.false(entered)
  t.is(await readFile(reclaimPath, 'utf8'), content)
  t.false(existsSync(reconciliationLockPath(key)))
})

test('filesystem reconciliation leaves former sibling metadata names untouched', async (t) => {
  const root = join(t.context.tmpDir, 'former-sibling-metadata')
  await mkdir(root)
  const key = await realpath(root)
  const lockPath = reconciliationLockPath(key)
  const formerOwnerPath = `${lockPath}.owner.json`
  const formerLeasePath = `${lockPath}.lease`
  await writeFile(formerOwnerPath, 'user owner content')
  await writeFile(formerLeasePath, 'user lease content')

  await withFileSystemReconciliation(root, async () => {})

  t.is(await readFile(formerOwnerPath, 'utf8'), 'user owner content')
  t.is(await readFile(formerLeasePath, 'utf8'), 'user lease content')
})

test('filesystem reconciliation ignores stale-state residue paths', async (t) => {
  const root = join(t.context.tmpDir, 'stale-state-residue')
  await mkdir(root)
  const key = await realpath(root)
  const staleLockPath = `${reconciliationLockPath(key)}.stale.fixture`
  const staleReclaimPath = `${reconciliationReclaimPath(key)}.stale.fixture`
  const staleLockChild = join(staleLockPath, 'user-file')
  await mkdir(staleLockPath)
  await writeFile(staleLockChild, 'stale lock content')
  await writeFile(staleReclaimPath, 'stale reclaim content')

  await withFileSystemReconciliation(root, async () => {})

  t.is(await readFile(staleLockChild, 'utf8'), 'stale lock content')
  t.is(await readFile(staleReclaimPath, 'utf8'), 'stale reclaim content')
})

test('package reconciliation identity ignores custom output directories', (t) => {
  t.is(
    getPackageReconciliationRoot(
      join(t.context.tmpDir, 'project'),
      join('config', 'package.json'),
    ),
    join(t.context.tmpDir, 'project', 'config'),
  )
})

test.serial(
  'filesystem reconciliation serializes canonical aliases across distinct temporary roots',
  async (t) => {
    const realRoot = join(t.context.tmpDir, 'real-root')
    const aliasRoot = join(t.context.tmpDir, 'alias-root')
    const workerPath = join(t.context.tmpDir, 'worker.mjs')
    const outputRoot = join(realRoot, 'missing-output')
    const criticalPath = join(outputRoot, 'critical')
    const logPath = join(t.context.tmpDir, 'events.log')
    const temporaryRoots = Array.from({ length: 4 }, (_, index) =>
      join(t.context.tmpDir, `worker-tmp-${index}`),
    )
    await mkdir(realRoot, { recursive: true })
    await Promise.all(temporaryRoots.map((root) => mkdir(root)))
    await symlink(realRoot, aliasRoot, 'dir')
    await writeFile(
      workerPath,
      `import { appendFile, mkdir, open, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

const [id, root, outputRoot, criticalPath, logPath] = process.argv.slice(2)
await withFileSystemReconciliation(root, async () => {
  await mkdir(outputRoot, { recursive: true })
  let critical
  try {
    critical = await open(criticalPath, 'wx')
    await appendFile(logPath, id + ':start\\n')
    await delay(75)
    await appendFile(logPath, id + ':end\\n')
  } finally {
    await critical?.close()
    await rm(criticalPath, { force: true })
  }
})
`,
    )

    t.false(existsSync(outputRoot))
    await Promise.all(
      [realRoot, aliasRoot, realRoot, aliasRoot].map((root, index) =>
        execFileAsync(
          process.execPath,
          [
            '--import',
            '@oxc-node/core/register',
            workerPath,
            String(index),
            root,
            outputRoot,
            criticalPath,
            logPath,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              TEMP: temporaryRoots[index],
              TMP: temporaryRoots[index],
              TMPDIR: temporaryRoots[index],
            },
          },
        ),
      ),
    )

    const events = (await readFile(logPath, 'utf8')).trim().split('\n')
    t.is(events.length, 8)
    for (let index = 0; index < events.length; index += 2) {
      const id = events[index].split(':')[0]
      t.deepEqual(events.slice(index, index + 2), [`${id}:start`, `${id}:end`])
    }
    t.true((await lstat(outputRoot)).isDirectory())
    t.false(existsSync(reconciliationLockPath(await realpath(realRoot))))
    for (const temporaryRoot of temporaryRoots) {
      t.deepEqual(await readdir(temporaryRoot), [])
    }
  },
)
