import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const cliDir = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const reconciliationLockName = '.napi-rs-filesystem-reconciliation'
const reconciliationReclaimMarker = '.reclaim.'
const reconciliationMetadataExtension = '.swp'
const transactionJournalName = '.napi-rs-filesystem-transaction.swp'
// Windows lock acquisition runs external identity probes before mutation.
// Loaded CI runners can legitimately exceed the generic 10-second budget.
const rawCliRenameTimeout = process.platform === 'win32' ? 60_000 : 10_000

function resolveNpmCliFrom(directory) {
  for (const candidate of [
    join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    if (existsSync(candidate)) {
      return realpathSync(candidate)
    }
  }
}

function resolveNpmCli() {
  const bundledNpmCli = resolveNpmCliFrom(dirname(process.execPath))
  if (bundledNpmCli) {
    return bundledNpmCli
  }

  const npmLauncher = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    if (!pathEntry) {
      continue
    }

    const launcherPath = join(pathEntry, npmLauncher)
    if (!existsSync(launcherPath)) {
      continue
    }

    const resolvedLauncherPath = realpathSync(launcherPath)
    if (resolvedLauncherPath.endsWith('npm-cli.js')) {
      return resolvedLauncherPath
    }

    const npmCli =
      resolveNpmCliFrom(dirname(resolvedLauncherPath)) ??
      resolveNpmCliFrom(dirname(launcherPath))
    if (npmCli) {
      return npmCli
    }
  }

  throw new Error(`Could not resolve ${npmLauncher} from PATH`)
}

async function runNpm(args, cwd) {
  return execFileAsync(process.execPath, [resolveNpmCli(), ...args], {
    cwd,
  })
}

function reconciliationMetadataPrefix(key, reclaim = false) {
  return `${reconciliationLockName}${
    reclaim ? reconciliationReclaimMarker : '.'
  }${createHash('sha256').update(key).digest('hex')}`
}

async function createRawCliReconciliationProbe(projectDir) {
  const canonicalProjectDir = realpathSync.native(projectDir)
  const projectStats = await stat(canonicalProjectDir)
  const lockRoots = [
    canonicalProjectDir,
    realpathSync.native(dirname(canonicalProjectDir)),
  ]
  // Reconciliation guards both the path spelling and the directory object.
  const keys = [canonicalProjectDir, `inode:${projectStats.ino}`]
  const metadataPrefixes = keys.flatMap((key) => [
    reconciliationMetadataPrefix(key),
    reconciliationMetadataPrefix(key, true),
  ])
  const activeMetadataNames = new Set(
    metadataPrefixes.map(
      (prefix) => `${prefix}${reconciliationMetadataExtension}`,
    ),
  )
  return {
    activeMetadataNames,
    canonicalProjectDir,
    lockRoots,
    metadataPrefixes,
  }
}

function isTransactionResidue(name) {
  const journalExtension = extname(transactionJournalName)
  const journalBase = basename(transactionJournalName, journalExtension)
  return (
    name === transactionJournalName ||
    name.startsWith(`${journalBase}.candidate.`) ||
    name.startsWith(`${journalBase}.retired.`) ||
    /^\..+\.[0-9a-f-]{36}\.\d+\.(?:prepared|retired|rollback)\.tmp$/i.test(name)
  )
}

