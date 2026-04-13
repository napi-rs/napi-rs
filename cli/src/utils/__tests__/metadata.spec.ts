import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import test from 'ava'

import { parseMetadata } from '../metadata.js'

function createFakeCargoMetadata(manifestPath: string, version: string) {
  return JSON.stringify({
    version: 1,
    packages: [
      {
        id: `test ${version} (path+file://${manifestPath})`,
        name: 'test',
        src_path: join(dirname(manifestPath), 'src', 'lib.rs'),
        version,
        edition: '2021',
        targets: [
          {
            name: 'test',
            kind: ['cdylib'],
            crate_types: ['cdylib'],
          },
        ],
        features: {},
        manifest_path: manifestPath,
        dependencies: [],
      },
    ],
    workspace_members: [`test ${version} (path+file://${manifestPath})`],
    target_directory: join(dirname(manifestPath), 'target'),
    workspace_root: dirname(manifestPath),
  })
}

function createFakeWorkspaceCargoMetadata(
  workspaceManifestPath: string,
  memberManifestPath: string,
  version: string,
) {
  return JSON.stringify({
    version: 1,
    packages: [
      {
        id: `test ${version} (path+file://${memberManifestPath})`,
        name: 'test',
        src_path: join(dirname(memberManifestPath), 'src', 'lib.rs'),
        version,
        edition: '2021',
        targets: [
          {
            name: 'test',
            kind: ['cdylib'],
            crate_types: ['cdylib'],
          },
        ],
        features: {},
        manifest_path: memberManifestPath,
        dependencies: [],
      },
    ],
    workspace_members: [`test ${version} (path+file://${memberManifestPath})`],
    target_directory: join(dirname(workspaceManifestPath), 'target'),
    workspace_root: dirname(workspaceManifestPath),
  })
}

async function setupFakeCargo(binDir: string) {
  const fakeCargoPath = join(binDir, 'fake-cargo.mjs')
  await writeFile(
    fakeCargoPath,
    `import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const countFile = process.env.FAKE_CARGO_COUNT_FILE
if (!countFile) {
  throw new Error('FAKE_CARGO_COUNT_FILE is required')
}

const delayMs = Number(process.env.FAKE_CARGO_DELAY_MS ?? '0')
const currentCount = existsSync(countFile)
  ? Number(readFileSync(countFile, 'utf8'))
  : 0

writeFileSync(countFile, String(currentCount + 1))

if (delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

if (process.env.FAKE_CARGO_STDERR) {
  process.stderr.write(process.env.FAKE_CARGO_STDERR)
}

if (process.env.FAKE_CARGO_JSON) {
  process.stdout.write(process.env.FAKE_CARGO_JSON)
}

process.exit(Number(process.env.FAKE_CARGO_EXIT_CODE ?? '0'))
`,
  )

  if (process.platform === 'win32') {
    await writeFile(
      join(binDir, 'cargo.cmd'),
      '@echo off\r\nnode "%~dp0fake-cargo.mjs" %*\r\n',
    )
  } else {
    const launcherPath = join(binDir, 'cargo')
    await writeFile(
      launcherPath,
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-cargo.mjs" "$@"\n',
    )
    await chmod(launcherPath, 0o755)
  }
}

test.serial('should surface child process startup errors', async (t) => {
  const manifestPath = join(
    tmpdir(),
    `napi-rs-metadata-${process.pid}-${Date.now()}.toml`,
  )
  const originalPath = process.env.PATH

  await writeFile(manifestPath, '[package]\nname = "test"\nversion = "0.0.0"\n')
  process.env.PATH = ''

  try {
    const error = await t.throwsAsync(() => parseMetadata(manifestPath))
    t.truthy(error)
    t.is(error?.message, 'cargo metadata failed to run')
    t.is((error?.cause as NodeJS.ErrnoException | undefined)?.code, 'ENOENT')
  } finally {
    process.env.PATH = originalPath
    await unlink(manifestPath)
  }
})

