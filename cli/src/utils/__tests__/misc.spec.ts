import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
