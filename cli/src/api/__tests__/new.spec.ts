import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { TestFn } from 'ava'
import { load as yamlLoad } from 'js-yaml'

import { newProject } from '../new.js'

const test = ava as TestFn<{
  tmpDir: string
}>

test.beforeEach(async (t) => {
  // Create a unique temp directory for tests
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `new-project-${timestamp}-${random}`,
  )
  t.context = { tmpDir }
})

test.afterEach.always(async (t) => {
  // Clean up any created directories
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('create a new project with default options', async (t) => {
  const projectPath = join(t.context.tmpDir, 'default-project')

  await newProject({
    path: projectPath,
    enableDefaultTargets: true,
  })

  t.true(existsSync(projectPath))
  t.true(existsSync(join(projectPath, 'package.json')))
  t.true(existsSync(join(projectPath, 'Cargo.toml')))
  t.true(existsSync(join(projectPath, 'src')))
  t.true(existsSync(join(projectPath, '.github', 'workflows', 'CI.yml')))

  // Check package.json
  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, 'default-project')
  t.is(pkgJson.napi.binaryName, 'default-project')
  t.is(pkgJson.license, 'MIT')
  t.truthy(pkgJson.engines.node)
  t.falsy(existsSync(join(projectPath, 'default-project.wasi-browser.js')))
  const gitAttributes = await readFile(
    join(projectPath, '.gitattributes'),
    'utf-8',
  )
  t.truthy(gitAttributes.includes('default-project.wasi-browser.js'))
  t.truthy(gitAttributes.includes('default-project.wasi.cjs'))
  t.truthy(gitAttributes.includes('wasi-worker-browser.mjs'))
  t.truthy(gitAttributes.includes('wasi-worker.mjs'))
  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  t.is(yamlObject.env.APP_NAME, 'default-project')
  t.falsy(yamlObject.jobs.publish.needs.includes('wasm32-wasip1-threads'))
  t.falsy(
    yamlObject.jobs['test-linux-binding'].strategy.matrix.target.includes(
      'aarch64-unknown-linux-musl',
    ),
  )
})

test('create a new project with custom name', async (t) => {
  const projectPath = join(t.context.tmpDir, 'custom-name-dir')

  await newProject({
    path: projectPath,
    name: '@my-scope/custom-package',
    enableDefaultTargets: true,
  })

  t.true(existsSync(projectPath))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, '@my-scope/custom-package')
  t.is(pkgJson.napi.binaryName, 'custom-package')

  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  // Verify that the package name was properly renamed to follow Rust naming conventions
  t.true(cargoToml.includes('name = "custom_package"'))
})

test('create a new project with custom path', async (t) => {
  const customPath = join(t.context.tmpDir, 'nested', 'folders', 'my-project')

  await newProject({
    path: customPath,
    enableDefaultTargets: true,
  })

  t.true(existsSync(customPath))
  t.true(existsSync(join(customPath, 'package.json')))

  const pkgJson = JSON.parse(
    await readFile(join(customPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, 'my-project')
})

test('create a new project with custom path and name', async (t) => {
  const projectPath = join(t.context.tmpDir, 'custom-dir')

  await newProject({
    path: projectPath,
    name: 'custom-project-name',
    enableDefaultTargets: true,
  })

  t.true(existsSync(projectPath))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, 'custom-project-name')
  t.is(pkgJson.napi.binaryName, 'custom-project-name')
})

test('create a new project with custom path, name, and targets', async (t) => {
  const projectPath = join(t.context.tmpDir, 'full-custom')
  const customTargets = [
    'x86_64-unknown-linux-gnu',
    'x86_64-apple-darwin',
    'aarch64-apple-darwin',
    'wasm32-wasip1-threads',
    'x86_64-unknown-freebsd',
  ]

  await newProject({
    path: projectPath,
    name: '@custom/full-project',
    targets: customTargets,
    enableDefaultTargets: false,
    license: 'Apache-2.0',
    minNodeApiVersion: 6,
  })

  t.true(existsSync(projectPath))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, '@custom/full-project')
  t.is(pkgJson.napi.binaryName, 'full-project')
  t.is(pkgJson.license, 'Apache-2.0')
  t.true(pkgJson.engines.node.includes('>= 14.0.0'))

  // Check that CI workflow only includes the specified targets
  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  t.true(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'x86_64-unknown-linux-gnu',
    ),
  )
  t.true(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'x86_64-apple-darwin',
    ),
  )
  t.true(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'aarch64-apple-darwin',
    ),
  )
  t.false(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'x86_64-pc-windows-msvc',
    ),
  )
  t.true(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'wasm32-wasip1-threads',
    ),
  )
  t.truthy(yamlObject.jobs['build-freebsd'])
  t.truthy(yamlObject.jobs['test-wasi'])
  t.falsy(
    yamlObject.jobs['test-macOS-windows-binding'].strategy.matrix.settings.some(
      (setting: any) => setting.target === 'x86_64-pc-windows-msvc',
    ),
  )
  t.truthy(
    yamlObject.jobs['test-macOS-windows-binding'].strategy.matrix.settings.some(
      (setting: any) => setting.target === 'aarch64-apple-darwin',
    ),
  )
})

