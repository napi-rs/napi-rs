#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..')

export const COORDINATED_CRATES = Object.freeze([
  Object.freeze({
    name: 'napi',
    manifest: 'crates/napi/Cargo.toml',
    expectedMajor: 4,
    baselineVersion: '3.10.3',
    releaseConfig: '.github/release-plz-napi.toml',
  }),
  Object.freeze({
    name: 'napi-derive-backend',
    manifest: 'crates/backend/Cargo.toml',
    expectedMajor: 6,
    baselineVersion: '5.1.1',
    releaseConfig: '.github/release-plz-backend.toml',
  }),
  Object.freeze({
    name: 'napi-derive',
    manifest: 'crates/macro/Cargo.toml',
    expectedMajor: 4,
    baselineVersion: '3.5.9',
    releaseConfig: '.github/release-plz-derive.toml',
  }),
])

export const PUBLICATION_CRATES = Object.freeze([
  Object.freeze({
    name: 'napi-build',
    manifest: 'crates/build/Cargo.toml',
    releaseConfig: '.github/release-plz-build.toml',
  }),
  Object.freeze({
    name: 'napi-sys',
    manifest: 'crates/sys/Cargo.toml',
    releaseConfig: '.github/release-plz-sys.toml',
  }),
  ...COORDINATED_CRATES,
])

const RELEASE_CONFIG = resolve(REPO_ROOT, 'release-plz.toml')
const REMAINING_RELEASE_CONFIG = resolve(
  REPO_ROOT,
  '.github/release-plz-remaining.toml',
)
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_WAIT_INTERVAL_MS = 5 * 1000
const USER_AGENT = 'napi-rs-release-coordinator'

function fail(message) {
  throw new Error(message)
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (!match) {
    fail(`Invalid Cargo package version: ${version}`)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function loadCargoMetadata(repoRoot = REPO_ROOT) {
  const output = execFileSync(
    'cargo',
    ['metadata', '--no-deps', '--format-version', '1'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )
  return JSON.parse(output)
}

export function validateReleaseMetadata(metadata, repoRoot = REPO_ROOT) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.name, pkg]))
  const resolved = PUBLICATION_CRATES.map((expected) => {
    const pkg = packages.get(expected.name)
    if (!pkg) {
      fail(`Cargo metadata is missing release crate ${expected.name}`)
    }

    const expectedManifest = resolve(repoRoot, expected.manifest)
    if (resolve(pkg.manifest_path) !== expectedManifest) {
      fail(
        `${expected.name} manifest mismatch: expected ${expectedManifest}, got ${pkg.manifest_path}`,
      )
    }

    const version = parseVersion(pkg.version)
    if (
      expected.expectedMajor !== undefined &&
      version.major !== expected.expectedMajor
    ) {
      fail(
        `${expected.name} must remain on major ${expected.expectedMajor}, got ${pkg.version}`,
      )
    }

    return { ...expected, version: pkg.version, metadata: pkg }
  })

  const resolvedByName = new Map(resolved.map((pkg) => [pkg.name, pkg]))
  const runtime = resolvedByName.get('napi')
  for (const prerequisiteName of ['napi-build', 'napi-sys']) {
    const prerequisite = resolvedByName.get(prerequisiteName)
    const dependency = runtime.metadata.dependencies.find(
      (candidate) =>
        candidate.name === prerequisite.name &&
        candidate.path &&
        resolve(candidate.path) ===
          dirname(prerequisite.metadata.manifest_path),
    )
    if (!dependency) {
      fail(`napi must retain its path dependency on ${prerequisite.name}`)
    }
  }

  const backend = resolvedByName.get('napi-derive-backend')
  const derive = resolvedByName.get('napi-derive')
  const backendDependency = derive.metadata.dependencies.find(
    (dependency) =>
      dependency.name === backend.name &&
      dependency.path &&
      resolve(dependency.path) === dirname(backend.metadata.manifest_path),
  )
  if (!backendDependency) {
    fail('napi-derive must retain its path dependency on napi-derive-backend')
  }
  if (backendDependency.req !== '^6.0.0') {
    fail(
      `napi-derive must require napi-derive-backend ^6.0.0, got ${backendDependency.req}`,
    )
  }

  return resolved
}

export function assertCleanCheckout(repoRoot = REPO_ROOT) {
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  ).trim()
  if (status) {
    fail(`Release checkout is not clean:\n${status}`)
  }
}

export function sparseIndexPath(crateName) {
  const name = crateName.toLowerCase()
  if (name.length === 1) return `1/${name}`
  if (name.length === 2) return `2/${name}`
  if (name.length === 3) return `3/${name[0]}/${name}`
  return `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`
}