async function inspectRawCliReconciliationState(probe) {
  const activeReconciliationPaths = []
  const deferredReconciliationPaths = []
  const transactionPaths = []

  for (const root of new Set(probe.lockRoots)) {
    let entries
    try {
      entries = await readdir(root)
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    for (const entry of entries) {
      if (!probe.metadataPrefixes.some((prefix) => entry.startsWith(prefix))) {
        continue
      }
      const path = join(root, entry)
      if (probe.activeMetadataNames.has(entry)) {
        activeReconciliationPaths.push(path)
      } else {
        deferredReconciliationPaths.push(path)
      }
    }
  }

  try {
    for (const entry of await readdir(probe.canonicalProjectDir)) {
      if (isTransactionResidue(entry)) {
        transactionPaths.push(join(probe.canonicalProjectDir, entry))
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  let packageName
  try {
    packageName = JSON.parse(
      await readFile(join(probe.canonicalProjectDir, 'package.json'), 'utf8'),
    ).napi?.packageName
  } catch {}

  return {
    activeReconciliationPaths: activeReconciliationPaths.sort(),
    deferredReconciliationPaths: deferredReconciliationPaths.sort(),
    packageName,
    transactionPaths: transactionPaths.sort(),
  }
}

async function runRawCliRename(rawCliPath, projectDir, probe) {
  const expectedPackageName = '@scope/raw-cli-renamed'
  const startedAt = Date.now()
  try {
    await execFileAsync(
      process.execPath,
      [
        rawCliPath,
        'rename',
        '--cwd',
        projectDir,
        '--package-name',
        expectedPackageName,
      ],
      {
        cwd: repositoryRoot,
        timeout: rawCliRenameTimeout,
      },
    )
  } catch (error) {
    const state = await inspectRawCliReconciliationState(probe)
    const elapsed = Date.now() - startedAt
    const completed = state.packageName === expectedPackageName
    const timedOut = error.killed === true && error.signal !== null
    const failure = error instanceof Error ? error.message : String(error)
    const phase = completed
      ? 'the manifest committed before the child failed to exit'
      : state.activeReconciliationPaths.length > 0
        ? 'the child stopped with active reconciliation state before commit'
        : 'the child stopped before the rename commit'
    throw new Error(
      `Packed raw CLI rename ${timedOut ? 'timed out' : 'failed'} after ${elapsed}ms: ${phase}; state=${JSON.stringify(
        state,
      )}; failure=${JSON.stringify(failure)}`,
      { cause: error },
    )
  }

  const state = await inspectRawCliReconciliationState(probe)
  assert.deepEqual(
    state.activeReconciliationPaths,
    [],
    `raw CLI rename left active reconciliation metadata: ${JSON.stringify(state)}`,
  )
  assert.deepEqual(
    state.transactionPaths,
    [],
    `raw CLI rename left transaction state: ${JSON.stringify(state)}`,
  )
}

export async function runPackedRawCliTest() {
  const testDir = await mkdtemp(join(tmpdir(), 'napi packed raw cli '))
  const packDir = join(testDir, 'packed artifact')
  const installDir = join(testDir, 'installed project')
  const projectDir = await mkdtemp(join(tmpdir(), 'napi raw cli '))
  const reconciliationProbe = await createRawCliReconciliationProbe(projectDir)
  const outputDir = join(projectDir, 'output artifacts')
  const npmDir = join(projectDir, 'npm packages')

  try {
    await Promise.all([
      mkdir(packDir),
      mkdir(installDir),
      mkdir(outputDir),
      mkdir(npmDir),
    ])
    await Promise.all([
      writeFile(
        join(installDir, 'package.json'),
        JSON.stringify({
          name: 'packed-raw-cli-test',
          private: true,
        }),
      ),
      writeFile(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'raw-cli-space-test',
          version: '1.0.0',
          napi: {
            binaryName: 'raw_cli_space_test',
            targets: [],
          },
        }),
      ),
    ])

    const { stdout } = await runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir],
      cliDir,
    )
    const packResult = JSON.parse(stdout)
    const tarballPath = join(packDir, packResult[0].filename)

    await runNpm(
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--omit=dev',
        tarballPath,
      ],
      installDir,
    )

    const rawCliPath = join(
      installDir,
      'node_modules',
      '@napi-rs',
      'cli',
      'cli.mjs',
    )
    await execFileAsync(
      process.execPath,
      [
        rawCliPath,
        'artifacts',
        '--cwd',
        projectDir,
        '--output-dir',
        outputDir,
        '--npm-dir',
        npmDir,
      ],
      {
        cwd: repositoryRoot,
      },
    )

    assert.ok(existsSync(outputDir))
    assert.ok(existsSync(npmDir))

    await runRawCliRename(rawCliPath, projectDir, reconciliationProbe)
    const renamedManifest = JSON.parse(
      await readFile(join(projectDir, 'package.json'), 'utf8'),
    )
    assert.equal(renamedManifest.napi.binaryName, 'raw_cli_space_test')
    assert.equal(renamedManifest.napi.packageName, '@scope/raw-cli-renamed')
  } finally {
    let reconciliationPaths = []
    try {
      const reconciliationState =
        await inspectRawCliReconciliationState(reconciliationProbe)
      reconciliationPaths = [
        ...reconciliationState.activeReconciliationPaths,
        ...reconciliationState.deferredReconciliationPaths,
        ...reconciliationState.transactionPaths,
      ]
    } finally {
      try {
        await Promise.all(
          reconciliationPaths.map((path) =>
            rm(path, { force: true, recursive: true }),
          ),
        )
      } finally {
        await Promise.all([
          rm(testDir, { force: true, recursive: true }),
          rm(projectDir, { force: true, recursive: true }),
        ])
      }
    }
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  await runPackedRawCliTest()
  process.stdout.write(`packed raw CLI passed on ${process.version}\n`)
}
