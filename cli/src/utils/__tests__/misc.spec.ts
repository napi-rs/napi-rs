import { existsSync, type BigIntStats } from 'node:fs'
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import {
  retireFailedSnapshotLeftover,
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
