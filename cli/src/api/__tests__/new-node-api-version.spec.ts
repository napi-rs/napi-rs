import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as parseToml } from '@std/toml'
import test, { type ExecutionContext } from 'ava'

import { newProject, updateCargoTomlNodeApiVersion } from '../new.js'

async function rewriteNapiDependency(
  t: ExecutionContext,
  dependency: string,
  minNodeApiVersion: number,
) {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-new-node-api-'))
  t.teardown(() => rm(directory, { recursive: true, force: true }))

  const cargoTomlPath = join(directory, 'Cargo.toml')
  await writeFile(
    cargoTomlPath,
    `[package]\nname = "fixture"\nversion = "0.0.0"\n\n[dependencies]\nnapi = ${dependency}\n`,
  )

  await updateCargoTomlNodeApiVersion(cargoTomlPath, minNodeApiVersion)

  const cargoToml = parseToml(await readFile(cargoTomlPath, 'utf8')) as any
  return cargoToml.dependencies.napi
}

test('sets the default Node-API feature to napi4', async (t) => {
  const napiDependency = await rewriteNapiDependency(t, '"3.0.0"', 4)

  t.is(napiDependency.version, '3.0.0')
  t.deepEqual(napiDependency.features, ['napi4'])
  t.false('default-features' in napiDependency)
})

test('sets a requested Node-API feature and replaces the template default', async (t) => {
  const napiDependency = await rewriteNapiDependency(
    t,
    '{ version = "3.0.0", features = ["napi4", "serde-json"] }',
    6,
  )

  t.deepEqual(napiDependency.features, ['napi6', 'serde-json'])
  t.false('default-features' in napiDependency)
})

test('disables napi4 defaults for lower Node-API versions while retaining dynamic symbol loading', async (t) => {
  const napiDependency = await rewriteNapiDependency(t, '"3.0.0"', 3)

  t.is(napiDependency['default-features'], false)
  t.deepEqual(napiDependency.features, ['napi3', 'dyn-symbols'])
})

test('preserves an explicitly disabled default feature configuration', async (t) => {
  const napiDependency = await rewriteNapiDependency(
    t,
    '{ version = "3.0.0", default-features = false, features = ["napi8", "serde-json"] }',
    2,
  )

  t.is(napiDependency['default-features'], false)
  t.deepEqual(napiDependency.features, ['napi2', 'serde-json'])
})

for (const invalidVersion of [0, 10, 1.5]) {
  test(`rejects invalid Node-API version ${invalidVersion}`, async (t) => {
    const error = await t.throwsAsync(
      newProject({
        path: join(tmpdir(), 'unused-napi-rs-new-project'),
        enableDefaultTargets: true,
        minNodeApiVersion: invalidVersion,
        dryRun: true,
      }),
      { instanceOf: RangeError },
    )

    t.regex(error.message, /Unsupported Node-API version/)
  })
}
