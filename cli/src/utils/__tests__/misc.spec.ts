import { createHash } from 'node:crypto'
import { existsSync, type BigIntStats } from 'node:fs'
import {
  appendFile,
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import {
  retireFailedSnapshotLeftover,
  snapshotFileSystemTransactionInput,
  snapshotLeftoverIsTransactionOwned,
  statIdentitiesMatch,
  updatePackageJson,
} from '../misc.js'

async function fileIdentityStrings(path: string) {
  const stats = await lstat(path, { bigint: true })
  return { dev: String(stats.dev), ino: String(stats.ino) }
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

  const written = await readFile(packageJsonPath, 'utf8')
  t.true(written.endsWith('\n'))
  t.false(written.endsWith('\n\n'))
})

test('statIdentitiesMatch distinguishes inodes that collide as lossy Numbers', (t) => {
  const dev = 1n
  const ino = 2n ** 53n
  const owned = { dev, ino }
  const successor = { dev, ino: ino + 1n }

  // The defect being guarded against: past Number.MAX_SAFE_INTEGER two
  // distinct 64-bit identifiers collapse onto the same JS double, so a
  // numeric Stats.dev/ino comparison cannot tell these files apart.
  t.is(Number(owned.ino), Number(successor.ino))

  t.false(statIdentitiesMatch(owned, successor))
  t.false(statIdentitiesMatch({ dev: dev + 1n, ino }, owned))
  t.true(statIdentitiesMatch(owned, { dev, ino }))
  t.false(statIdentitiesMatch(owned, undefined))
})

test('snapshotLeftoverIsTransactionOwned rejects Number-colliding successors', (t) => {
  const identity = { dev: '1', ino: String(2n ** 53n) }
  const ownedStats = {
    isFile: () => true,
    dev: 1n,
    ino: 2n ** 53n,
  } as unknown as BigIntStats
  const successorStats = {
    isFile: () => true,
    dev: 1n,
    ino: 2n ** 53n + 1n,
  } as unknown as BigIntStats

  t.true(snapshotLeftoverIsTransactionOwned(ownedStats, identity))
  t.false(snapshotLeftoverIsTransactionOwned(successorStats, identity))
  t.false(snapshotLeftoverIsTransactionOwned(undefined, identity))
})

test('retireFailedSnapshotLeftover removes the transaction-owned inode', async (t) => {
  const destination = join(t.context.tmpDir, 'leftover.tmp')
  await writeFile(destination, 'partial snapshot')
  const identity = await fileIdentityStrings(destination)

  const result = await retireFailedSnapshotLeftover(destination, identity)

  t.deepEqual(result, { outcome: 'removed' })
  t.false(existsSync(destination))
  t.deepEqual(await readdir(t.context.tmpDir), [])
})

test('retireFailedSnapshotLeftover reports a missing leftover', async (t) => {
  const destination = join(t.context.tmpDir, 'leftover.tmp')
  await writeFile(destination, 'partial snapshot')
  const identity = await fileIdentityStrings(destination)
  await rm(destination)

  const result = await retireFailedSnapshotLeftover(destination, identity)

  t.deepEqual(result, { outcome: 'missing' })
  t.deepEqual(await readdir(t.context.tmpDir), [])
})

test('retireFailedSnapshotLeftover keeps a pre-existing non-owned successor', async (t) => {
  const destination = join(t.context.tmpDir, 'leftover.tmp')
  await writeFile(destination, 'partial snapshot')
  const identity = await fileIdentityStrings(destination)

  // Replace the owned inode with a distinct one before cleanup runs. The
  // successor is created as a sibling first so it deterministically has a
  // different inode, then atomically renamed over the destination.
  const successor = join(t.context.tmpDir, 'successor.tmp')
  await writeFile(successor, 'successor content')
  await rename(successor, destination)

  const result = await retireFailedSnapshotLeftover(destination, identity)

  t.deepEqual(result, { outcome: 'kept' })
  t.is(await readFile(destination, 'utf8'), 'successor content')
  t.deepEqual(await readdir(t.context.tmpDir), ['leftover.tmp'])
})

test('retireFailedSnapshotLeftover restores a successor swapped in during the race window', async (t) => {
  const destination = join(t.context.tmpDir, 'leftover.tmp')
  await writeFile(destination, 'partial snapshot')
  const identity = await fileIdentityStrings(destination)

  const successor = join(t.context.tmpDir, 'successor.tmp')
  await writeFile(successor, 'successor content')

  // Swap the successor onto the pathname after the ownership pre-check and
  // before the retirement rename — the exact interval in which the previous
  // lstat-then-unlink cleanup would have deleted a file the transaction never
  // owned.
  const result = await retireFailedSnapshotLeftover(
    destination,
    identity,
    async () => {
      await rename(successor, destination)
    },
  )

  t.deepEqual(result, { outcome: 'kept' })
  t.is(await readFile(destination, 'utf8'), 'successor content')
  t.deepEqual(await readdir(t.context.tmpDir), ['leftover.tmp'])
})

