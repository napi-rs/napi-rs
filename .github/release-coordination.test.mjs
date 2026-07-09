import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  COORDINATED_CRATES,
  PUBLICATION_CRATES,
  ensureReleaseArtifacts,
  executePublicationPlan,
  inspectReleaseArtifacts,
  isRegistryVisible,
  repairConfig,
  releaseTag,
  semverCommandPlan,
  sparseIndexContains,
  sparseIndexPath,
  validateReleaseMetadata,
  validateReleaseWorkflow,
} from './release-coordination.mjs'

const ROOT = '/repo'
const RELEASE_WORKFLOW = readFileSync(
  new URL('./workflows/release-crates.yml', import.meta.url),
  'utf8',
)

function metadataFor(versions = {}) {
  const buildVersion = versions.build ?? '2.3.2'
  const sysVersion = versions.sys ?? '3.2.2'
  const backendVersion = versions.backend ?? '6.0.0'
  const packageFor = (
    name,
    manifest,
    version,
    dependencies = [],
    kind = ['lib'],
  ) => ({
    name,
    version,
    manifest_path: `${ROOT}/${manifest}`,
    dependencies,
    targets: [{ kind }],
  })

  return {
    packages: [
      packageFor('napi-build', 'crates/build/Cargo.toml', buildVersion),
      packageFor('napi-sys', 'crates/sys/Cargo.toml', sysVersion),
      packageFor('napi', 'crates/napi/Cargo.toml', versions.napi ?? '4.0.0', [
        {
          name: 'napi-build',
          path: `${ROOT}/crates/build`,
          req: versions.buildRequirement ?? `^${buildVersion}`,
        },
        {
          name: 'napi-sys',
          path: `${ROOT}/crates/sys`,
          req: versions.sysRequirement ?? `^${sysVersion}`,
        },
      ]),
      packageFor(
        'napi-derive-backend',
        'crates/backend/Cargo.toml',
        backendVersion,
      ),
      packageFor(
        'napi-derive',
        'crates/macro/Cargo.toml',
        versions.derive ?? '4.0.0',
        [
          {
            name: 'napi-derive-backend',
            path: `${ROOT}/crates/backend`,
            req: versions.backendRequirement ?? `^${backendVersion}`,
          },
        ],
        ['proc-macro'],
      ),
    ],
  }
}

test('pins exact coordinated majors and publication order', () => {
  assert.deepEqual(
    COORDINATED_CRATES.map(({ name, expectedMajor, releaseConfig }) => [
      name,
      expectedMajor,
      releaseConfig,
    ]),
    [
      ['napi', 4, '.github/release-plz-napi.toml'],
      ['napi-derive-backend', 6, '.github/release-plz-backend.toml'],
      ['napi-derive', 4, '.github/release-plz-derive.toml'],
    ],
  )
  assert.deepEqual(
    PUBLICATION_CRATES.map(({ name }) => name),
    ['napi-build', 'napi-sys', 'napi', 'napi-derive-backend', 'napi-derive'],
  )
  assert.deepEqual(
    validateReleaseMetadata(metadataFor(), ROOT).map(
      ({ name, version }) => `${name}@${version}`,
    ),
    [
      'napi-build@2.3.2',
      'napi-sys@3.2.2',
      'napi@4.0.0',
      'napi-derive-backend@6.0.0',
      'napi-derive@4.0.0',
    ],
  )
})

for (const [field, version, expectedMessage] of [
  ['napi', '3.11.0', 'napi must remain on major 4'],
  ['backend', '5.1.2', 'napi-derive-backend must remain on major 6'],
  ['derive', '3.5.10', 'napi-derive must remain on major 4'],
]) {
  test(`rejects the release-plz ${field} non-major proposal`, () => {
    assert.throws(
      () => validateReleaseMetadata(metadataFor({ [field]: version }), ROOT),
      new RegExp(expectedMessage),
    )
  })
}

test('requires derive to depend on backend major 6', () => {
  assert.throws(
    () =>
      validateReleaseMetadata(
        metadataFor({ backendRequirement: '^5.1.2' }),
        ROOT,
      ),
    /must require napi-derive-backend \^6\.0\.0/,
  )
})

