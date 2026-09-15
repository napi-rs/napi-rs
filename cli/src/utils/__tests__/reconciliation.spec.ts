import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

import ava, { type TestFn } from 'ava'

import {
  type ProcessExecutionIdentity,
  resolveProcessExecutionIdentityForLocking,
  withFileSystemReconciliation,
} from '../misc.js'

const test = ava as TestFn<{
  tmpDir: string
}>

test.beforeEach(async (t) => {
  t.context = {
    tmpDir: await mkdtemp(join(tmpdir(), 'napi-rs-reconciliation-spec-')),
  }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

const completeIdentity: ProcessExecutionIdentity = {
  boot: 'test-boot:1',
  bootSession: null,
  machine: 'test-machine:1',
  namespace: 'test-ns',
}

const incompleteIdentity: ProcessExecutionIdentity = {
  boot: null,
  bootSession: null,
  machine: null,
  namespace: null,
}

async function collectFileNames(root: string): Promise<string[]> {
  const names: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name))
      } else {
        names.push(entry.name)
      }
    }
  }
  await walk(root)
  return names
}

// Lock file paths relative to root, using '/' separators so dirname() reads
// naturally ('real/<name>' vs '<name>' at the root). Symlinked directories
// are not traversed.
async function collectReconciliationLocks(root: string): Promise<string[]> {
  const lockName = /^\.napi-rs-filesystem-reconciliation\.[0-9a-f]{64}\.swp$/
  const locks: string[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), `${prefix}${entry.name}/`)
      } else if (lockName.test(entry.name)) {
        locks.push(`${prefix}${entry.name}`)
      }
    }
  }
  await walk(root, '')
  return locks.sort()
}

test('resolveProcessExecutionIdentityForLocking returns complete on the first read', async (t) => {
  let reads = 0
  const resolution = await resolveProcessExecutionIdentityForLocking(
    async () => {
      reads += 1
      return completeIdentity
    },
    { expiresAt: performance.now() + 150, timeout: 150 },
  )

  t.true(resolution.complete)
  t.is(resolution.identity, completeIdentity)
  t.is(reads, 1)
})

test('resolveProcessExecutionIdentityForLocking re-probes until the identity is complete', async (t) => {
  let reads = 0
  const resolution = await resolveProcessExecutionIdentityForLocking(
    async () => {
      reads += 1
      return reads < 3 ? incompleteIdentity : completeIdentity
    },
    { expiresAt: performance.now() + 150, timeout: 150 },
  )

  t.true(resolution.complete)
  t.is(resolution.identity, completeIdentity)
  t.is(reads, 3)
})

test('resolveProcessExecutionIdentityForLocking resolves incomplete past the wait budget instead of throwing', async (t) => {
  let reads = 0
  const resolution = await resolveProcessExecutionIdentityForLocking(
    async () => {
      reads += 1
      return incompleteIdentity
    },
    { expiresAt: performance.now() + 150, timeout: 150 },
  )

  t.false(resolution.complete)
  t.deepEqual(resolution.identity, incompleteIdentity)
  t.true(reads > 1)
})

test('#3512: degraded acquisition never publishes an unverifiable owner and still runs', async (t) => {
  const anchor = join(t.context.tmpDir, 'pkg')
  await mkdir(anchor)

  let operationRan = false
  const result = await withFileSystemReconciliation(
    anchor,
    async () => {
      operationRan = true
      return 'operation-sentinel'
    },
    {
      getProcessExecutionIdentity: async () => incompleteIdentity,
      identityWaitTimeout: 150,
      lockAcquisitionTimeout: 2_000,
    },
  )

  // Hosts that cannot provide identity (FreeBSD, containers without
  // /etc/machine-id, policy-blocked Windows tools) must keep building.
  t.true(operationRan)
  t.is(result, 'operation-sentinel')

  // Nothing unverifiable may ever reach disk: no lock, reclaim, retired, or
  // candidate state may be left behind by the degraded acquisition.
  const names = await collectFileNames(t.context.tmpDir)
  t.deepEqual(
    names.filter((name) =>
      /^\.napi-rs-filesystem-reconciliation.*\.swp$/.test(name),
    ),
    [],
  )
  t.deepEqual(
    names.filter((name) => name.includes('.candidate.')),
    [],
  )
})