// A snapshot re-verifies its source after the copy so the recorded image is
// provably consistent. The check used to fail the whole transaction on any
// difference, including a metadata-only re-stamp of an inode the cli had just
// written itself — the FreeBSD release-build failure in rolldown/rolldown#10268
// — and its message named none of the eight conditions it stood for.
//
// `onAfterCopy` is the seam these tests drive: it runs after each copy pass and
// before the post-copy stats, so drift is injected deterministically rather than
// by racing a timer against a large copy.
const snapshotSourceBytes = Buffer.from('snapshot source contents')
const snapshotSourceHash = createHash('sha256')
  .update(snapshotSourceBytes)
  .digest('hex')

async function writeSnapshotSource(tmpDir: string) {
  const source = join(tmpDir, 'source.node')
  await writeFile(source, snapshotSourceBytes)
  return { destination: join(tmpDir, 'snapshot.input'), source }
}

function snapshotInput(
  source: string,
  destination: string,
  onAfterCopy: (attempt: number) => Promise<void>,
) {
  return snapshotFileSystemTransactionInput(
    source,
    destination,
    undefined,
    undefined,
    0o600,
    true,
    undefined,
    undefined,
    onAfterCopy,
  )
}

test('snapshot retries a source whose ctime was re-stamped mid-copy', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const mode = Number((await stat(source, { bigint: true })).mode & 0o7777n)
  const attempts: number[] = []

  const state = await snapshotInput(source, destination, async (attempt) => {
    attempts.push(attempt)
    if (attempt === 1) {
      // Same mode, so only ctime moves. Nothing observed this file's content.
      await chmod(source, mode)
    }
  })

  t.deepEqual(attempts, [1, 2])
  t.is(state.hash, snapshotSourceHash)
  t.is(state.mode, mode)
  t.deepEqual(await readFile(destination), snapshotSourceBytes)
})

test('snapshot retries mtime drift until the source settles', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const attempts: number[] = []

  const state = await snapshotInput(source, destination, async (attempt) => {
    attempts.push(attempt)
    if (attempt < 3) {
      await utimes(
        source,
        new Date(1_700_000_000_000 + attempt * 1000),
        new Date(1_700_000_000_000 + attempt * 1000),
      )
    }
  })

  // The third attempt is the last the bound allows, and it is clean.
  t.deepEqual(attempts, [1, 2, 3])
  t.is(state.hash, snapshotSourceHash)
  t.deepEqual(await readFile(destination), snapshotSourceBytes)
})

test('snapshot records the settled mode after a mode re-stamp', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)

  const state = await snapshotInput(source, destination, async (attempt) => {
    if (attempt === 1) {
      await chmod(source, 0o640)
    }
  })

  t.is(state.mode, 0o640)
  t.is(state.hash, snapshotSourceHash)
})

test('snapshot still fails on a size change and names the field', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const attempts: number[] = []

  const error = await t.throwsAsync(
    snapshotInput(source, destination, async (attempt) => {
      attempts.push(attempt)
      if (attempt === 1) {
        await appendFile(source, 'appended')
      }
    }),
  )

  // A hard field is fatal on the first observation: no retry is attempted.
  t.deepEqual(attempts, [1])
  t.true(
    error?.message.startsWith(
      `Filesystem transaction source changed while it was snapshotted: ${source} (`,
    ),
  )
  t.true(
    error?.message.includes(
      `size ${snapshotSourceBytes.length} -> ${snapshotSourceBytes.length + 8}`,
    ),
    error?.message,
  )
  t.true(
    error?.message.includes(
      `bytesRead ${snapshotSourceBytes.length} != size ${snapshotSourceBytes.length + 8}`,
    ),
    error?.message,
  )
  t.false(existsSync(destination))
})

test('snapshot still fails when the path is replaced and names the identity', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const successor = join(t.context.tmpDir, 'successor.node')
  await writeFile(successor, snapshotSourceBytes)
  const before = await lstat(source, { bigint: true })
  const after = await lstat(successor, { bigint: true })

  const error = await t.throwsAsync(
    snapshotInput(source, destination, async (attempt) => {
      if (attempt === 1) {
        await rename(successor, source)
      }
    }),
  )

  t.true(
    error?.message.includes(
      `path identity ${before.dev}/${before.ino} -> ${after.dev}/${after.ino}`,
    ),
    error?.message,
  )
  t.false(existsSync(destination))
})

test('snapshot gives up after the attempt bound and names the drifted fields', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const mode = Number((await stat(source, { bigint: true })).mode & 0o7777n)
  const attempts: number[] = []

  const error = await t.throwsAsync(
    snapshotInput(source, destination, async (attempt) => {
      attempts.push(attempt)
      await chmod(source, mode)
    }),
  )

  t.deepEqual(attempts, [1, 2, 3])
  t.true(
    error?.message.startsWith(
      `Filesystem transaction source changed while it was snapshotted: ${source} (`,
    ),
  )
  t.regex(error?.message ?? '', /ctimeNs \d+ -> \d+/)
  t.true(
    error?.message.endsWith('still drifting after 3 snapshot attempts)'),
    error?.message,
  )
  t.false(existsSync(destination))
})
