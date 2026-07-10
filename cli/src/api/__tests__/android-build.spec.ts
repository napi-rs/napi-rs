import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { buildProject } from '../build.js'

const test = ava as TestFn<{ tmpDir: string; projectDir: string }>

test.beforeEach(async (t) => {
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `android-build-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  const projectDir = join(tmpDir, 'project')

  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(
    join(projectDir, 'Cargo.toml'),
    `[package]
name = "android_build"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "android-build"
path = "src/main.rs"
`,
  )
  await writeFile(join(projectDir, 'src', 'main.rs'), 'fn main() {}\n')
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'android-build', version: '0.1.0' }),
  )
  t.context = { tmpDir, projectDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test.serial(
  'requires ANDROID_NDK_LATEST_HOME before spawning an Android cross-build',
  async (t) => {
    const { projectDir } = t.context
    const originalCargo = process.env.CARGO
    const originalNdkHome = process.env.ANDROID_NDK_LATEST_HOME
    process.env.CARGO = join(projectDir, 'cargo-must-not-run')
    delete process.env.ANDROID_NDK_LATEST_HOME
    try {
      const error = await t.throwsAsync(() =>
        buildProject({
          cwd: projectDir,
          target: 'aarch64-linux-android',
          bin: 'android-build',
        }),
      )

      t.regex(error!.message, /ANDROID_NDK_LATEST_HOME.+required/)
    } finally {
      if (originalCargo === undefined) {
        delete process.env.CARGO
      } else {
        process.env.CARGO = originalCargo
      }
      if (originalNdkHome === undefined) {
        delete process.env.ANDROID_NDK_LATEST_HOME
      } else {
        process.env.ANDROID_NDK_LATEST_HOME = originalNdkHome
      }
    }
  },
)

test.serial(
  'skips host Android NDK setup when building with cross',
  async (t) => {
    const { projectDir } = t.context
    const originalCargo = process.env.CARGO
    const originalNdkHome = process.env.ANDROID_NDK_LATEST_HOME
    const cargoPath = join(projectDir, 'cross-must-be-spawned')
    process.env.CARGO = cargoPath
    delete process.env.ANDROID_NDK_LATEST_HOME
    try {
      const { task } = await buildProject({
        cwd: projectDir,
        target: 'aarch64-linux-android',
        bin: 'android-build',
        useCross: true,
      })
      const error = await t.throwsAsync(task)

      t.is((error!.cause as NodeJS.ErrnoException).path, cargoPath)
      t.notRegex(error!.message, /ANDROID_NDK_LATEST_HOME/)
    } finally {
      if (originalCargo === undefined) {
        delete process.env.CARGO
      } else {
        process.env.CARGO = originalCargo
      }
      if (originalNdkHome === undefined) {
        delete process.env.ANDROID_NDK_LATEST_HOME
      } else {
        process.env.ANDROID_NDK_LATEST_HOME = originalNdkHome
      }
    }
  },
)