test('withFileSystemReconciliation retries identity probes until complete, then runs the operation', async (t) => {
  const anchor = join(t.context.tmpDir, 'pkg')
  await mkdir(anchor)

  let reads = 0
  const result = await withFileSystemReconciliation(
    anchor,
    async () => 'operation-sentinel',
    {
      getProcessExecutionIdentity: async () => {
        reads += 1
        return reads < 3 ? incompleteIdentity : completeIdentity
      },
      lockAcquisitionTimeout: 10_000,
    },
  )

  t.is(result, 'operation-sentinel')
  // The resolver re-probes twice before the complete read; each acquired lock
  // identity (guard + inode object) resolves separately, so the exact count
  // depends on how many lock identities the anchor resolves to.
  t.true(reads >= 3)
  const names = await collectFileNames(t.context.tmpDir)
  t.deepEqual(
    names.filter((name) => name.endsWith('.swp')),
    [],
  )
})

test('withFileSystemReconciliation serializes concurrent operations on the same anchor', async (t) => {
  const anchor = join(t.context.tmpDir, 'pkg')
  await mkdir(anchor)

  const markers: string[] = []
  const getProcessExecutionIdentity = async () => completeIdentity
  const [first, second] = await Promise.all([
    withFileSystemReconciliation(
      anchor,
      async () => {
        markers.push('a:start')
        await delay(50)
        markers.push('a:end')
        return 'a'
      },
      {
        getProcessExecutionIdentity,
        lockAcquisitionTimeout: 10_000,
      },
    ),
    withFileSystemReconciliation(
      anchor,
      async () => {
        markers.push('b:start')
        markers.push('b:end')
        return 'b'
      },
      {
        getProcessExecutionIdentity,
        lockAcquisitionTimeout: 10_000,
      },
    ),
  ])

  t.is(first, 'a')
  t.is(second, 'b')
  t.deepEqual(markers, ['a:start', 'a:end', 'b:start', 'b:end'])
})

test('degraded acquisition respects an existing lock it cannot evaluate', async (t) => {
  const anchor = join(t.context.tmpDir, 'pkg')
  await mkdir(anchor)

  const lockNamePattern =
    /^\.napi-rs-filesystem-reconciliation\.[0-9a-f]{64}\.swp$/

  // Phase 1: record the lock owner files a complete acquisition publishes.
  const recorded: Array<{ name: string; content: string }> = []
  await withFileSystemReconciliation(
    anchor,
    async () => {
      for (const name of await readdir(t.context.tmpDir)) {
        if (lockNamePattern.test(name)) {
          recorded.push({
            name,
            content: await readFile(join(t.context.tmpDir, name), 'utf8'),
          })
        }
      }
    },
    {
      getProcessExecutionIdentity: async () => completeIdentity,
      lockAcquisitionTimeout: 10_000,
    },
  )
  t.true(recorded.length > 0)

  // Recreate the recorded owners as legacy unverifiable owners: identity
  // fields nulled, PID left pointing at this live process.
  const crafted = new Map<string, string>()
  for (const { name, content } of recorded) {
    const owner = JSON.parse(content)
    owner.machine = null
    owner.boot = null
    owner.namespace = null
    const serialized = JSON.stringify(owner)
    crafted.set(name, serialized)
    await writeFile(join(t.context.tmpDir, name), serialized)
  }

  // Phase 2: degraded acquisition must refuse to bypass the existing locks.
  let operationRan = false
  const error = await t.throwsAsync(
    withFileSystemReconciliation(
      anchor,
      async () => {
        operationRan = true
      },
      {
        getProcessExecutionIdentity: async () => incompleteIdentity,
        identityWaitTimeout: 150,
        lockAcquisitionTimeout: 600,
      },
    ),
  )

  t.false(operationRan)
  t.true(
    error.message.includes(
      'did not provide a complete machine, boot-session, and process-namespace identity',
    ),
  )
  t.false(error.message.includes('Timed out after'))
  t.false(error.message.includes('cannot be safely reclaimed'))

  // The unverifiable owners were never touched, bypassed, or reclaimed.
  for (const [name, serialized] of crafted) {
    t.is(await readFile(join(t.context.tmpDir, name), 'utf8'), serialized)
  }
})