export function sparseIndexContains(body, crateName, version) {
  return body
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      const entry = JSON.parse(line)
      return entry.name === crateName && entry.vers === version && !entry.yanked
    })
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    return null
  }
  return response.text()
}

export async function isRegistryVisible(
  crateName,
  version,
  fetchImpl = globalThis.fetch,
) {
  const apiUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}/${encodeURIComponent(version)}`
  const indexUrl = `https://index.crates.io/${sparseIndexPath(crateName)}`
  const [apiBody, indexBody] = await Promise.all([
    fetchText(apiUrl, fetchImpl),
    fetchText(indexUrl, fetchImpl),
  ])
  if (!apiBody || !indexBody) {
    return false
  }

  const api = JSON.parse(apiBody)
  const apiVersion = api.version?.num ?? api.crate?.newest_version
  return (
    apiVersion === version && sparseIndexContains(indexBody, crateName, version)
  )
}

export async function waitForRegistry(
  pkg,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    intervalMs = DEFAULT_WAIT_INTERVAL_MS,
    sleep = (delay) =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, delay)),
  } = {},
) {
  const deadline = Date.now() + timeoutMs
  let attempts = 0
  while (Date.now() <= deadline) {
    attempts += 1
    try {
      if (await isRegistryVisible(pkg.name, pkg.version, fetchImpl)) {
        console.log(
          `${pkg.name} ${pkg.version} is visible in the crates.io API and sparse index`,
        )
        return
      }
    } catch (error) {
      console.log(
        `Registry visibility check ${attempts} for ${pkg.name} ${pkg.version} failed: ${error.message}`,
      )
    }
    await sleep(intervalMs)
  }
  fail(
    `Timed out waiting for ${pkg.name} ${pkg.version} to become registry-visible`,
  )
}

function runReleasePlz(args) {
  if (process.env.GITHUB_REPOSITORY) {
    args.push(
      '--repo-url',
      `https://github.com/${process.env.GITHUB_REPOSITORY}`,
    )
  }
  const result = spawnSync('release-plz', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.error) {
    fail(`Failed to start release-plz: ${result.error.message}`)
  }
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    fail(`release-plz ${args.join(' ')} failed with exit code ${result.status}`)
  }

  const output = result.stdout.trim()
  if (!output) {
    fail(`release-plz ${args.join(' ')} returned no JSON output`)
  }
  const parsed = JSON.parse(output)
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`)
  return parsed.releases ?? []
}

function releasePackage(pkg) {
  const releases = runReleasePlz([
    'release',
    '--config',
    resolve(REPO_ROOT, pkg.releaseConfig),
    '--manifest-path',
    resolve(REPO_ROOT, 'Cargo.toml'),
    '--forge',
    'github',
    '-o',
    'json',
  ])
  if (releases.length > 1) {
    fail(`Expected at most one release for ${pkg.name}, got ${releases.length}`)
  }
  if (
    releases.length === 1 &&
    (releases[0].package_name !== pkg.name ||
      releases[0].version !== pkg.version)
  ) {
    fail(
      `Unexpected release-plz result for ${pkg.name}: ${JSON.stringify(releases[0])}`,
    )
  }
  return releases
}

function releaseRemainingPackages() {
  return runReleasePlz([
    'release',
    '--config',
    REMAINING_RELEASE_CONFIG,
    '--forge',
    'github',
    '-o',
    'json',
  ])
}

export async function executePublicationPlan(
  packages,
  {
    release = releasePackage,
    visible = (pkg) => isRegistryVisible(pkg.name, pkg.version),
    wait = waitForRegistry,
    releaseRemaining = releaseRemainingPackages,
  } = {},
) {
  let publishedInThisRun = false
  for (const pkg of packages) {
    const releases = await release(pkg)
    const alreadyVisible = await visible(pkg)

    if (releases.length === 0 && !alreadyVisible) {
      if (!publishedInThisRun) {
        console.log(
          `${pkg.name} ${pkg.version} is not release-eligible; skipping publication`,
        )
        return { published: false }
      }
      fail(
        `${pkg.name} ${pkg.version} was not published after publication began`,
      )
    }

    publishedInThisRun ||= releases.length > 0
    if (!alreadyVisible) {
      await wait(pkg)
    }
  }

  await releaseRemaining()
  return { published: true }
}

function runSemverCommand(args, { expectMajorFailure = false } = {}) {
  const result = spawnSync(
    'cargo',
    ['semver-checks', 'check-release', ...args],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  process.stdout.write(output)

  if (expectMajorFailure) {
    if (result.status === 0) {
      fail('cargo-semver-checks unexpectedly accepted a non-major napi release')
    }
    if (!output.includes('semver requires new major version')) {
      fail(
        'cargo-semver-checks failed without confirming that napi requires a major release',
      )
    }
    return
  }

  if (result.status !== 0) {
    fail(`cargo-semver-checks failed with exit code ${result.status}`)
  }
}

export function checkSemver() {
  const runtime = COORDINATED_CRATES[0]
  runSemverCommand(
    [
      '--manifest-path',
      runtime.manifest,
      '--baseline-version',
      runtime.baselineVersion,
      '--default-features',
      '--release-type',
      'minor',
      '--color',
      'never',
    ],
    { expectMajorFailure: true },
  )
  runSemverCommand([
    '--manifest-path',
    runtime.manifest,
    '--baseline-version',
    runtime.baselineVersion,
    '--default-features',
    '--color',
    'never',
  ])

  const backend = COORDINATED_CRATES[1]
  runSemverCommand([
    '--manifest-path',
    backend.manifest,
    '--baseline-version',
    backend.baselineVersion,
    '--all-features',
    '--color',
    'never',
  ])
}

function configWorkspace(contents) {
  return contents.split(/^\[\[package\]\]\s*$/m, 1)[0]
}

function configPackages(contents) {
  return contents
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map((block) => {
      const name = /^\s*name\s*=\s*"([^"]+)"\s*$/m.exec(block)?.[1]
      const release = /^\s*release\s*=\s*(true|false)\s*$/m.exec(block)?.[1]
      if (!name || !release) {
        fail(`Invalid release-plz package block:\n${block.trim()}`)
      }
      return { name, release: release === 'true' }
    })
}

function assertWorkspaceSetting(contents, setting, expected, configPath) {
  const workspace = configWorkspace(contents)
  const value = new RegExp(
    `^\\s*${setting}\\s*=\\s*${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'm',
  )
  if (!value.test(workspace)) {
    fail(`${configPath} must set workspace ${setting} = ${expected}`)
  }
}

