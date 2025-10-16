import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { load as yamlLoad } from 'js-yaml'

import { newProject } from '../new.js'

interface TestContext {
  tmpDir: string
}

let context: TestContext

beforeEach(async () => {
  // Create a unique temp directory for tests
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `new-project-${timestamp}-${random}`,
  )
  context = { tmpDir }
})

afterEach(async () => {
  // Clean up any created directories
  if (existsSync(context.tmpDir)) {
    await rm(context.tmpDir, { recursive: true, force: true })
  }
})

test('create a new project with default options', async () => {
  const projectPath = join(context.tmpDir, 'default-project')

  await newProject({
    path: projectPath,
    enableDefaultTargets: true,
  })

  assert.ok(existsSync(projectPath))
  assert.ok(existsSync(join(projectPath, 'package.json')))
  assert.ok(existsSync(join(projectPath, 'Cargo.toml')))
  assert.ok(existsSync(join(projectPath, 'src')))
  assert.ok(existsSync(join(projectPath, '.github', 'workflows', 'CI.yml')))

  // Check package.json
  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, 'default-project')
  assert.strictEqual(pkgJson.napi.binaryName, 'default-project')
  assert.strictEqual(pkgJson.license, 'MIT')
  assert.ok(pkgJson.engines.node)
  assert.ok(!(existsSync(join(projectPath, 'default-project.wasi-browser.js'))))
  const gitAttributes = await readFile(
    join(projectPath, '.gitattributes'),
    'utf-8',
  )
  assert.ok(gitAttributes.includes('default-project.wasi-browser.js'))
  assert.ok(gitAttributes.includes('default-project.wasi.cjs'))
  assert.ok(gitAttributes.includes('wasi-worker-browser.mjs'))
  assert.ok(gitAttributes.includes('wasi-worker.mjs'))
  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  assert.strictEqual(yamlObject.env.APP_NAME, 'default-project')
  assert.ok(!(yamlObject.jobs.publish.needs.includes('wasm32-wasip1-threads')))
  assert.ok(!(
    yamlObject.jobs['test-linux-binding'].strategy.matrix.target.includes(
      'aarch64-unknown-linux-musl',
    )),
  )
})

test('create a new project with custom name', async () => {
  const projectPath = join(context.tmpDir, 'custom-name-dir')

  await newProject({
    path: projectPath,
    name: '@my-scope/custom-package',
    enableDefaultTargets: true,
  })

  assert.ok(existsSync(projectPath))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, '@my-scope/custom-package')
  assert.strictEqual(pkgJson.napi.binaryName, 'custom-package')

  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  // Verify that the package name was properly renamed to follow Rust naming conventions
  assert.ok(cargoToml.includes('name = "custom_package"'))
})

test('create a new project with custom path', async () => {
  const customPath = join(context.tmpDir, 'nested', 'folders', 'my-project')

  await newProject({
    path: customPath,
    enableDefaultTargets: true,
  })

  assert.ok(existsSync(customPath))
  assert.ok(existsSync(join(customPath, 'package.json')))

  const pkgJson = JSON.parse(
    await readFile(join(customPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, 'my-project')
})

test('create a new project with custom path and name', async () => {
  const projectPath = join(context.tmpDir, 'custom-dir')

  await newProject({
    path: projectPath,
    name: 'custom-project-name',
    enableDefaultTargets: true,
  })

  assert.ok(existsSync(projectPath))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, 'custom-project-name')
  assert.strictEqual(pkgJson.napi.binaryName, 'custom-project-name')
})

test('create a new project with custom path, name, and targets', async (t) => {
  const projectPath = join(context.tmpDir, 'full-custom')
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

  assert.ok(existsSync(projectPath))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, '@custom/full-project')
  assert.strictEqual(pkgJson.napi.binaryName, 'full-project')
  assert.strictEqual(pkgJson.license, 'Apache-2.0')
  assert.ok(pkgJson.engines.node.includes('>= 14.0.0'))

  // Check that CI workflow only includes the specified targets
  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  assert.ok(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'x86_64-unknown-linux-gnu',
    ),
  )
  assert.ok(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'x86_64-apple-darwin',
    ),
  )
  assert.ok(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'aarch64-apple-darwin',
    ),
  )
  assert.strictEqual(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'x86_64-pc-windows-msvc',
    ),
    false,
  )
  assert.ok(
    yamlObject.jobs.build.strategy.matrix.settings.some(
      (setting: any) => setting.target === 'wasm32-wasip1-threads',
    ),
  )
  assert.ok(yamlObject.jobs['build-freebsd'])
  assert.ok(yamlObject.jobs['test-wasi'])
  assert.ok(!(
    yamlObject.jobs['test-macOS-windows-binding'].strategy.matrix.settings.some(
      (setting: any)) => setting.target === 'x86_64-pc-windows-msvc',
    ),
  )
  assert.ok(
    yamlObject.jobs['test-macOS-windows-binding'].strategy.matrix.settings.some(
      (setting: any) => setting.target === 'aarch64-apple-darwin',
    ),
  )
})

test('non Windows and macOS targets should remove test-macOS-windows-binding job', async () => {
  const projectPath = join(context.tmpDir, 'no-windows-macos')
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

  assert.ok(existsSync(projectPath))

  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  assert.ok(!(yamlObject.jobs['test-macOS-windows-binding']))
  assert.ok(!(yamlObject.jobs.publish.needs.includes('test-macOS-windows-binding')))
})