test('requires dependency requirements to match publication versions', () => {
  assert.throws(
    () =>
      validateReleaseMetadata(
        metadataFor({
          build: '2.3.3',
          buildRequirement: '^2.3.2',
        }),
        ROOT,
      ),
    /must require napi-build \^2\.3\.3/,
  )
  assert.throws(
    () =>
      validateReleaseMetadata(
        metadataFor({
          backend: '6.0.1',
          backendRequirement: '^6.0.0',
        }),
        ROOT,
      ),
    /must require napi-derive-backend \^6\.0\.1/,
  )
  assert.doesNotThrow(() =>
    validateReleaseMetadata(
      metadataFor({
        build: '2.3.3',
        sys: '3.2.3',
        napi: '4.0.1',
        backend: '6.0.1',
        derive: '4.0.1',
      }),
      ROOT,
    ),
  )
})

test('requires crates.io-compatible dependencies in publication order', () => {
  const reversed = metadataFor()
  reversed.packages
    .find(({ name }) => name === 'napi-build')
    .dependencies.push({
      name: 'napi',
      path: `${ROOT}/crates/napi`,
      req: '^4.0.0',
    })
  assert.throws(
    () => validateReleaseMetadata(reversed, ROOT),
    /napi-build depends on napi, which must appear earlier/,
  )

  const alternateRegistry = metadataFor()
  alternateRegistry.packages
    .find(({ name }) => name === 'napi')
    .dependencies.find(({ name }) => name === 'napi-sys').registry =
    'https://example.com/index'
  assert.throws(
    () => validateReleaseMetadata(alternateRegistry, ROOT),
    /must use the crates.io registry for napi-sys/,
  )

  const unpublished = metadataFor()
  unpublished.packages.find(({ name }) => name === 'napi').publish = []
  assert.throws(
    () => validateReleaseMetadata(unpublished, ROOT),
    /napi must remain publishable to crates.io/,
  )
})

test('enforces least privilege and non-dropping release concurrency', () => {
  assert.doesNotThrow(() => validateReleaseWorkflow(RELEASE_WORKFLOW))
  assert.throws(
    () =>
      validateReleaseWorkflow(
        RELEASE_WORKFLOW.replace(
          '      pull-requests: read',
          '      pull-requests: none',
        ),
      ),
    /must set pull-requests: read/,
  )
  assert.throws(
    () =>
      validateReleaseWorkflow(
        RELEASE_WORKFLOW.replace(
          '    permissions:\n      contents: write\n      id-token: write',
          '    concurrency:\n      group: release-plz-release\n      cancel-in-progress: false\n    permissions:\n      contents: write\n      id-token: write',
        ),
      ),
    /must not use GitHub concurrency/,
  )
  assert.throws(
    () =>
      validateReleaseWorkflow(
        RELEASE_WORKFLOW.replace('          version: 0.3.159\n', ''),
      ),
    /must set version: 0\.3\.159/,
  )
  assert.throws(
    () =>
      validateReleaseWorkflow(
        `${RELEASE_WORKFLOW}\n  duplicate:\n    run: node .github/release-coordination.mjs publish\n`,
      ),
    /exactly one coordinated publish command/,
  )
  assert.throws(
    () =>
      validateReleaseWorkflow(
        RELEASE_WORKFLOW.replace("      - 'Cargo.toml'\n", ''),
      ),
    /pull-request paths must include Cargo.toml/,
  )
})

