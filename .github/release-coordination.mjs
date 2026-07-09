#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..')

export const COORDINATED_CRATES = Object.freeze([
  Object.freeze({
    name: 'napi',
    manifest: 'crates/napi/Cargo.toml',
    expectedMajor: 4,
    baselineVersion: '3.10.3',
    initialVersion: '4.0.0',
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
const RELEASE_WORKFLOW = resolve(
  REPO_ROOT,
  '.github/workflows/release-crates.yml',
)
const REMAINING_RELEASE_CONFIG = resolve(
  REPO_ROOT,
  '.github/release-plz-remaining.toml',
)
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_WAIT_INTERVAL_MS = 5 * 1000
const RELEASE_PLZ_VERSION = '0.3.159'
const RELEASE_NAME_TEMPLATE = '"{{ package }}-v{{ version }}"'
const USER_AGENT = 'napi-rs-release-coordinator'

function fail(message) {
  throw new Error(message)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  const resolvedByDirectory = new Map(
    resolved.map((pkg) => [dirname(pkg.metadata.manifest_path), pkg]),
  )
  const publicationIndex = new Map(
    resolved.map((pkg, index) => [pkg.name, index]),
  )
  const dependencyEdges = new Set()

  for (const pkg of resolved) {
    if (
      Array.isArray(pkg.metadata.publish) &&
      !pkg.metadata.publish.includes('crates-io')
    ) {
      fail(`${pkg.name} must remain publishable to crates.io`)
    }

    for (const dependency of pkg.metadata.dependencies) {
      if (dependency.kind === 'dev' || !dependency.path) continue
      const prerequisite = resolvedByDirectory.get(resolve(dependency.path))
      if (!prerequisite) continue

      dependencyEdges.add(`${pkg.name}->${prerequisite.name}`)
      if (dependency.name !== prerequisite.name) {
        fail(
          `${pkg.name} path dependency ${dependency.name} resolves to ${prerequisite.name}`,
        )
      }
      if (
        publicationIndex.get(prerequisite.name) >=
        publicationIndex.get(pkg.name)
      ) {
        fail(
          `${pkg.name} depends on ${prerequisite.name}, which must appear earlier in the publication order`,
        )
      }
      if (dependency.registry != null) {
        fail(
          `${pkg.name} must use the crates.io registry for ${prerequisite.name}`,
        )
      }

      const expectedRequirement = `^${prerequisite.version}`
      if (dependency.req !== expectedRequirement) {
        fail(
          `${pkg.name} must require ${prerequisite.name} ${expectedRequirement}, got ${dependency.req}`,
        )
      }
    }
  }

  for (const [dependent, prerequisites] of [
    ['napi', ['napi-build', 'napi-sys']],
    ['napi-derive', ['napi-derive-backend']],
  ]) {
    for (const prerequisite of prerequisites) {
      if (!dependencyEdges.has(`${dependent}->${prerequisite}`)) {
        fail(`${dependent} must retain its path dependency on ${prerequisite}`)
      }
    }
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
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    fail(`Registry request failed with HTTP ${response.status}: ${url}`)
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
  return (
    api.version?.num === version &&
    sparseIndexContains(indexBody, crateName, version)
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
    const stderr = result.stderr.trim()
    fail(
      `release-plz ${args.join(' ')} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ''}`,
    )
  }

  const output = result.stdout.trim()
  if (!output) {
    fail(`release-plz ${args.join(' ')} returned no JSON output`)
  }
  const parsed = JSON.parse(output)
  if (!Array.isArray(parsed.releases)) {
    fail(`release-plz ${args.join(' ')} returned invalid JSON output`)
  }
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`)
  return parsed.releases
}

function validatePackageRelease(pkg, releases) {
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
}

export function releaseTag(pkg) {
  return `${pkg.name}-v${pkg.version}`
}

async function fetchGitHubResource(
  path,
  {
    fetchImpl = globalThis.fetch,
    repository = process.env.GITHUB_REPOSITORY,
    token = process.env.GIT_TOKEN,
    apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  } = {},
) {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    fail('GITHUB_REPOSITORY must identify the release repository')
  }
  if (!token) {
    fail('GIT_TOKEN is required to verify GitHub release artifacts')
  }

  const response = await fetchImpl(`${apiUrl}/repos/${repository}/${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': USER_AGENT,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const body = (await response.text()).trim()
    fail(
      `GitHub release-artifact request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`,
    )
  }
  return response.json()
}

export async function inspectReleaseArtifacts(pkg, options = {}) {
  const tag = releaseTag(pkg)
  const [tagRef, release] = await Promise.all([
    fetchGitHubResource(`git/ref/tags/${encodeURIComponent(tag)}`, options),
    fetchGitHubResource(`releases/tags/${encodeURIComponent(tag)}`, options),
  ])

  if (release) {
    const expectedPrerelease = pkg.version.includes('-')
    if (
      release.tag_name !== tag ||
      release.name !== tag ||
      release.draft ||
      release.prerelease !== expectedPrerelease
    ) {
      fail(
        `GitHub release ${tag} exists with unexpected metadata: ${JSON.stringify(
          {
            tag_name: release.tag_name,
            name: release.name,
            draft: release.draft,
            prerelease: release.prerelease,
          },
        )}`,
      )
    }
  }

  return { tag: tagRef !== null, release: release !== null }
}

function removeLocalTag(tag) {
  const localTag = execFileSync('git', ['tag', '--list', tag], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim()
  if (localTag) {
    execFileSync('git', ['tag', '--delete', tag], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    })
  }
}

export function repairConfig(pkg, createTag) {
  return `[workspace]
allow_dirty = true
git_release_enable = true
git_release_name = "{{ package }}-v{{ version }}"
git_tag_enable = ${createTag}
git_tag_name = "{{ package }}-v{{ version }}"
publish = false
release = false
# Keep artifact repair authorized by the same merged release PR. A retry must
# re-run that failed workflow SHA rather than tagging a later commit.
release_always = false

[[package]]
name = "${pkg.name}"
release = true
`
}

function repairReleaseArtifacts(pkg, { createTag }) {
  const tag = releaseTag(pkg)
  if (!createTag) {
    // release-plz skips all work when it sees a local tag. Hide only the local
    // ref so its git-release-only path can repair a missing GitHub release.
    removeLocalTag(tag)
  }

  const tempDirectory = mkdtempSync(
    join(tmpdir(), 'napi-rs-release-artifacts-'),
  )
  const configPath = join(tempDirectory, 'release-plz.toml')
  try {
    writeFileSync(configPath, repairConfig(pkg, createTag))
    const releases = runReleasePlz([
      'release',
      '--config',
      configPath,
      '--manifest-path',
      resolve(REPO_ROOT, 'Cargo.toml'),
      '--forge',
      'github',
      '-o',
      'json',
    ])
    validatePackageRelease(pkg, releases)
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

export async function ensureReleaseArtifacts(
  pkg,
  { inspect = inspectReleaseArtifacts, repair = repairReleaseArtifacts } = {},
) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = await inspect(pkg)
    if (state.tag && state.release) {
      return
    }
    try {
      await repair(pkg, { createTag: !state.tag })
      lastError = undefined
    } catch (error) {
      lastError = error
    }
  }

  const state = await inspect(pkg)
  if (state.tag && state.release) {
    return
  }
  fail(
    `Incomplete GitHub release artifacts for ${releaseTag(pkg)}: tag=${state.tag}, release=${state.release}${lastError ? `; repair failed: ${lastError.message}` : ''}`,
  )
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
  validatePackageRelease(pkg, releases)
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
    artifacts = ensureReleaseArtifacts,
    inspectArtifacts = inspectReleaseArtifacts,
    releaseRemaining = releaseRemainingPackages,
  } = {},
) {
  let publishedInThisRun = false
  for (const pkg of packages) {
    let alreadyVisible = await visible(pkg)
    let releases = []
    if (!alreadyVisible) {
      releases = await release(pkg)
      alreadyVisible = await visible(pkg)
    }

    if (releases.length === 0 && !alreadyVisible) {
      if (!publishedInThisRun) {
        const state = await inspectArtifacts(pkg)
        if (state.tag || state.release) {
          fail(
            `${pkg.name} ${pkg.version} has GitHub artifacts but is not registry-visible: tag=${state.tag}, release=${state.release}`,
          )
        }
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
    await artifacts(pkg)
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

export function semverCommandPlan({ initialRuntimePublished = false } = {}) {
  const runtime = COORDINATED_CRATES[0]
  const commands = []
  if (!initialRuntimePublished) {
    commands.push({
      args: [
        '--manifest-path',
        runtime.manifest,
        '--baseline-version',
        runtime.baselineVersion,
        '--default-features',
        '--features',
        'tokio_rt',
        '--release-type',
        'minor',
        '--color',
        'never',
      ],
      expectMajorFailure: true,
    })
  }
  commands.push({
    args: [
      '--manifest-path',
      runtime.manifest,
      '--default-features',
      '--features',
      'tokio_rt',
      '--color',
      'never',
    ],
  })

  if (initialRuntimePublished) {
    for (const features of ['async-runtime', 'async-runtime,tokio_rt']) {
      commands.push({
        args: [
          '--manifest-path',
          runtime.manifest,
          '--default-features',
          '--features',
          features,
          '--color',
          'never',
        ],
      })
    }
  }

  const backend = COORDINATED_CRATES[1]
  commands.push({
    args: [
      '--manifest-path',
      backend.manifest,
      '--all-features',
      '--color',
      'never',
    ],
  })
  return commands
}

export async function checkSemver() {
  const runtime = COORDINATED_CRATES[0]
  const initialRuntimePublished = await isRegistryVisible(
    runtime.name,
    runtime.initialVersion,
  )
  for (const { args, expectMajorFailure } of semverCommandPlan({
    initialRuntimePublished,
  })) {
    runSemverCommand(args, { expectMajorFailure })
  }
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
    `^\\s*${setting}\\s*=\\s*${escapeRegExp(expected)}\\s*$`,
    'm',
  )
  if (!value.test(workspace)) {
    fail(`${configPath} must set workspace ${setting} = ${expected}`)
  }
}

function yamlBlock(contents, key, indent, context) {
  const lines = contents.split('\n')
  const prefix = `${' '.repeat(indent)}${key}:`
  const start = lines.findIndex((line) => line === prefix)
  if (start === -1) {
    fail(`${context} is missing ${key}`)
  }

  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    const currentIndent = line.length - line.trimStart().length
    if (line.trim() && currentIndent <= indent) break
    end += 1
  }
  return lines.slice(start + 1, end).join('\n')
}

function assertYamlScalar(contents, key, expected, context) {
  const value = new RegExp(
    `^\\s+${escapeRegExp(key)}:\\s+${escapeRegExp(expected)}\\s*$`,
    'm',
  )
  if (!value.test(contents)) {
    fail(`${context} must set ${key}: ${expected}`)
  }
}

export function validateReleaseWorkflow(contents) {
  if (!/^permissions:\s*\{\}\s*$/m.test(contents)) {
    fail('Release workflow must deny permissions by default')
  }
  for (const path of ['Cargo.toml', 'Cargo.lock']) {
    if (
      !new RegExp(`^\\s+- '${escapeRegExp(path)}'\\s*$`, 'm').test(contents)
    ) {
      fail(`Release workflow pull-request paths must include ${path}`)
    }
  }

  const releaseJob = yamlBlock(
    contents,
    'release-plz-release',
    2,
    'release workflow',
  )
  const permissions = yamlBlock(
    releaseJob,
    'permissions',
    4,
    'release-plz-release job',
  )
  assertYamlScalar(permissions, 'contents', 'write', 'release job permissions')
  assertYamlScalar(permissions, 'id-token', 'write', 'release job permissions')
  assertYamlScalar(
    permissions,
    'pull-requests',
    'read',
    'release job permissions',
  )

  if (/^    concurrency:\s*$/m.test(releaseJob)) {
    fail(
      'Release job must not use GitHub concurrency because pending release runs can be replaced',
    )
  }

  const publishCommand =
    /^\s+run:\s+node \.github\/release-coordination\.mjs publish\s*$/gm
  const publishCommands = contents.match(publishCommand) ?? []
  if (publishCommands.length !== 1) {
    fail('Release workflow must have exactly one coordinated publish command')
  }
  if (!(releaseJob.match(publishCommand) ?? []).length) {
    fail('Coordinated publish command must run in the release job')
  }

  const gitTokens =
    releaseJob.match(
      /^\s+GIT_TOKEN:\s+\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}\s*$/gm,
    ) ?? []
  if (gitTokens.length !== 1) {
    fail('Release workflow must pass GITHUB_TOKEN to the CLI as GIT_TOKEN')
  }
  const registryTokens =
    releaseJob.match(
      /^\s+CARGO_REGISTRY_TOKEN:\s+\$\{\{\s*steps\.auth\.outputs\.token\s*\}\}\s*$/gm,
    ) ?? []
  if (registryTokens.length !== 1) {
    fail('Release workflow must pass the trusted-publishing registry token')
  }
  if (
    !releaseJob.includes(`cargo binstall release-plz@${RELEASE_PLZ_VERSION}`)
  ) {
    fail(`Release workflow must install release-plz ${RELEASE_PLZ_VERSION}`)
  }
  if (/^\s+command:\s+release\s*$/m.test(contents)) {
    fail('Release workflow must not contain a second release-plz publisher')
  }

  const releasePrJob = yamlBlock(
    contents,
    'release-plz-pr',
    2,
    'release workflow',
  )
  const concurrency = yamlBlock(
    releasePrJob,
    'concurrency',
    4,
    'release-plz-pr job',
  )
  assertYamlScalar(
    concurrency,
    'group',
    'release-plz-${{ github.ref }}',
    'release PR concurrency',
  )
  assertYamlScalar(
    concurrency,
    'cancel-in-progress',
    'false',
    'release PR concurrency',
  )
  assertYamlScalar(
    releasePrJob,
    'version',
    RELEASE_PLZ_VERSION,
    'release PR action',
  )

  const nonPersistedCheckouts =
    contents.match(/^\s+persist-credentials:\s+false\s*$/gm) ?? []
  if (nonPersistedCheckouts.length !== 3) {
    fail('Every release workflow checkout must disable persisted credentials')
  }
}

function assertReleaseConfigs() {
  validateReleaseWorkflow(readFileSync(RELEASE_WORKFLOW, 'utf8'))

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
    RELEASE_NAME_TEMPLATE,
    'release-plz.toml',
  )
  assertWorkspaceSetting(
    releaseConfig,
    'git_release_name',
    RELEASE_NAME_TEMPLATE,
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
      RELEASE_NAME_TEMPLATE,
      pkg.releaseConfig,
    )
    assertWorkspaceSetting(
      contents,
      'git_release_name',
      RELEASE_NAME_TEMPLATE,
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
  assertWorkspaceSetting(
    config,
    'git_tag_name',
    RELEASE_NAME_TEMPLATE,
    '.github/release-plz-remaining.toml',
  )
  assertWorkspaceSetting(
    config,
    'git_release_name',
    RELEASE_NAME_TEMPLATE,
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
      await checkSemver()
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