test('should remove test-linux-binding job if no Linux targets are enabled', async () => {
  const projectPath = join(context.tmpDir, 'no-linux')
  const targets = ['x86_64-apple-darwin', 'aarch64-apple-darwin']

  await newProject({
    path: projectPath,
    targets,
    enableDefaultTargets: false,
  })

  assert.ok(existsSync(projectPath))

  const ciYaml = await readFile(
    join(projectPath, '.github', 'workflows', 'CI.yml'),
    'utf-8',
  )
  const yamlObject = yamlLoad(ciYaml) as any
  assert.ok(!(yamlObject.jobs['test-linux-binding']))
  assert.ok(!(yamlObject.jobs.publish.needs.includes('test-linux-binding')))
})

test('should fail when no path is provided', async () => {
  await assert.rejects(
    async () => {
      await newProject({
        enableDefaultTargets: true,
      })
    },
    { message: /Please provide the path as the argument/ },
  )
})

test('should fail when path already exists and is not empty', async () => {
  const projectPath = join(context.tmpDir, 'existing-project')

  // Create directory with a file
  await rm(projectPath, { recursive: true, force: true }).catch(() => {})
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(projectPath, { recursive: true })
  writeFileSync(join(projectPath, 'existing-file.txt'), 'content')

  await assert.rejects(
    async () => {
      await newProject({
        path: projectPath,
        enableDefaultTargets: true,
      })
    },
    { message: /already exists and it's not empty/ },
  )
})

test('should fail when path is a file', async () => {
  const filePath = join(context.tmpDir, 'file.txt')

  // Create a file
  const { writeFileSync } = await import('node:fs')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(context.tmpDir, { recursive: true })
  writeFileSync(filePath, 'content')

  await assert.rejects(
    async () => {
      await newProject({
        path: filePath,
        enableDefaultTargets: true,
      })
    },
    { message: /already exists and it's not a directory/ },
  )
})

test('dry run should not create any files', async () => {
  const projectPath = join(context.tmpDir, 'dry-run-project')

  await newProject({
    path: projectPath,
    name: 'dry-run-test',
    enableDefaultTargets: true,
    dryRun: true,
  })

  assert.strictEqual(existsSync(projectPath), false)
})

test('create project without GitHub Actions', async () => {
  const projectPath = join(context.tmpDir, 'no-github-actions')

  await newProject({
    path: projectPath,
    enableDefaultTargets: true,
    enableGithubActions: false,
  })

  assert.ok(existsSync(projectPath))
  assert.ok(existsSync(join(projectPath, 'package.json')))
  assert.strictEqual(existsSync(join(projectPath, '.github')), false)
})

test('create a new project with pnpm package manager', async () => {
  const projectPath = join(context.tmpDir, 'pnpm-project')

  await newProject({
    path: projectPath,
    name: 'pnpm-test-project',
    packageManager: 'pnpm',
    enableDefaultTargets: true,
  })

  assert.ok(existsSync(projectPath))
  assert.ok(existsSync(join(projectPath, 'package.json')))
  assert.ok(existsSync(join(projectPath, 'Cargo.toml')))

  // Check package.json
  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, 'pnpm-test-project')
  assert.strictEqual(pkgJson.napi.binaryName, 'pnpm-test-project')

  // Verify that the Cargo.toml has the correct sanitized name
  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  assert.ok(cargoToml.includes('name = "pnpm_test_project"'))

  // Check for pnpm-specific files or configurations if any
  // The template might have different structure for pnpm
})

test('create a new project with pnpm and custom name', async () => {
  const projectPath = join(context.tmpDir, 'pnpm-custom-name')

  await newProject({
    path: projectPath,
    name: '@my-org/custom-pnpm-package',
    packageManager: 'pnpm',
    enableDefaultTargets: true,
  })

  assert.ok(existsSync(projectPath))
  assert.ok(existsSync(join(projectPath, 'package.json')))

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, '@my-org/custom-pnpm-package')
  assert.strictEqual(pkgJson.napi.binaryName, 'custom-pnpm-package')

  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  assert.ok(cargoToml.includes('name = "custom_pnpm_package"'))
})

test('create a new project with pnpm and custom path/name combination', async () => {
  const projectPath = join(context.tmpDir, 'deep', 'nested', 'pnpm-dir')

  await newProject({
    path: projectPath,
    name: '@scoped/pnpm-custom-name',
    packageManager: 'pnpm',
    enableDefaultTargets: true,
    license: 'Apache-2.0',
  })

  assert.ok(existsSync(projectPath))
  assert.ok(existsSync(join(projectPath, 'package.json')))
  assert.ok(existsSync(join(projectPath, 'Cargo.toml')))

  // Check package.json
  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  assert.strictEqual(pkgJson.name, '@scoped/pnpm-custom-name')
  assert.strictEqual(pkgJson.napi.binaryName, 'pnpm-custom-name')
  assert.strictEqual(pkgJson.license, 'Apache-2.0')

  // Check Cargo.toml has sanitized name
  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
  assert.ok(cargoToml.includes('name = "pnpm_custom_name"'))
})

test('should fail when no targets are enabled', async () => {
  const projectPath = join(context.tmpDir, 'no-targets')

  await assert.rejects(
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
