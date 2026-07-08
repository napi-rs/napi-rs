import { execFile } from 'node:child_process'
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
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const reconciliationLockRoot = join(
  tmpdir(),
  'napi-rs-filesystem-reconciliation',
)

function reconciliationLockPath(key: string) {
  return join(
    reconciliationLockRoot,
    createHash('sha256').update(key).digest('hex'),
  )
}

const test = ava as TestFn<{
  tmpDir: string
}>

test.beforeEach(async (t) => {
  t.context = {
    tmpDir: await mkdtemp(join(tmpdir(), 'napi-rs-misc-spec-')),
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

const permissionsTest = process.platform === 'win32' ? test.skip : test

permissionsTest(
  'filesystem transactions continue rollback and preserve backups after a restoration failure',
  async (t) => {
    const root = join(t.context.tmpDir, 'incomplete-rollback')
    const staging = join(t.context.tmpDir, 'incomplete-rollback-staging')
    const lockedDirectory = join(root, 'locked')
    const first = join(root, 'first.txt')
    const locked = join(lockedDirectory, 'locked.txt')
    const stagedReplacement = join(staging, 'replacement.txt')
    await Promise.all([
      mkdir(lockedDirectory, { recursive: true }),
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
      source: join(staging, 'missing.txt'),
      destination: join(root, 'failure.txt'),
    })

    let watcherFinished = false
    const watcher = (async () => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if ((await readFile(locked, 'utf8')) === 'replacement') {
          await chmod(lockedDirectory, 0o555)
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
        /backups are preserved at (.+)$/,
      )?.[1]
      t.truthy(backupRoot)
      t.true(existsSync(backupRoot!))
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
        const backupRoot = (await readdir(root)).find((entry) =>
          entry.startsWith('.napi-transaction-backup.'),
        )
        if (backupRoot) {
          await rename(inside, originalInside)
          await symlink(outside, inside, 'dir')
          return
        }
        await delay(1)
      }
      throw new Error('Timed out waiting for transaction backup creation')
    })()

    await t.throwsAsync(commitFileSystemTransaction(root, writes, []), {
      message: /transaction parent changed/,
    })
    await watcher

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
      const backupRoot = (await readdir(root)).find((entry) =>
        entry.startsWith('.napi-transaction-backup.'),
      )
      if (backupRoot) {
        await rename(inside, originalInside)
        await rename(attacker, inside)
        return
      }
      await delay(1)
    }
    throw new Error('Timed out waiting for transaction backup creation')
  })()

  await t.throwsAsync(commitFileSystemTransaction(root, writes, []), {
    message: /transaction parent identity changed/,
  })
  await watcher

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
      const backupRoot = (await readdir(root)).find((entry) =>
        entry.startsWith('.napi-transaction-backup.'),
      )
      if (backupRoot && existsSync(join(root, backupRoot, 'victim.txt'))) {
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
  'filesystem reconciliation does not reclaim an expired lease owned by a live PID',
  async (t) => {
    t.timeout(5_000)
    const root = join(t.context.tmpDir, 'expired-live-pid')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const ownerPath = join(lockPath, 'owner.json')
    const token = '00000000-0000-4000-8000-000000000001'
    const leasePath = join(lockPath, `${token}.lease`)
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1_000)
    await mkdir(lockPath, { recursive: true })
    await writeFile(
      ownerPath,
      JSON.stringify({
        createdAt: expiredAt.getTime(),
        key,
        pid: process.pid,
        token,
      }),
    )
    await writeFile(leasePath, String(expiredAt.getTime()))
    await utimes(leasePath, expiredAt, expiredAt)

    let completed = false
    const pending = withFileSystemReconciliation(root, async () => {
      completed = true
    })

    await delay(100)
    t.false(completed)
    await rm(lockPath, { force: true, recursive: true })
    await pending

    t.true(completed)
    t.false(existsSync(lockPath))
  },
)

test.serial(
  'filesystem reconciliation gives fresh malformed owner data an acquisition grace period',
  async (t) => {
    t.timeout(5_000)
    const root = join(t.context.tmpDir, 'malformed-owner-grace')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    await mkdir(lockPath, { recursive: true })
    await writeFile(join(lockPath, 'owner.json'), '{')

    let completed = false
    const pending = withFileSystemReconciliation(root, async () => {
      completed = true
    })

    await delay(100)
    t.false(completed)
    await rm(lockPath, { force: true, recursive: true })
    await pending

    t.true(completed)
  },
)

test.serial(
  'filesystem reconciliation serializes contenders while reclaiming a dead owner',
  async (t) => {
    t.timeout(30_000)
    const root = join(t.context.tmpDir, 'dead-owner-stress')
    const workerPath = join(t.context.tmpDir, 'dead-owner-worker.mjs')
    const criticalPath = join(t.context.tmpDir, 'dead-owner-critical')
    const overlapPath = join(t.context.tmpDir, 'dead-owner-overlap.log')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const token = '00000000-0000-4000-8000-000000000003'
    await mkdir(lockPath, { recursive: true })
    await writeFile(
      join(lockPath, 'owner.json'),
      JSON.stringify({
        createdAt: Date.now(),
        key,
        pid: 999_999_999,
        token,
      }),
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
      Array.from({ length: 24 }, () =>
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
  },
)

test.serial(
  'filesystem reconciliation release preserves a replacement lock token',
  async (t) => {
    const root = join(t.context.tmpDir, 'replacement-owner')
    await mkdir(root, { recursive: true })
    const key = await realpath(root)
    const lockPath = reconciliationLockPath(key)
    const ownerPath = join(lockPath, 'owner.json')
    const replacementToken = '00000000-0000-4000-8000-000000000002'
    const replacementLeasePath = join(lockPath, `${replacementToken}.lease`)

    await withFileSystemReconciliation(root, async () => {
      await writeFile(
        ownerPath,
        JSON.stringify({
          createdAt: Date.now(),
          key,
          pid: process.pid,
          token: replacementToken,
        }),
      )
      await writeFile(replacementLeasePath, String(Date.now()))
    })

    t.true(existsSync(lockPath))
    t.is(JSON.parse(await readFile(ownerPath, 'utf8')).token, replacementToken)
    await rm(lockPath, { force: true, recursive: true })
  },
)

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
  'filesystem reconciliation serializes separate processes through canonical aliases',
  async (t) => {
    const realRoot = join(t.context.tmpDir, 'real-root')
    const aliasRoot = join(t.context.tmpDir, 'alias-root')
    const workerPath = join(t.context.tmpDir, 'worker.mjs')
    const criticalPath = join(t.context.tmpDir, 'critical')
    const logPath = join(t.context.tmpDir, 'events.log')
    await mkdir(realRoot, { recursive: true })
    await symlink(realRoot, aliasRoot, 'dir')
    await writeFile(
      workerPath,
      `import { appendFile, open, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileSystemReconciliation } from ${JSON.stringify(
        new URL('../misc.ts', import.meta.url).href,
      )}

const [id, root, criticalPath, logPath] = process.argv.slice(2)
await withFileSystemReconciliation(root, async () => {
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
            criticalPath,
            logPath,
          ],
          { cwd: process.cwd() },
        ),
      ),
    )

    const events = (await readFile(logPath, 'utf8')).trim().split('\n')
    t.is(events.length, 8)
    for (let index = 0; index < events.length; index += 2) {
      const id = events[index].split(':')[0]
      t.deepEqual(events.slice(index, index + 2), [`${id}:start`, `${id}:end`])
    }
  },
)
