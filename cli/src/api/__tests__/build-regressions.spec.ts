import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { buildProject, generateTypeDef } from '../build.js'

const test = ava as TestFn<{
  tmpDir: string
  projectDir: string
  typeDefDir: string
}>

test.beforeEach(async (t) => {
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `build-regressions-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  const projectDir = join(tmpDir, 'project')
  const typeDefDir = join(projectDir, 'type-def')

  await mkdir(typeDefDir, { recursive: true })
  t.context = { tmpDir, projectDir, typeDefDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

async function writeMixedTargetProject(projectDir: string) {
  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(
    join(projectDir, 'Cargo.toml'),
    `[package]
name = "build_regression"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[[bin]]
name = "selected-bin"
path = "src/main.rs"
`,
  )
  await writeFile(join(projectDir, 'src', 'lib.rs'), 'pub fn library() {}\n')
  await writeFile(join(projectDir, 'src', 'main.rs'), 'fn main() {}\n')
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'build-regression',
      version: '0.1.0',
      napi: { binaryName: 'build-regression' },
    }),
  )
}

test.serial(
  '`--bin` copies the selected executable from a mixed cdylib/bin crate',
  async (t) => {
    const { projectDir } = t.context
    await writeMixedTargetProject(projectDir)

    const outputs = await (async () => {
      const originalCargo = process.env.CARGO
      delete process.env.CARGO
      try {
        return await (
          await buildProject({
            cwd: projectDir,
            bin: 'selected-bin',
            outputDir: 'dist',
          })
        ).task
      } finally {
        if (originalCargo === undefined) {
          delete process.env.CARGO
        } else {
          process.env.CARGO = originalCargo
        }
      }
    })()

    const executableName =
      process.platform === 'win32' ? 'selected-bin.exe' : 'selected-bin'
    const executablePath = join(projectDir, 'dist', executableName)

    t.deepEqual(outputs, [{ kind: 'exe', path: executablePath }])
    t.true(existsSync(executablePath))
    t.false(existsSync(join(projectDir, 'dist', 'build-regression.node')))
  },
)

test.serial(
  'an explicit dtsHeaderFile takes precedence over config and inline headers',
  async (t) => {
    const { projectDir, typeDefDir } = t.context
    await Promise.all([
      writeFile(join(projectDir, 'explicit-header.d.ts'), '// explicit\n'),
      writeFile(join(projectDir, 'config-header.d.ts'), '// config file\n'),
      writeFile(
        join(typeDefDir, 'value.type'),
        '{"kind":"fn","name":"value","def":"function value(): void"}\n',
      ),
    ])

    const { dts } = await generateTypeDef({
      cwd: projectDir,
      typeDefDir,
      dtsHeaderFile: 'explicit-header.d.ts',
      configDtsHeaderFile: 'config-header.d.ts',
      dtsHeader: '// explicit inline\n',
      configDtsHeader: '// config inline\n',
    })

    t.true(dts.startsWith('// explicit\n'))
    t.false(dts.includes('// config file'))
    t.false(dts.includes('// explicit inline'))
    t.false(dts.includes('// config inline'))
    t.true(dts.includes('function value(): void'))
  },
)
