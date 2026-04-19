import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { universalizeBinaries } from '../universalize.js'

const test = ava as TestFn<{
  tmpDir: string
  cwd: string
  packageJsonPath: string
}>

test.beforeEach(async (t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `universalize-${timestamp}-${random}`,
  )
  const cwd = join(tmpDir, 'cwd')
  const packageJsonDir = join(tmpDir, 'pkg')
  const packageJsonPath = join(packageJsonDir, 'package.json')

  await mkdir(cwd, { recursive: true })
  await mkdir(packageJsonDir, { recursive: true })

  t.context = {
    tmpDir,
    cwd,
    packageJsonPath,
  }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('resolves an absolute packageJsonPath instead of joining it with cwd', async (t) => {
  const { cwd, packageJsonPath } = t.context

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: 'universalize-repro',
        napi: {
          binaryName: 'universalize-repro',
          targets: ['universal-apple-darwin'],
        },
      },
      null,
      2,
    )}\n`,
  )

  const error = await t.throwsAsync(() =>
    universalizeBinaries({
      cwd,
      packageJsonPath,
    }),
  )

  t.truthy(error)
  t.notRegex(error.message, new RegExp(`${cwd}.+package\\.json`))

  if (process.platform === 'darwin') {
    t.regex(error.message, /Some binary files were not found:/)
  } else {
    t.is(
      error.message,
      `'universal' arch for platform '${process.platform}' not found in config!`,
    )
  }
})

test('throws when lipo fails to create a universal binary', async (t) => {
  if (process.platform !== 'darwin') {
    t.pass()
    return
  }

  const { cwd, packageJsonPath, tmpDir } = t.context
  const outputDir = join(tmpDir, 'out')
  const outputPath = join(outputDir, 'universalize-repro.darwin-universal.node')

  await mkdir(outputDir, { recursive: true })
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: 'universalize-repro',
        napi: {
          binaryName: 'universalize-repro',
          targets: ['universal-apple-darwin'],
        },
      },
      null,
      2,
    )}\n`,
  )

  await writeFile(
    join(outputDir, 'universalize-repro.darwin-x64.node'),
    'not a mach-o\n',
  )
  await writeFile(
    join(outputDir, 'universalize-repro.darwin-arm64.node'),
    'not a mach-o\n',
  )

  const error = await t.throwsAsync(() =>
    universalizeBinaries({
      cwd,
      packageJsonPath,
      outputDir,
    }),
  )

  t.truthy(error)
  t.regex(error.message, /Failed to create universal binary/)
  t.false(existsSync(outputPath))
})