test('degraded acquisition heals when identity probes recover and reclaims a stale lock', async (t) => {
  const anchor = join(t.context.tmpDir, 'pkg')
  await mkdir(anchor)

  const lockNamePattern =
    /^\.napi-rs-filesystem-reconciliation\.[0-9a-f]{64}\.swp$/

  // Phase 1 records owners written with the DEFAULT getter: processOwnerState
  // evaluates staleness against the module-level singleton (the real host
  // identity), never an injected fixture, so only a real-identity owner can
  // become provably stale on this host.
  const recorded: Array<{ name: string; content: string }> = []
  await withFileSystemReconciliation(anchor, async () => {
    for (const name of await readdir(t.context.tmpDir)) {
      if (lockNamePattern.test(name)) {
        recorded.push({
          name,
          content: await readFile(join(t.context.tmpDir, name), 'utf8'),
        })
      }
    }
  })
  t.true(recorded.length > 0)

  const deadPid = await new Promise<number>((resolvePid, rejectPid) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    child.once('error', rejectPid)
    child.once('exit', () => resolvePid(child.pid as number))
  })

  // Rewrite each owner with a guaranteed-dead PID: same real host identity,
  // so the dead-PID check in processOwnerState proves staleness before any
  // incarnation comparison.
  for (const { name, content } of recorded) {
    const owner = JSON.parse(content)
    owner.pid = deadPid
    owner.incarnation = null
    await writeFile(join(t.context.tmpDir, name), JSON.stringify(owner))
  }

  // Phase 2: probes fail past the identity wait budget (forcing the degraded
  // path), then recover; the degraded loop must re-read, heal, and reclaim.
  let reads = 0
  const result = await withFileSystemReconciliation(
    anchor,
    async () => 'healed-sentinel',
    {
      getProcessExecutionIdentity: async () => {
        reads += 1
        return reads <= 12 ? incompleteIdentity : completeIdentity
      },
      identityWaitTimeout: 150,
      lockAcquisitionTimeout: 10_000,
    },
  )

  t.is(result, 'healed-sentinel')
  t.true(reads > 4)
  const names = await collectFileNames(t.context.tmpDir)
  t.deepEqual(
    names.filter((name) => name.endsWith('.swp')),
    [],
  )
  t.deepEqual(
    names.filter(
      (name) => name.includes('.candidate.') || name.includes('.reclaim.'),
    ),
    [],
  )
})

test('degraded acquisition skips transaction journal recovery; locked acquisition recovers', async (t) => {
  const anchor = join(t.context.tmpDir, 'pkg')
  await mkdir(anchor)

  // Minimal valid v3 journal. readFileSystemTransactionOwnerAt requires an
  // object with kind 'napi-rs-filesystem-transaction', version 1|2|3 and a
  // UUID token; normalizeFileSystemTransactionJournal requires the same
  // version, phase 'prepared', the same token, and an entries array whose
  // length stays within the maximum — an empty array skips all per-entry
  // validation.
  const journalRoot = join(anchor, '.napi-rs-filesystem-transaction.swp')
  await mkdir(journalRoot)
  const token = randomUUID()
  const ownerJson = JSON.stringify({
    kind: 'napi-rs-filesystem-transaction',
    version: 3,
    token,
  })
  const stateJson = JSON.stringify({
    version: 3,
    phase: 'prepared',
    token,
    entries: [],
  })
  await writeFile(join(journalRoot, 'owner.json'), ownerJson)
  await writeFile(join(journalRoot, 'state.json'), stateJson)

  // Degraded run: recovery assumes cross-process exclusivity, so it must be
  // skipped entirely — the journal survives byte-identical.
  const result = await withFileSystemReconciliation(
    anchor,
    async () => 'degraded-sentinel',
    {
      getProcessExecutionIdentity: async () => incompleteIdentity,
      identityWaitTimeout: 150,
      lockAcquisitionTimeout: 2_000,
    },
  )
  t.is(result, 'degraded-sentinel')
  t.true(existsSync(journalRoot))
  t.is(await readFile(join(journalRoot, 'owner.json'), 'utf8'), ownerJson)
  t.is(await readFile(join(journalRoot, 'state.json'), 'utf8'), stateJson)

  // Locked run: the same journal is recovered and removed.
  const locked = await withFileSystemReconciliation(
    anchor,
    async () => 'locked-sentinel',
    {
      getProcessExecutionIdentity: async () => completeIdentity,
      lockAcquisitionTimeout: 10_000,
    },
  )
  t.is(locked, 'locked-sentinel')
  t.false(existsSync(journalRoot))
})

