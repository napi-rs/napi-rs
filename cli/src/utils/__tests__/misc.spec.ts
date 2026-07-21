import { existsSync, type BigIntStats } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import {
  snapshotLeftoverIsTransactionOwned,
  statIdentitiesMatch,
  updatePackageJson,
} from '../misc.js'

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