test('publishes prerequisites before runtime, backend, and derive', async () => {
  const packages = validateReleaseMetadata(metadataFor(), ROOT)
  const events = []
  const result = await executePublicationPlan(packages, {
    release: async (pkg) => {
      events.push(`release:${pkg.name}`)
      return [{ package_name: pkg.name, version: pkg.version }]
    },
    visible: async (pkg) => {
      events.push(`visible:${pkg.name}`)
      return false
    },
    wait: async (pkg) => {
      events.push(`wait:${pkg.name}`)
    },
    artifacts: async (pkg) => {
      events.push(`artifacts:${pkg.name}`)
    },
    releaseRemaining: async () => {
      events.push('release:remaining')
    },
  })

  assert.deepEqual(result, { published: true })
  assert.deepEqual(events, [
    'visible:napi-build',
    'release:napi-build',
    'visible:napi-build',
    'wait:napi-build',
    'artifacts:napi-build',
    'visible:napi-sys',
    'release:napi-sys',
    'visible:napi-sys',
    'wait:napi-sys',
    'artifacts:napi-sys',
    'visible:napi',
    'release:napi',
    'visible:napi',
    'wait:napi',
    'artifacts:napi',
    'visible:napi-derive-backend',
    'release:napi-derive-backend',
    'visible:napi-derive-backend',
    'wait:napi-derive-backend',
    'artifacts:napi-derive-backend',
    'visible:napi-derive',
    'release:napi-derive',
    'visible:napi-derive',
    'wait:napi-derive',
    'artifacts:napi-derive',
    'release:remaining',
  ])
})

test('skips every publication when the first crate is not release-eligible', async () => {
  const packages = validateReleaseMetadata(metadataFor(), ROOT)
  const events = []
  const result = await executePublicationPlan(packages, {
    release: async (pkg) => {
      events.push(`release:${pkg.name}`)
      return []
    },
    visible: async (pkg) => {
      events.push(`visible:${pkg.name}`)
      return false
    },
    wait: async () => assert.fail('wait must not run'),
    artifacts: async () => assert.fail('artifacts must not run'),
    inspectArtifacts: async (pkg) => {
      events.push(`inspect:${pkg.name}`)
      return { tag: false, release: false }
    },
    releaseRemaining: async () => assert.fail('remaining publish must not run'),
  })

  assert.deepEqual(result, { published: false })
  assert.deepEqual(events, [
    'visible:napi-build',
    'release:napi-build',
    'visible:napi-build',
    'inspect:napi-build',
  ])
})

test('skips when prerequisites are visible but runtime is not release-eligible', async () => {
  const packages = validateReleaseMetadata(metadataFor(), ROOT)
  const events = []
  const result = await executePublicationPlan(packages, {
    release: async (pkg) => {
      events.push(`release:${pkg.name}`)
      return []
    },
    visible: async (pkg) => {
      events.push(`visible:${pkg.name}`)
      return pkg.name === 'napi-build' || pkg.name === 'napi-sys'
    },
    wait: async () => assert.fail('wait must not run'),
    artifacts: async (pkg) => {
      events.push(`artifacts:${pkg.name}`)
    },
    inspectArtifacts: async (pkg) => {
      events.push(`inspect:${pkg.name}`)
      return { tag: false, release: false }
    },
    releaseRemaining: async () => assert.fail('remaining publish must not run'),
  })

  assert.deepEqual(result, { published: false })
  assert.deepEqual(events, [
    'visible:napi-build',
    'artifacts:napi-build',
    'visible:napi-sys',
    'artifacts:napi-sys',
    'visible:napi',
    'release:napi',
    'visible:napi',
    'inspect:napi',
  ])
})

test('fails closed when GitHub artifacts exist without registry visibility', async () => {
  const [pkg] = validateReleaseMetadata(metadataFor(), ROOT)

  await assert.rejects(
    executePublicationPlan([pkg], {
      release: async () => [],
      visible: async () => false,
      wait: async () => assert.fail('wait must not run'),
      artifacts: async () => assert.fail('artifacts must not run'),
      inspectArtifacts: async () => ({ tag: true, release: false }),
      releaseRemaining: async () =>
        assert.fail('remaining publish must not run'),
    }),
    /has GitHub artifacts but is not registry-visible: tag=true, release=false/,
  )
})

test('fails if a later crate is unavailable after publication starts', async () => {
  const packages = validateReleaseMetadata(metadataFor(), ROOT)
  let releaseCount = 0

  await assert.rejects(
    executePublicationPlan(packages, {
      release: async (pkg) => {
        releaseCount += 1
        return releaseCount === 1
          ? [{ package_name: pkg.name, version: pkg.version }]
          : []
      },
      visible: async () => false,
      wait: async () => {},
      artifacts: async () => {},
      releaseRemaining: async () =>
        assert.fail('remaining publish must not run'),
    }),
    /was not published after publication began/,
  )
})

