import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import {
  type CommonPackageJsonFields,
  type UserNapiConfig,
  readNapiConfig,
} from '../config.js'

const NON_EXISTENT_FILE = 'non-existent-file'

const test = ava as TestFn<{
  configPath: string
  packageJson: string
  pkgJson: CommonPackageJsonFields
  config: UserNapiConfig
}>

test.before(async (t) => {
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
  t.context = { configPath, config, packageJson, pkgJson }
})

test.after(async (t) => {
  await unlink(t.context.configPath)
  await unlink(t.context.packageJson)
})

test('should throw if package.json not found', async (t) => {
  await t.throwsAsync(() => readNapiConfig(NON_EXISTENT_FILE), {
    message: `package.json not found at ${NON_EXISTENT_FILE}`,
  })
})

test('should throw if napi.json not found', async (t) => {
  const { packageJson } = t.context
  await t.throwsAsync(() => readNapiConfig(packageJson, NON_EXISTENT_FILE), {
    message: `NAPI-RS config not found at ${NON_EXISTENT_FILE}`,
  })
})

test('should be able to read config from package.json', async (t) => {
  const { packageJson } = t.context
  const config = await readNapiConfig(packageJson)
  t.snapshot(config)
})

test('should be able to read config from napi.json', async (t) => {
  const { packageJson, configPath } = t.context
  const config = await readNapiConfig(packageJson, configPath)
  t.snapshot(config)
})

test('should reject target aliases that overwrite the same artifact set', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-rs-config-alias-'))
  const packageJson = join(dir, 'package.json')
  await writeFile(
    packageJson,
    JSON.stringify({
      name: 'alias-collision',
      version: '1.0.0',
      napi: {
        targets: ['wasm32-wasi-preview1-threads', 'wasm32-wasip1-threads'],
      },
    }),
  )
  try {
    await t.throwsAsync(() => readNapiConfig(packageJson), {
      message:
        /produce the same wasm32-wasi artifact set\. Choose one target spelling\./,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
