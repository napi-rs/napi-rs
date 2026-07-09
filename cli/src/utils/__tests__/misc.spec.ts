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

function transactionOwner(token: string) {
  return {
    kind: 'napi-rs-filesystem-transaction',
    token,
    version: 1,
  }
}

async function removeReconciliationLockState(key: string) {
  await Promise.all([
    rm(reconciliationLockPath(key), { force: true, recursive: true }),
    rm(reconciliationReclaimPath(key), { force: true, recursive: true }),
  ])
}

function reconciliationLockOwner(
  key: string,
  overrides: Partial<{
    boot: string | null
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
      machine: owner.machine,
      namespace: owner.namespace,
    }
  })
  if (
    typeof identity?.boot !== 'string' ||
    typeof identity.machine !== 'string' ||
    typeof identity.namespace !== 'string'
  ) {
    throw new Error(
      `Process execution identity is unavailable on ${process.platform}: ${JSON.stringify(identity)}`,
    )
  }
  return identity as {
    boot: string
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
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (!existsSync(lockPath)) {
      await delay(0)
      continue
    }
    try {
      await writeFile(
        reclaimPath,
        JSON.stringify(reconciliationReclaimOwner(key, { incarnation })),
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
    t.timeout(30_000)
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
      `import { join } from 'node:path'
import { commitFileSystemTransaction } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

const [root, source, count] = process.argv.slice(2)
await commitFileSystemTransaction(
  root,
  Array.from({ length: Number(count) }, (_, index) => ({
    source,
    destination: join(root, \`\${index}.txt\`),
  })),
  [],
)
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
    const childClosed = new Promise<void>((resolveClosed, rejectClosed) => {
      child.once('error', rejectClosed)
      child.once('close', () => resolveClosed())
    })
    const deadline = Date.now() + 20_000
    let killed = false
    while (Date.now() < deadline && child.exitCode === null) {
      if (
        (await readFile(join(root, '0.txt'), 'utf8')) === 'replacement' &&
        (await readFile(join(root, `${fileCount - 1}.txt`), 'utf8')) ===
          `prior ${fileCount - 1}`
      ) {
        killed = child.kill('SIGKILL')
        break
      }
      await delay(2)
    }
    if (!killed && child.exitCode === null) {
      child.kill('SIGKILL')
    }
    await childClosed
    t.true(killed)

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
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if ((await readFile(locked, 'utf8')) === 'replacement') {
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
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (
          existsSync(
            join(root, '.napi-rs-filesystem-transaction.swp', 'backups', '0'),
          )
        ) {
          await rename(inside, originalInside)
          await symlink(outside, inside, 'dir')
          return
        }
        await delay(1)
      }
      throw new Error('Timed out waiting for transaction backup creation')
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
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (
        existsSync(
          join(root, '.napi-rs-filesystem-transaction.swp', 'backups', '0'),
        )
      ) {
        await rename(inside, originalInside)
        await rename(attacker, inside)
        return
      }
      await delay(1)
    }
    throw new Error('Timed out waiting for transaction backup creation')
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
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (
        existsSync(
          join(root, '.napi-rs-filesystem-transaction.swp', 'backups', '0'),
        )
      ) {
        await rename(victim, originalVictim)
        await mkdir(victim)
        await writeFile(join(victim, 'sentinel.txt'), 'must survive')
        return
      }
      await delay(1)
    }
    throw new Error('Timed out waiting for the victim backup')
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

test.serial(
  'filesystem reconciliation does not reclaim a lock owned by a live PID',
  async (t) => {
    t.timeout(5_000)
    const root = join(t.context.tmpDir, 'expired-live-pid')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1_000)
    await writeFile(
      lockPath,
      JSON.stringify(
        reconciliationLockOwner(key, { createdAt: expiredAt.getTime() }),
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
  'filesystem reconciliation bounds acquisition when a live legacy owner cannot be reclaimed',
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
        return observations < 3 ? initialNow : initialNow + 1_000_000
      },
    })
    try {
      const error = await t.throwsAsync(
        withFileSystemReconciliation(root, async () => {}),
        {
          message:
            /Timed out after \d+ms waiting for filesystem reconciliation lock/,
        },
      )
      t.is((error as NodeJS.ErrnoException).code, 'ETIMEDOUT')
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
        return observations < 3 ? initialNow : initialNow + 1_000_000
      },
    })
    try {
      const error = await t.throwsAsync(
        withFileSystemReconciliation(root, async () => {}),
      )
      t.is((error as NodeJS.ErrnoException).code, 'ETIMEDOUT')
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