test('retry skips release-plz for visible versions and repairs artifacts', async () => {
  const packages = validateReleaseMetadata(metadataFor(), ROOT)
  const events = []
  const result = await executePublicationPlan(packages, {
    release: async () =>
      assert.fail('release must not run for visible versions'),
    visible: async (pkg) => {
      events.push(`visible:${pkg.name}`)
      return true
    },
    wait: async () => assert.fail('wait must not run for visible versions'),
    artifacts: async (pkg) => {
      events.push(`artifacts:${pkg.name}`)
    },
    releaseRemaining: async () => {
      events.push('release:remaining')
    },
  })

  assert.deepEqual(result, { published: true })
  assert.deepEqual(events, [
    'visible:napi-build',
    'artifacts:napi-build',
    'visible:napi-sys',
    'artifacts:napi-sys',
    'visible:napi',
    'artifacts:napi',
    'visible:napi-derive-backend',
    'artifacts:napi-derive-backend',
    'visible:napi-derive',
    'artifacts:napi-derive',
    'release:remaining',
  ])
})

test('accepts a concurrent publication detected after release-plz returns', async () => {
  const [pkg] = validateReleaseMetadata(metadataFor(), ROOT)
  const events = []
  let visibilityChecks = 0
  const result = await executePublicationPlan([pkg], {
    release: async () => {
      events.push('release')
      return []
    },
    visible: async () => {
      visibilityChecks += 1
      events.push(`visible:${visibilityChecks}`)
      return visibilityChecks === 2
    },
    wait: async () => assert.fail('wait must not run'),
    artifacts: async () => {
      events.push('artifacts')
    },
    releaseRemaining: async () => {
      events.push('remaining')
    },
  })

  assert.deepEqual(result, { published: true })
  assert.deepEqual(events, [
    'visible:1',
    'release',
    'visible:2',
    'artifacts',
    'remaining',
  ])
})

test('repairs missing tags and releases after registry publication', async () => {
  const pkg = { name: 'napi', version: '4.0.0' }
  const states = [
    { tag: false, release: false },
    { tag: true, release: true },
  ]
  const repairs = []

  await ensureReleaseArtifacts(pkg, {
    inspect: async () => states.shift(),
    repair: async (_pkg, options) => {
      repairs.push(options)
    },
  })

  assert.deepEqual(repairs, [{ createTag: true }])
  assert.equal(releaseTag(pkg), 'napi-v4.0.0')
})

test('keeps artifact repair scoped to the original release PR commit', () => {
  const config = repairConfig({ name: 'napi', version: '4.0.0' }, false)
  assert.match(config, /^git_release_enable = true$/m)
  assert.match(config, /^git_tag_enable = false$/m)
  assert.match(config, /^publish = false$/m)
  assert.match(config, /^release_always = false$/m)
  assert.match(config, /^\[\[package\]\]\nname = "napi"\nrelease = true$/m)
})

test('repairs a release-plz failure after the tag was created', async () => {
  const states = [
    { tag: true, release: false },
    { tag: true, release: true },
  ]
  const repairs = []

  await ensureReleaseArtifacts(
    { name: 'napi-derive', version: '4.0.0' },
    {
      inspect: async () => states.shift(),
      repair: async (_pkg, options) => {
        repairs.push(options)
      },
    },
  )

  assert.deepEqual(repairs, [{ createTag: false }])
})

test('tolerates a racing artifact repair that completed elsewhere', async () => {
  const states = [
    { tag: false, release: false },
    { tag: true, release: true },
  ]

  await ensureReleaseArtifacts(
    { name: 'napi', version: '4.0.0' },
    {
      inspect: async () => states.shift(),
      repair: async () => {
        throw new Error('tag already exists')
      },
    },
  )
})

