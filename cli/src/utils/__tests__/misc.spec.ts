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
//
// Every mutation below has to be deterministic on the Windows lanes too
// (`.github/workflows/test-release.yaml` runs `yarn test:cli` on both
// `windows-latest` and `windows-11-arm`), which rules out two tempting ones:
//
//   * an identical-mode `chmod` to move `ctime` alone. On Windows that is an
//     attribute no-op and nothing documents it advancing the NTFS ChangeTime
//     that libuv reports as `ctimeNs`.
//   * asserting a full POSIX mode. Node documents that on Windows "only the
//     write permission can be changed, and the distinction among the
//     permissions of group, owner, or others is not implemented", so a mode
//     round-trips as read-only or writable and nothing else.
//
// So timestamp drift is forced with `utimes`, whose `mtime` write is defined on
// every supported platform, and mode drift toggles only the owner write bit and
// asserts against the mode actually observed afterwards.
const snapshotSourceBytes = Buffer.from('snapshot source contents')
const snapshotSourceHash = createHash('sha256')
  .update(snapshotSourceBytes)
  .digest('hex')

/**
 * An in-place rewrite of exactly the same length as {@link snapshotSourceBytes}.
 * Every field the snapshot compares — `dev`, `ino`, `size`, `bytesRead`, `mode`
 * and, once the timestamps are restamped, `mtimeNs` — survives it untouched, so
 * only the content moves. That is the shape a coarse or coalesced filesystem
 * clock hides, and the only thing that can catch it is the hash.
 */
function rewrittenSourceBytes(revision: number) {
  const bytes = Buffer.from(snapshotSourceBytes)
  bytes.writeUInt8(0x30 + (revision % 10), bytes.length - 1)
  return bytes
}

function sourceHashOf(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

// Two of the mutations below have no Windows equivalent — see the comment on
// each test for which Windows behavior rules it out.
const posixTest = process.platform === 'win32' ? test.skip : test

async function writeSnapshotSource(tmpDir: string) {
  const source = join(tmpDir, 'source.node')
  await writeFile(source, snapshotSourceBytes)
  return { destination: join(tmpDir, 'snapshot.input'), source }
}

async function sourceMode(source: string) {
  return Number((await stat(source, { bigint: true })).mode & 0o7777n)
}

/**
 * Move `mtime` to a fixed whole second, so the drift is the same on a
 * filesystem with nanosecond stamps and on one with a coarser clock.
 */
async function restampSource(source: string, second: number) {
  const when = new Date(1_700_000_000_000 + second * 1_000)
  await utimes(source, when, when)
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

// The legitimate FreeBSD case, and the other side of the content-hash rule
// below: a re-stamp that leaves the bytes alone is accepted on the very next
// attempt, because that attempt reproduces the hash of the one before it.
test('snapshot retries a source whose timestamps were re-stamped mid-copy', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const mode = await sourceMode(source)
  const attempts: number[] = []

  const state = await snapshotInput(source, destination, async (attempt) => {
    attempts.push(attempt)
    if (attempt === 1) {
      // Not one byte of content changes: only the inode's timestamps move.
      await restampSource(source, 1)
    }
  })

  t.deepEqual(attempts, [1, 2])
  t.is(state.hash, snapshotSourceHash)
  t.is(state.mode, mode)
  t.deepEqual(await readFile(destination), snapshotSourceBytes)
})

posixTest(
  'snapshot retries a source whose ctime alone was re-stamped mid-copy',
  async (t) => {
    const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
    const mode = await sourceMode(source)
    const attempts: number[] = []

    const state = await snapshotInput(source, destination, async (attempt) => {
      attempts.push(attempt)
      if (attempt === 1) {
        // Re-applying the same mode is the narrowest possible re-stamp: size,
        // mtime and mode all hold still and only ctime moves. This is the
        // FreeBSD symptom in its purest form.
        await chmod(source, mode)
      }
    })

    t.deepEqual(attempts, [1, 2])
    t.is(state.hash, snapshotSourceHash)
    t.is(state.mode, mode)
    t.deepEqual(await readFile(destination), snapshotSourceBytes)
  },
)

test('snapshot retries mtime drift until the source settles', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const attempts: number[] = []

  const state = await snapshotInput(source, destination, async (attempt) => {
    attempts.push(attempt)
    if (attempt < 3) {
      await restampSource(source, attempt)
    }
  })

  // The third attempt is the last the bound allows, and it is clean.
  t.deepEqual(attempts, [1, 2, 3])
  t.is(state.hash, snapshotSourceHash)
  t.deepEqual(await readFile(destination), snapshotSourceBytes)
})

