import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COORDINATED_CRATES,
  PUBLICATION_CRATES,
  executePublicationPlan,
  isRegistryVisible,
  sparseIndexContains,
  sparseIndexPath,
  validateReleaseMetadata,
} from './release-coordination.mjs'

const ROOT = '/repo'

function metadataFor(versions = {}) {
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
      packageFor(
        'napi-build',
        'crates/build/Cargo.toml',
        versions.build ?? '2.3.2',
      ),
      packageFor('napi-sys', 'crates/sys/Cargo.toml', versions.sys ?? '3.2.2'),
      packageFor('napi', 'crates/napi/Cargo.toml', versions.napi ?? '4.0.0', [
        {
          name: 'napi-build',
          path: `${ROOT}/crates/build`,
          req: '^2.3.2',
        },
        {
          name: 'napi-sys',
          path: `${ROOT}/crates/sys`,
          req: '^3.2.2',
        },
      ]),
      packageFor(
        'napi-derive-backend',
        'crates/backend/Cargo.toml',
        versions.backend ?? '6.0.0',
      ),
      packageFor(
        'napi-derive',
        'crates/macro/Cargo.toml',
        versions.derive ?? '4.0.0',
        [
          {
            name: 'napi-derive-backend',
            path: `${ROOT}/crates/backend`,
            req: versions.backendRequirement ?? '^6.0.0',
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
    releaseRemaining: async () => {
      events.push('release:remaining')
    },
  })

  assert.deepEqual(result, { published: true })
  assert.deepEqual(events, [
    'release:napi-build',
    'visible:napi-build',
    'wait:napi-build',
    'release:napi-sys',
    'visible:napi-sys',
    'wait:napi-sys',
    'release:napi',
    'visible:napi',
    'wait:napi',
    'release:napi-derive-backend',
    'visible:napi-derive-backend',
    'wait:napi-derive-backend',
    'release:napi-derive',
    'visible:napi-derive',
    'wait:napi-derive',
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
    releaseRemaining: async () => assert.fail('remaining publish must not run'),
  })

  assert.deepEqual(result, { published: false })
  assert.deepEqual(events, ['release:napi-build', 'visible:napi-build'])
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
    releaseRemaining: async () => assert.fail('remaining publish must not run'),
  })

  assert.deepEqual(result, { published: false })
  assert.deepEqual(events, [
    'release:napi-build',
    'visible:napi-build',
    'release:napi-sys',
    'visible:napi-sys',
    'release:napi',
    'visible:napi',
  ])
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
      releaseRemaining: async () =>
        assert.fail('remaining publish must not run'),
    }),
    /was not published after publication began/,
  )
})

test('retry skips already-published coordinated versions without waiting', async () => {
  const packages = validateReleaseMetadata(metadataFor(), ROOT)
  const events = []
  const result = await executePublicationPlan(packages, {
    release: async (pkg) => {
      events.push(`release:${pkg.name}`)
      return []
    },
    visible: async (pkg) => {
      events.push(`visible:${pkg.name}`)
      return true
    },
    wait: async () => assert.fail('wait must not run for visible versions'),
    releaseRemaining: async () => {
      events.push('release:remaining')
    },
  })

  assert.deepEqual(result, { published: true })
  assert.deepEqual(events, [
    'release:napi-build',
    'visible:napi-build',
    'release:napi-sys',
    'visible:napi-sys',
    'release:napi',
    'visible:napi',
    'release:napi-derive-backend',
    'visible:napi-derive-backend',
    'release:napi-derive',
    'visible:napi-derive',
    'release:remaining',
  ])
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
})