test('#3444: symlink guard whose lock would escape the anchor parent is skipped', async (t) => {
  const realDir = join(t.context.tmpDir, 'real')
  await mkdir(join(realDir, 'pkg'), { recursive: true })
  await symlink('real', join(t.context.tmpDir, 'link'), 'dir')

  let locksDuringOp: string[] = []
  const result = await withFileSystemReconciliation(
    join(t.context.tmpDir, 'link', 'pkg'),
    async () => {
      locksDuringOp = await collectReconciliationLocks(t.context.tmpDir)
      return 'sentinel'
    },
    {
      getProcessExecutionIdentity: async () => completeIdentity,
      lockAcquisitionTimeout: 10_000,
    },
  )

  t.is(result, 'sentinel')
  // The guard for tmpDir/link would land its lock in realpath(tmpDir), above
  // the canonical anchor's parent (tmpDir/real), so it is skipped: only the
  // canonical anchor guard and the object lock remain, both inside real/.
  t.is(locksDuringOp.length, 2)
  t.true(locksDuringOp.every((lock) => dirname(lock) === 'real'))
  t.false(locksDuringOp.some((lock) => dirname(lock) === '.'))
  t.deepEqual(await collectReconciliationLocks(t.context.tmpDir), [])
})

test('#3444: symlink guard whose lock stays within the anchor parent is kept', async (t) => {
  const realDir = join(t.context.tmpDir, 'real')
  await mkdir(join(realDir, 'pkg'), { recursive: true })
  await symlink('pkg', join(realDir, 'pkglink'), 'dir')

  let locksDuringOp: string[] = []
  const result = await withFileSystemReconciliation(
    join(realDir, 'pkglink'),
    async () => {
      locksDuringOp = await collectReconciliationLocks(t.context.tmpDir)
      return 'sentinel'
    },
    {
      getProcessExecutionIdentity: async () => completeIdentity,
      lockAcquisitionTimeout: 10_000,
    },
  )

  t.is(result, 'sentinel')
  // Anchor guard + object lock + the pkglink spelling guard, whose lock root
  // is tmpDir/real itself (within-or-equal the anchor's parent).
  t.is(locksDuringOp.length, 3)
  t.true(locksDuringOp.every((lock) => dirname(lock) === 'real'))
  t.deepEqual(await collectReconciliationLocks(t.context.tmpDir), [])
})

test('#3444: plain anchor keeps exactly the guard and object locks', async (t) => {
  await mkdir(join(t.context.tmpDir, 'pkg'))

  let locksDuringOp: string[] = []
  const result = await withFileSystemReconciliation(
    join(t.context.tmpDir, 'pkg'),
    async () => {
      locksDuringOp = await collectReconciliationLocks(t.context.tmpDir)
      return 'sentinel'
    },
    {
      getProcessExecutionIdentity: async () => completeIdentity,
      lockAcquisitionTimeout: 10_000,
    },
  )

  t.is(result, 'sentinel')
  t.is(locksDuringOp.length, 2)
  t.true(locksDuringOp.every((lock) => dirname(lock) === '.'))
  t.deepEqual(await collectReconciliationLocks(t.context.tmpDir), [])
})

test('#3444: nested symlink guard lands at the fully-canonical walk-time root', async (t) => {
  await mkdir(join(t.context.tmpDir, 'real', 'sub', 'pkg'), {
    recursive: true,
  })
  await symlink('real', join(t.context.tmpDir, 'outer'), 'dir')
  await symlink('pkg', join(t.context.tmpDir, 'real', 'sub', 'pkglink'), 'dir')

  let locksDuringOp: string[] = []
  const result = await withFileSystemReconciliation(
    join(t.context.tmpDir, 'outer', 'sub', 'pkglink'),
    async () => {
      locksDuringOp = await collectReconciliationLocks(t.context.tmpDir)
      return 'sentinel'
    },
    {
      getProcessExecutionIdentity: async () => completeIdentity,
      lockAcquisitionTimeout: 10_000,
    },
  )

  t.is(result, 'sentinel')
  // Anchor guard + object lock + the pkglink spelling guard. The guard's
  // dirname (tmpDir/outer/sub) itself goes through a symlink, so its lock
  // must land at the walk-time canonical root realpath(.../real/sub); the
  // tmpDir/outer guard escapes the anchor's parent and is skipped.
  t.is(locksDuringOp.length, 3)
  t.true(locksDuringOp.every((lock) => dirname(lock) === 'real/sub'))
  t.deepEqual(await collectReconciliationLocks(t.context.tmpDir), [])
})