function assertReleaseConfigs() {
  const releaseConfig = readFileSync(RELEASE_CONFIG, 'utf8')
  assertWorkspaceSetting(
    releaseConfig,
    'release_always',
    'false',
    'release-plz.toml',
  )
  assertWorkspaceSetting(
    releaseConfig,
    'git_tag_name',
    '"{{ package }}-v{{ version }}"',
    'release-plz.toml',
  )

  for (const pkg of PUBLICATION_CRATES) {
    const contents = readFileSync(resolve(REPO_ROOT, pkg.releaseConfig), 'utf8')
    assertWorkspaceSetting(contents, 'release', 'false', pkg.releaseConfig)
    assertWorkspaceSetting(
      contents,
      'release_always',
      'false',
      pkg.releaseConfig,
    )
    assertWorkspaceSetting(
      contents,
      'git_tag_name',
      '"{{ package }}-v{{ version }}"',
      pkg.releaseConfig,
    )
    const packages = configPackages(contents)
    if (
      packages.length !== 1 ||
      packages[0].name !== pkg.name ||
      !packages[0].release
    ) {
      fail(`${pkg.releaseConfig} must release only ${pkg.name}`)
    }
  }

  const config = readFileSync(REMAINING_RELEASE_CONFIG, 'utf8')
  assertWorkspaceSetting(
    config,
    'release_always',
    'false',
    '.github/release-plz-remaining.toml',
  )
  const packages = configPackages(config)
  const expected = PUBLICATION_CRATES.map(({ name }) => ({
    name,
    release: false,
  }))
  if (JSON.stringify(packages) !== JSON.stringify(expected)) {
    fail(
      'Remaining release-plz config must exclude all separately published crates',
    )
  }
}

function formatPlan(packages) {
  return packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(' -> ')
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const packages = validateReleaseMetadata(loadCargoMetadata())

  switch (command) {
    case 'check':
      assertReleaseConfigs()
      if (args.includes('--require-clean')) {
        assertCleanCheckout()
      }
      console.log(`Coordinated release plan: ${formatPlan(packages)}`)
      break
    case 'check-semver':
      checkSemver()
      break
    case 'publish':
      assertReleaseConfigs()
      assertCleanCheckout()
      if (!process.env.GIT_TOKEN || !process.env.CARGO_REGISTRY_TOKEN) {
        fail('GIT_TOKEN and CARGO_REGISTRY_TOKEN are required for publication')
      }
      console.log(`Coordinated release plan: ${formatPlan(packages)}`)
      await executePublicationPlan(packages)
      break
    default:
      fail(
        `Usage: ${relative(REPO_ROOT, fileURLToPath(import.meta.url))} <check|check-semver|publish> [--require-clean]`,
      )
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
