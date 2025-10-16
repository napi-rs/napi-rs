import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, after, test } from 'node:test'
import assert from 'node:assert'

import {
  CommonPackageJsonFields,
  UserNapiConfig,
  readNapiConfig,
} from '../config.js'

const NON_EXISTENT_FILE = 'non-existent-file'

interface TestContext {
  configPath: string
  packageJson: string
  pkgJson: CommonPackageJsonFields
  config: UserNapiConfig
}

const context: TestContext = {} as TestContext

before(async () => {
  const tmp = tmpdir()
  const configPath = join(tmp, 'napi.json')
  const packageJson = join(tmp, 'package.json')
  const pkgJson = {
    name: '@napi-rs/testing',
    version: '0.0.0',
    napi: {
      binaryName: 'testing',
      packageName: '@napi-rs/testing',
      targets: [
        'x86_64-unknown-linux-gnu',
        'x86_64-pc-windows-msvc',
        'x86_64-apple-darwin',
      ],
    },
  }
  await writeFile(packageJson, JSON.stringify(pkgJson, null, 2))
  const config = {
    binaryName: 'testing',
    packageName: '@node-rs/testing',
    targets: [
      'x86_64-unknown-linux-gnu',
      'x86_64-apple-darwin',
      'aarch64-apple-darwin',
    ],
  }
  await writeFile(configPath, JSON.stringify(config, null, 2))
  Object.assign(context, { configPath, config, packageJson, pkgJson })
})

after(async () => {
  await unlink(context.configPath)
  await unlink(context.packageJson)
})

test('should throw if package.json not found', async () => {
  await assert.rejects(() => readNapiConfig(NON_EXISTENT_FILE), {
    message: `package.json not found at ${NON_EXISTENT_FILE}`,
  })
})

test('should throw if napi.json not found', async () => {
  const { packageJson } = context
  await assert.rejects(() => readNapiConfig(packageJson, NON_EXISTENT_FILE), {
    message: `NAPI-RS config not found at ${NON_EXISTENT_FILE}`,
  })
})

test('should be able to read config from package.json', async () => {
  const { packageJson } = context
  const config = await readNapiConfig(packageJson)
  // Snapshot testing is not directly supported in node:test
  // We'll need to manually verify the config structure
  assert.ok(config)
  assert.strictEqual(config.binaryName, 'testing')
  assert.strictEqual(config.packageName, '@napi-rs/testing')
  assert.ok(Array.isArray(config.targets))
})

test('should be able to read config from napi.json', async () => {
  const { packageJson, configPath } = context
  const config = await readNapiConfig(packageJson, configPath)
  // Snapshot testing is not directly supported in node:test
  // We'll need to manually verify the config structure
  assert.ok(config)
  assert.strictEqual(config.binaryName, 'testing')
  assert.strictEqual(config.packageName, '@node-rs/testing')
  assert.ok(Array.isArray(config.targets))
})
