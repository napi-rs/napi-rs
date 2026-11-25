import { unlink, writeFile } from 'node:fs/promises'
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

test('should normalize a versioned zigbuild target to the triple cargo compiles', async (t) => {
  const packageJson = join(tmpdir(), 'package-versioned-targets.json')
  await writeFile(
    packageJson,
    JSON.stringify({
      name: '@napi-rs/versioned',
      version: '0.0.0',
      napi: {
        binaryName: 'versioned',
        targets: ['x86_64-unknown-linux-gnu.2.27'],
      },
    }),
  )
  try {
    const config = await readNapiConfig(packageJson)
    // `napi build -x` emits `versioned.linux-x64-gnu.node`, so the npm
    // package dir and the expected artifact name must derive from the base
    // triple too.
    t.is(config.targets[0].triple, 'x86_64-unknown-linux-gnu')
    t.is(config.targets[0].platformArchABI, 'linux-x64-gnu')
  } finally {
    await unlink(packageJson)
  }
})

test('should reject targets that normalize to the same artifact identity', async (t) => {
  const packageJson = join(tmpdir(), 'package-duplicate-targets.json')
  await writeFile(
    packageJson,
    JSON.stringify({
      name: '@napi-rs/duplicate',
      version: '0.0.0',
      napi: {
        binaryName: 'duplicate',
        targets: ['x86_64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu.2.27'],
      },
    }),
  )
  try {
    await t.throwsAsync(() => readNapiConfig(packageJson), {
      message: /produce the same linux-x64-gnu artifact set/,
    })
  } finally {
    await unlink(packageJson)
  }
})

test('should accept valid string and object napi.fallbackBinding config', async (t) => {
  const stringPkg = join(tmpdir(), 'package-fallback-string.json')
  const objectPkg = join(tmpdir(), 'package-fallback-object.json')
  await Promise.all([
    writeFile(
      stringPkg,
      JSON.stringify({
        name: '@napi-rs/fallback-string',
        version: '0.0.0',
        napi: {
          binaryName: 'fallback',
          fallbackBinding: './webcontainer-fallback.cjs',
        },
      }),
    ),
    writeFile(
      objectPkg,
      JSON.stringify({
        name: '@napi-rs/fallback-object',
        version: '0.0.0',
        napi: {
          binaryName: 'fallback',
          fallbackBinding: {
            specifier: './webcontainer-fallback.cjs',
            processVersion: 'webcontainer',
          },
        },
      }),
    ),
  ])
  try {
    const stringConfig = await readNapiConfig(stringPkg)
    t.is(stringConfig.fallbackBinding, './webcontainer-fallback.cjs')

    const objectConfig = await readNapiConfig(objectPkg)
    t.deepEqual(objectConfig.fallbackBinding, {
      specifier: './webcontainer-fallback.cjs',
      processVersion: 'webcontainer',
    })
  } finally {
    await Promise.all([unlink(stringPkg), unlink(objectPkg)])
  }
})

test('should reject invalid napi.fallbackBinding config', async (t) => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['empty string', '', /non-empty module specifier/],
    ['whitespace string', '   ', /non-empty module specifier/],
    ['number', 42, /non-empty string or an object/],
    ['array', ['./fallback.cjs'], /non-empty string or an object/],
    ['null', null, /non-empty string or an object/],
    ['missing specifier', {}, /specifier must be a non-empty string/],
    [
      'empty specifier',
      { specifier: '  ' },
      /specifier must be a non-empty string/,
    ],
    [
      'empty processVersion',
      { specifier: './fallback.cjs', processVersion: '' },
      /processVersion must be a non-empty string/,
    ],
    [
      'non-string processVersion',
      { specifier: './fallback.cjs', processVersion: 123 },
      /processVersion must be a non-empty string/,
    ],
  ]

  for (const [label, fallbackBinding, pattern] of cases) {
    const pkgPath = join(
      tmpdir(),
      `package-fallback-invalid-${label.replaceAll(/\s+/g, '-')}.json`,
    )
    await writeFile(
      pkgPath,
      JSON.stringify({
        name: '@napi-rs/fallback-invalid',
        version: '0.0.0',
        napi: {
          binaryName: 'fallback',
          fallbackBinding,
        },
      }),
    )
    try {
      await t.throwsAsync(
        () => readNapiConfig(pkgPath),
        { message: pattern },
        label,
      )
    } finally {
      await unlink(pkgPath)
    }
  }
})