test.serial('should cache metadata for the same manifest', async (t) => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), `napi-rs-metadata-cache-${process.pid}-`),
  )
  const manifestPath = join(fixtureDir, 'Cargo.toml')
  const countFile = join(fixtureDir, 'cargo-count.txt')
  const originalPath = process.env.PATH
  const originalJson = process.env.FAKE_CARGO_JSON
  const originalCountFile = process.env.FAKE_CARGO_COUNT_FILE
  const originalDelay = process.env.FAKE_CARGO_DELAY_MS

  await setupFakeCargo(fixtureDir)
  await writeFile(manifestPath, '[package]\nname = "test"\nversion = "0.0.0"\n')

  process.env.PATH = [fixtureDir, originalPath].filter(Boolean).join(delimiter)
  process.env.FAKE_CARGO_COUNT_FILE = countFile
  process.env.FAKE_CARGO_DELAY_MS = '0'
  process.env.FAKE_CARGO_JSON = createFakeCargoMetadata(manifestPath, '0.0.0')

  try {
    const firstMetadata = await parseMetadata(manifestPath)
    process.env.FAKE_CARGO_JSON = createFakeCargoMetadata(manifestPath, '9.9.9')
    const secondMetadata = await parseMetadata(manifestPath)

    t.is(firstMetadata.packages[0]?.version, '0.0.0')
    t.is(secondMetadata.packages[0]?.version, '0.0.0')
    t.is(await readFile(countFile, 'utf8'), '1')
  } finally {
    process.env.PATH = originalPath
    restoreEnvVar('FAKE_CARGO_JSON', originalJson)
    restoreEnvVar('FAKE_CARGO_COUNT_FILE', originalCountFile)
    restoreEnvVar('FAKE_CARGO_DELAY_MS', originalDelay)
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

test.serial(
  'should cache metadata for the same workspace manifest',
  async (t) => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), `napi-rs-metadata-workspace-cache-${process.pid}-`),
    )
    const workspaceManifestPath = join(fixtureDir, 'Cargo.toml')
    const memberDir = join(fixtureDir, 'crates', 'test')
    const memberManifestPath = join(memberDir, 'Cargo.toml')
    const countFile = join(fixtureDir, 'cargo-count.txt')
    const originalPath = process.env.PATH
    const originalJson = process.env.FAKE_CARGO_JSON
    const originalCountFile = process.env.FAKE_CARGO_COUNT_FILE
    const originalDelay = process.env.FAKE_CARGO_DELAY_MS

    await setupFakeCargo(fixtureDir)
    await writeFile(
      workspaceManifestPath,
      '[workspace]\nmembers = ["crates/test"]\n',
    )
    await mkdir(memberDir, { recursive: true })
    await writeFile(
      memberManifestPath,
      '[package]\nname = "test"\nversion = "0.0.0"\n',
    )

    process.env.PATH = [fixtureDir, originalPath]
      .filter(Boolean)
      .join(delimiter)
    process.env.FAKE_CARGO_COUNT_FILE = countFile
    process.env.FAKE_CARGO_DELAY_MS = '0'
    process.env.FAKE_CARGO_JSON = createFakeWorkspaceCargoMetadata(
      workspaceManifestPath,
      memberManifestPath,
      '0.0.0',
    )

    try {
      const firstMetadata = await parseMetadata(workspaceManifestPath)
      process.env.FAKE_CARGO_JSON = createFakeWorkspaceCargoMetadata(
        workspaceManifestPath,
        memberManifestPath,
        '9.9.9',
      )
      const secondMetadata = await parseMetadata(workspaceManifestPath)

      t.is(firstMetadata.packages[0]?.version, '0.0.0')
      t.is(secondMetadata.packages[0]?.version, '0.0.0')
      t.is(await readFile(countFile, 'utf8'), '1')
    } finally {
      process.env.PATH = originalPath
      restoreEnvVar('FAKE_CARGO_JSON', originalJson)
      restoreEnvVar('FAKE_CARGO_COUNT_FILE', originalCountFile)
      restoreEnvVar('FAKE_CARGO_DELAY_MS', originalDelay)
      await rm(fixtureDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'should invalidate cached metadata when a tracked manifest changes',
  async (t) => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), `napi-rs-metadata-invalidate-${process.pid}-`),
    )
    const manifestPath = join(fixtureDir, 'Cargo.toml')
    const countFile = join(fixtureDir, 'cargo-count.txt')
    const originalPath = process.env.PATH
    const originalJson = process.env.FAKE_CARGO_JSON
    const originalCountFile = process.env.FAKE_CARGO_COUNT_FILE
    const originalDelay = process.env.FAKE_CARGO_DELAY_MS

    await setupFakeCargo(fixtureDir)
    await writeFile(
      manifestPath,
      '[package]\nname = "test"\nversion = "0.0.0"\n',
    )

    process.env.PATH = [fixtureDir, originalPath]
      .filter(Boolean)
      .join(delimiter)
    process.env.FAKE_CARGO_COUNT_FILE = countFile
    process.env.FAKE_CARGO_DELAY_MS = '0'
    process.env.FAKE_CARGO_JSON = createFakeCargoMetadata(manifestPath, '0.0.0')

    try {
      const firstMetadata = await parseMetadata(manifestPath)
      const originalStats = await stat(manifestPath)

      await writeFile(
        manifestPath,
        '[package]\nname = "test"\nversion = "0.0.1"\n',
      )
      await utimes(manifestPath, originalStats.atime, originalStats.mtime)
      process.env.FAKE_CARGO_JSON = createFakeCargoMetadata(
        manifestPath,
        '0.0.1',
      )

      const secondMetadata = await parseMetadata(manifestPath)

      t.is(firstMetadata.packages[0]?.version, '0.0.0')
      t.is(secondMetadata.packages[0]?.version, '0.0.1')
      t.is(await readFile(countFile, 'utf8'), '2')
    } finally {
      process.env.PATH = originalPath
      restoreEnvVar('FAKE_CARGO_JSON', originalJson)
      restoreEnvVar('FAKE_CARGO_COUNT_FILE', originalCountFile)
      restoreEnvVar('FAKE_CARGO_DELAY_MS', originalDelay)
      await rm(fixtureDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'should share the same in-flight metadata request per manifest',
  async (t) => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), `napi-rs-metadata-inflight-${process.pid}-`),
    )
    const manifestPath = join(fixtureDir, 'Cargo.toml')
    const countFile = join(fixtureDir, 'cargo-count.txt')
    const originalPath = process.env.PATH
    const originalJson = process.env.FAKE_CARGO_JSON
    const originalCountFile = process.env.FAKE_CARGO_COUNT_FILE
    const originalDelay = process.env.FAKE_CARGO_DELAY_MS

    await setupFakeCargo(fixtureDir)
    await writeFile(
      manifestPath,
      '[package]\nname = "test"\nversion = "0.0.0"\n',
    )

    process.env.PATH = [fixtureDir, originalPath]
      .filter(Boolean)
      .join(delimiter)
    process.env.FAKE_CARGO_COUNT_FILE = countFile
    process.env.FAKE_CARGO_DELAY_MS = '100'
    process.env.FAKE_CARGO_JSON = createFakeCargoMetadata(manifestPath, '0.0.0')

    try {
      const [firstMetadata, secondMetadata] = await Promise.all([
        parseMetadata(manifestPath),
        parseMetadata(manifestPath),
      ])

      t.deepEqual(secondMetadata, firstMetadata)
      t.is(await readFile(countFile, 'utf8'), '1')
    } finally {
      process.env.PATH = originalPath
      restoreEnvVar('FAKE_CARGO_JSON', originalJson)
      restoreEnvVar('FAKE_CARGO_COUNT_FILE', originalCountFile)
      restoreEnvVar('FAKE_CARGO_DELAY_MS', originalDelay)
      await rm(fixtureDir, { recursive: true, force: true })
    }
  },
)