test('snapshot records the settled mode after a mode re-stamp', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  // Start read-only and hand back the write bit mid-copy. That is the only
  // mode transition Windows can represent, and it leaves the file writable so
  // the fixture teardown never meets a read-only inode.
  await chmod(source, 0o444)
  const readOnlyMode = await sourceMode(source)
  const attempts: number[] = []

  const state = await snapshotInput(source, destination, async (attempt) => {
    attempts.push(attempt)
    if (attempt === 1) {
      await chmod(source, 0o644)
    }
  })

  // Assert against the mode the platform actually reports, never a literal:
  // POSIX settles on 0o644 and Windows on 0o666.
  const writableMode = await sourceMode(source)
  t.not(readOnlyMode, writableMode, 'the chmod must produce real mode drift')
  t.deepEqual(attempts, [1, 2])
  t.is(state.mode, writableMode)
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

// Swapping a successor onto a path the snapshot still holds open is POSIX-only:
// Windows refuses to replace a file with a live handle, and the rename itself
// fails before the assertion is reached with
//   EPERM: operation not permitted, rename '...\\successor.node' -> '...\\source.node'
// The size-change test above already covers a hard field on the Windows lanes.
posixTest(
  'snapshot still fails when the path is replaced and names the identity',
  async (t) => {
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
  },
)

test('snapshot gives up after the attempt bound and names the drifted fields', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const attempts: number[] = []

  const error = await t.throwsAsync(
    snapshotInput(source, destination, async (attempt) => {
      attempts.push(attempt)
      // Never settles: every attempt observes a different mtime.
      await restampSource(source, attempt)
    }),
  )

  t.deepEqual(attempts, [1, 2, 3])
  t.true(
    error?.message.startsWith(
      `Filesystem transaction source changed while it was snapshotted: ${source} (`,
    ),
  )
  t.regex(error?.message ?? '', /mtimeNs \d+ -> \d+/)
  t.true(
    error?.message.endsWith('still drifting after 3 snapshot attempts)'),
    error?.message,
  )
  t.false(existsSync(destination))
})

// Codex review of napi-rs/napi-rs#3530: the retry rebases its baseline purely on
// metadata, so a writer rewriting the file in place at the same length inside
// one timestamp tick could hand back a mixed copy that every stat field calls
// settled. Two attempts now have to agree on the hash before one is accepted.
test('snapshot re-copies until two attempts agree on the source content', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const mode = await sourceMode(source)
  const settled = rewrittenSourceBytes(1)
  const attempts: number[] = []

  const state = await snapshotInput(source, destination, async (attempt) => {
    attempts.push(attempt)
    if (attempt === 1) {
      // Same length, different bytes, and the timestamps pinned to a fixed
      // second so the second attempt sees metadata that looks perfectly
      // settled. Only the content betrays the writer.
      await writeFile(source, settled)
      await restampSource(source, 1)
    }
  })

  // The second attempt copies the settled bytes but cannot know they are
  // settled — its hash is the first one that differs. Only the third attempt,
  // which reproduces it, is accepted.
  t.deepEqual(attempts, [1, 2, 3])
  t.is(state.hash, sourceHashOf(settled))
  t.is(state.mode, mode)
  t.deepEqual(await readFile(destination), settled)
})

test('snapshot gives up when the source content never settles and names the hash', async (t) => {
  const { destination, source } = await writeSnapshotSource(t.context.tmpDir)
  const attempts: number[] = []
  const copied: Buffer[] = [snapshotSourceBytes]

  const error = await t.throwsAsync(
    snapshotInput(source, destination, async (attempt) => {
      attempts.push(attempt)
      const next = rewrittenSourceBytes(attempt)
      copied.push(next)
      await writeFile(source, next)
      await restampSource(source, attempt)
    }),
  )

  t.deepEqual(attempts, [1, 2, 3])
  t.true(
    error?.message.startsWith(
      `Filesystem transaction source changed while it was snapshotted: ${source} (`,
    ),
  )
  t.true(
    error?.message.includes(
      `contentHash ${sourceHashOf(copied[1])} -> ${sourceHashOf(copied[2])}`,
    ),
    error?.message,
  )
  t.true(
    error?.message.endsWith('still drifting after 3 snapshot attempts)'),
    error?.message,
  )
  t.false(existsSync(destination))
})