test('non Windows and macOS targets should remove test-macOS-windows-binding job', async (t) => {
  const projectPath = join(t.context.tmpDir, 'no-windows-macos')
  const targets = [
    'x86_64-unknown-linux-gnu',
    'aarch64-unknown-linux-gnu',
    'wasm32-wasip1-threads',
    'x86_64-unknown-freebsd',
  ]

  await newProject({
    path: projectPath,
    targets,
    enableDefaultTargets: false,
  })

  t.true(existsSync(projectPath))

  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  t.falsy(yamlObject.jobs['test-macOS-windows-binding'])
  t.falsy(yamlObject.jobs.publish.needs.includes('test-macOS-windows-binding'))
})

test('should remove test-linux-binding job if no Linux targets are enabled', async (t) => {
  const projectPath = join(t.context.tmpDir, 'no-linux')
  const targets = ['x86_64-apple-darwin', 'aarch64-apple-darwin']

  await newProject({
    path: projectPath,
    targets,
    enableDefaultTargets: false,
  })

  t.true(existsSync(projectPath))

  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  t.falsy(yamlObject.jobs['test-linux-binding'])
  t.falsy(yamlObject.jobs.publish.needs.includes('test-linux-binding'))
})

test('should fail when no path is provided', async (t) => {
  await t.throwsAsync(
    async () => {
      await newProject({
        enableDefaultTargets: true,
      })
    },
    { message: /Please provide the path as the argument/ },
  )
})

test('should fail when path already exists and is not empty', async (t) => {
  const projectPath = join(t.context.tmpDir, 'existing-project')

  // Create directory with a file
  await rm(projectPath, { recursive: true, force: true }).catch(() => {})
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(projectPath, { recursive: true })
  writeFileSync(join(projectPath, 'existing-file.txt'), 'content')

  await t.throwsAsync(
    async () => {
      await newProject({
        path: projectPath,
        enableDefaultTargets: true,
      })
    },
    { message: /already exists and it's not empty/ },
  )
})

test('should fail when path is a file', async (t) => {
  const filePath = join(t.context.tmpDir, 'file.txt')

  // Create a file
  const { writeFileSync } = await import('node:fs')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(t.context.tmpDir, { recursive: true })
  writeFileSync(filePath, 'content')

  await t.throwsAsync(
    async () => {
      await newProject({
        path: filePath,
        enableDefaultTargets: true,
      })
    },
    { message: /already exists and it's not a directory/ },
  )
})

test('dry run should not create any files', async (t) => {
  const projectPath = join(t.context.tmpDir, 'dry-run-project')

  await newProject({
    path: projectPath,
    name: 'dry-run-test',
    enableDefaultTargets: true,
    dryRun: true,
  })

  t.false(existsSync(projectPath))
})

test('create project without GitHub Actions', async (t) => {
  const projectPath = join(t.context.tmpDir, 'no-github-actions')

  await newProject({
    path: projectPath,
    enableDefaultTargets: true,
    enableGithubActions: false,
  })

  t.true(existsSync(projectPath))
  t.true(existsSync(join(projectPath, 'package.json')))
  t.false(existsSync(join(projectPath, '.github')))
})

test('create a new project with pnpm package manager', async (t) => {
  const projectPath = join(t.context.tmpDir, 'pnpm-project')

  await newProject({
    path: projectPath,
    name: 'pnpm-test-project',
    packageManager: 'pnpm',
    enableDefaultTargets: true,
  })

  t.true(existsSync(projectPath))
  t.true(existsSync(join(projectPath, 'package.json')))
  t.true(existsSync(join(projectPath, 'Cargo.toml')))

  // Check package.json
  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, 'pnpm-test-project')
  t.is(pkgJson.napi.binaryName, 'pnpm-test-project')

  // Verify that the Cargo.toml has the correct sanitized name
  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  t.true(cargoToml.includes('name = "pnpm_test_project"'))

  // Check for pnpm-specific files or configurations if any
  // The template might have different structure for pnpm
})

test('create a new project with pnpm and custom name', async (t) => {
  const projectPath = join(t.context.tmpDir, 'pnpm-custom-name')

  await newProject({
    path: projectPath,
    name: '@my-org/custom-pnpm-package',
    packageManager: 'pnpm',
    enableDefaultTargets: true,
  })

  t.true(existsSync(projectPath))
  t.true(existsSync(join(projectPath, 'package.json')))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, '@my-org/custom-pnpm-package')
  t.is(pkgJson.napi.binaryName, 'custom-pnpm-package')

  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  t.true(cargoToml.includes('name = "custom_pnpm_package"'))
})

test('create a new project with pnpm and custom path/name combination', async (t) => {
  const projectPath = join(t.context.tmpDir, 'deep', 'nested', 'pnpm-dir')

  await newProject({
    path: projectPath,
    name: '@scoped/pnpm-custom-name',
    packageManager: 'pnpm',
    enableDefaultTargets: true,
    license: 'Apache-2.0',
  })

  t.true(existsSync(projectPath))
  t.true(existsSync(join(projectPath, 'package.json')))
  t.true(existsSync(join(projectPath, 'Cargo.toml')))

  // Check package.json
  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.name, '@scoped/pnpm-custom-name')
  t.is(pkgJson.napi.binaryName, 'pnpm-custom-name')
  t.is(pkgJson.license, 'Apache-2.0')

  // Check Cargo.toml has sanitized name
  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  t.true(cargoToml.includes('name = "pnpm_custom_name"'))
})

test('should fail when no targets are enabled', async (t) => {
  const projectPath = join(t.context.tmpDir, 'no-targets')

  await t.throwsAsync(
    async () => {
      await newProject({
        path: projectPath,
        enableDefaultTargets: false,
        enableAllTargets: false,
        targets: [],
      })
    },
    { message: /At least one target must be enabled/ },
  )
})