test('fails closed when release artifacts remain incomplete', async () => {
  await assert.rejects(
    ensureReleaseArtifacts(
      { name: 'napi', version: '4.0.0' },
      {
        inspect: async () => ({ tag: true, release: false }),
        repair: async () => {
          throw new Error('GitHub unavailable')
        },
      },
    ),
    /tag=true, release=false; repair failed: GitHub unavailable/,
  )
})

test('validates GitHub release metadata for the exact package tag', async () => {
  const pkg = { name: 'napi', version: '4.0.0' }
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.includes('/git/ref/')
        ? { ref: 'refs/tags/napi-v4.0.0' }
        : {
            tag_name: 'napi-v4.0.0',
            name: 'napi-v4.0.0',
            draft: false,
            prerelease: false,
          },
  })

  assert.deepEqual(
    await inspectReleaseArtifacts(pkg, {
      fetchImpl,
      repository: 'napi-rs/napi-rs',
      token: 'test',
    }),
    { tag: true, release: true },
  )
})

test('uses dynamic baselines after proving the initial major bump', () => {
  const initialPlan = semverCommandPlan()
  assert.equal(initialPlan[0].expectMajorFailure, true)
  assert.ok(initialPlan[0].args.includes('3.10.3'))
  assert.ok(initialPlan[0].args.includes('tokio_rt'))
  for (const command of initialPlan.slice(1)) {
    assert.equal(command.args.includes('--baseline-version'), false)
  }
  assert.deepEqual(
    initialPlan
      .slice(0, 2)
      .map(({ args }) => args[args.indexOf('--features') + 1]),
    ['tokio_rt', 'tokio_rt'],
  )
  assert.equal(initialPlan.at(-1).args.includes('--all-features'), true)

  const postReleasePlan = semverCommandPlan({
    initialRuntimePublished: true,
  })
  assert.equal(
    postReleasePlan.some(({ expectMajorFailure }) => expectMajorFailure),
    false,
  )
  assert.equal(
    postReleasePlan.some(({ args }) => args.includes('3.10.3')),
    false,
  )
  assert.deepEqual(
    postReleasePlan
      .map(({ args }) => {
        const index = args.indexOf('--features')
        return index === -1 ? null : args[index + 1]
      })
      .filter(Boolean),
    ['tokio_rt', 'async-runtime', 'async-runtime,tokio_rt'],
  )
})

test('matches crates.io sparse index paths and visible entries', () => {
  assert.equal(sparseIndexPath('napi'), 'na/pi/napi')
  assert.equal(
    sparseIndexPath('napi-derive-backend'),
    'na/pi/napi-derive-backend',
  )
  const body = [
    JSON.stringify({ name: 'napi', vers: '4.0.0', yanked: false }),
    JSON.stringify({ name: 'napi', vers: '4.0.1', yanked: true }),
  ].join('\n')
  assert.equal(sparseIndexContains(body, 'napi', '4.0.0'), true)
  assert.equal(sparseIndexContains(body, 'napi', '4.0.1'), false)
})

test('requires both crates.io API and sparse-index visibility', async () => {
  const api = JSON.stringify({ version: { num: '4.0.0' } })
  const index = JSON.stringify({
    name: 'napi',
    vers: '4.0.0',
    yanked: false,
  })
  const fetchFor = (apiBody, indexBody) => async (url) => ({
    ok: true,
    text: async () => (url.includes('/api/') ? apiBody : indexBody),
  })

  assert.equal(
    await isRegistryVisible('napi', '4.0.0', fetchFor(api, index)),
    true,
  )
  assert.equal(
    await isRegistryVisible('napi', '4.0.0', fetchFor(api, '')),
    false,
  )
  assert.equal(
    await isRegistryVisible('napi', '4.0.0', fetchFor('{}', index)),
    false,
  )
  assert.equal(
    await isRegistryVisible('napi', '4.0.0', async () => ({
      ok: false,
      status: 404,
    })),
    false,
  )
  await assert.rejects(
    isRegistryVisible('napi', '4.0.0', async () => ({
      ok: false,
      status: 503,
    })),
    /Registry request failed with HTTP 503/,
  )
})