test.serial(
  'should not cache metadata when the manifest changes during load',
  async (t) => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), `napi-rs-metadata-racy-cache-${process.pid}-`),
    )
    const manifestPath = join(fixtureDir, 'Cargo.toml')
    const countFile = join(fixtureDir, 'cargo-count.txt')
    const originalPath = process.env.PATH
    const originalJson = process.env.FAKE_CARGO_JSON
    const originalCountFile = process.env.FAKE_CARGO_COUNT_FILE
    const originalDelay = process.env.FAKE_CARGO_DELAY_MS

    await setupFakeCargo(fixtureDir)
    await writeFile(
      manifestPath,
      '[package]\nname = "test"\nversion = "0.0.0"\n',
    )

    process.env.PATH = [fixtureDir, originalPath]
      .filter(Boolean)
      .join(delimiter)
    process.env.FAKE_CARGO_COUNT_FILE = countFile
    process.env.FAKE_CARGO_DELAY_MS = '100'
    process.env.FAKE_CARGO_JSON = createFakeCargoMetadata(manifestPath, '0.0.0')

    try {
      const firstMetadataPromise = parseMetadata(manifestPath)

      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(
        manifestPath,
        '[package]\nname = "test"\nversion = "0.0.1"\n',
      )

      const firstMetadata = await firstMetadataPromise
      process.env.FAKE_CARGO_DELAY_MS = '0'
      process.env.FAKE_CARGO_JSON = createFakeCargoMetadata(
        manifestPath,
        '0.0.1',
      )

      const secondMetadata = await parseMetadata(manifestPath)

      t.is(firstMetadata.packages[0]?.version, '0.0.0')
      t.is(secondMetadata.packages[0]?.version, '0.0.1')
      t.is(await readFile(countFile, 'utf8'), '2')
    } finally {
      process.env.PATH = originalPath
      restoreEnvVar('FAKE_CARGO_JSON', originalJson)
      restoreEnvVar('FAKE_CARGO_COUNT_FILE', originalCountFile)
      restoreEnvVar('FAKE_CARGO_DELAY_MS', originalDelay)
      await rm(fixtureDir, { recursive: true, force: true })
    }
  },
)

function restoreEnvVar(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
