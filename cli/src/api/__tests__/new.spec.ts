import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { parse as parseToml } from '@std/toml'
import ava, { type TestFn } from 'ava'
import { load as yamlLoad } from 'js-yaml'

import { CLI_VERSION } from '../../utils/index.js'
import { newProject } from '../new.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
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

function resolvePnpmCli() {
  const launchers =
    process.platform === 'win32'
      ? ['pnpm.cmd', 'corepack.cmd']
      : ['pnpm', 'corepack']

  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    for (const launcher of launchers) {
      const launcherPath = join(pathEntry, launcher)
      if (!existsSync(launcherPath)) {
        continue
      }
      const resolvedLauncherPath = realpathSync(launcherPath)
      if (resolvedLauncherPath.endsWith('pnpm.js')) {
        return resolvedLauncherPath
      }
      const siblingPnpm = join(dirname(resolvedLauncherPath), 'pnpm.js')
      if (existsSync(siblingPnpm)) {
        return siblingPnpm
      }
      for (const packageName of ['pnpm', 'corepack']) {
        try {
          const packageJsonPath = require.resolve(
            `${packageName}/package.json`,
            {
              paths: [
                dirname(resolvedLauncherPath),
                join(dirname(resolvedLauncherPath), '..', 'lib'),
                dirname(process.execPath),
                join(dirname(process.execPath), '..', 'lib'),
              ],
            },
          )
          const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
          const bin =
            typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
          if (typeof bin === 'string') {
            return join(dirname(packageJsonPath), bin)
          }
        } catch {}
      }
    }
  }

  throw new Error('Could not resolve the pnpm Corepack entrypoint from PATH')
}

async function installAndRunGeneratedBuild(
  projectPath: string,
  packageManager: 'yarn' | 'pnpm',
  tmpDir: string,
) {
  const fakeCliDir = join(tmpDir, `${packageManager}-fake-cli`)
  const fakeCliBin = join(fakeCliDir, 'napi.cjs')
  const markerPath = join(tmpDir, `${packageManager}-build-args.json`)
  await mkdir(fakeCliDir, { recursive: true })
  await writeFile(
    join(fakeCliDir, 'package.json'),
    JSON.stringify({
      name: '@napi-rs/cli',
      version: CLI_VERSION,
      bin: {
        napi: './napi.cjs',
      },
    }),
  )
  await writeFile(
    fakeCliBin,
    `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.NAPI_NEW_TEST_MARKER, JSON.stringify(process.argv.slice(2)))
`,
  )
  await chmod(fakeCliBin, 0o755)

  const packageJsonPath = join(projectPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  packageJson.dependencies = {}
  packageJson.devDependencies = {
    '@napi-rs/cli': `file:${relative(projectPath, fakeCliDir).split(sep).join('/')}`,
  }
  delete packageJson.optionalDependencies
  packageJson.scripts = {
    build: packageJson.scripts.build,
  }
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

  const env = {
    ...process.env,
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    NAPI_NEW_TEST_MARKER: markerPath,
  }
  let executable: string
  let baseArgs: string[]
  if (packageManager === 'yarn') {
    const yarnVersion = packageJson.packageManager.replace(/^yarn@/, '')
    executable = process.execPath
    baseArgs = [
      join(projectPath, '.yarn', 'releases', `yarn-${yarnVersion}.cjs`),
    ]
    await execFileAsync(
      executable,
      [...baseArgs, 'install', '--mode=skip-build', '--no-immutable'],
      { cwd: projectPath, env },
    )
  } else {
    executable = process.execPath
    baseArgs = [resolvePnpmCli()]
    await execFileAsync(
      executable,
      [...baseArgs, 'install', '--ignore-scripts', '--offline'],
      { cwd: projectPath, env },
    )
  }
  await execFileAsync(
    executable,
    [...baseArgs, 'run', 'build', '--target', 'wasm32-wasip1'],
    { cwd: projectPath, env },
  )
  return JSON.parse(await readFile(markerPath, 'utf8')) as string[]
}

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
  t.false('browser' in pkgJson)
  t.false(pkgJson.files.includes('browser.js'))
  t.falsy(existsSync(join(projectPath, 'browser.js')))
  t.falsy(existsSync(join(projectPath, 'default-project.wasi-browser.js')))
  t.falsy(existsSync(join(projectPath, 'wasi-worker-browser.mjs')))
  t.falsy(existsSync(join(projectPath, 'wasi-worker.mjs')))
  const gitAttributes = await readFile(
    join(projectPath, '.gitattributes'),
    'utf-8',
  )
  t.false(gitAttributes.includes('default-project.wasi-browser.js'))
  t.false(gitAttributes.includes('default-project.wasi.cjs'))
  t.false(gitAttributes.includes('wasi-worker-browser.mjs'))
  t.false(gitAttributes.includes('wasi-worker.mjs'))
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

for (const packageManager of ['yarn', 'pnpm'] as const) {
  test.serial(
    `scaffold ${packageManager} project with threadless wasm32-wasip1`,
    async (t) => {
      const projectPath = join(
        t.context.tmpDir,
        `${packageManager}-threadless-wasi`,
      )
      const name = `${packageManager}-threadless-wasi`

      await newProject({
        path: projectPath,
        name,
        packageManager,
        targets: ['wasm32-wasip1'],
        enableDefaultTargets: false,
      })

      const pkgJson = JSON.parse(
        await readFile(join(projectPath, 'package.json'), 'utf-8'),
      )
      t.deepEqual(pkgJson.napi.targets, ['wasm32-wasip1'])
      t.is(pkgJson.devDependencies['@napi-rs/cli'], `^${CLI_VERSION}`)
      const lockfile =
        packageManager === 'yarn' ? 'yarn.lock' : 'pnpm-lock.yaml'
      t.false(existsSync(join(projectPath, lockfile)))
      t.is(pkgJson.browser, 'browser.js')
      t.true(pkgJson.files.includes('browser.js'))
      t.is(
        await readFile(join(projectPath, 'browser.js'), 'utf8'),
        `export * from '${name}-wasm32-wasip1'\n`,
      )
      t.false(existsSync(join(projectPath, `${name}.wasi.cjs`)))
      t.false(existsSync(join(projectPath, `${name}.wasi-browser.js`)))
      t.false(existsSync(join(projectPath, 'wasi-worker.mjs')))
      t.false(existsSync(join(projectPath, 'wasi-worker-browser.mjs')))
      const gitAttributesPath = join(projectPath, '.gitattributes')
      if (existsSync(gitAttributesPath)) {
        const gitAttributes = await readFile(gitAttributesPath, 'utf8')
        t.true(gitAttributes.includes(`${name}.wasip1.cjs`))
        t.true(gitAttributes.includes(`${name}.wasip1.d.cts`))
        t.true(gitAttributes.includes(`${name}.wasip1-browser.js`))
        t.true(gitAttributes.includes(`${name}.wasip1-deferred.js`))
        t.true(gitAttributes.includes(`${name}.wasip1-deferred.d.ts`))
        t.false(gitAttributes.includes(`${name}.wasi.cjs`))
      }

      const workflow = yamlLoad(
        await readFile(
          join(projectPath, '.github', 'workflows', 'CI.yml'),
          'utf8',
        ),
      ) as any
      const wasiBuilds = workflow.jobs.build.strategy.matrix.settings.filter(
        (setting: any) => setting.target.startsWith('wasm32-'),
      )
      t.deepEqual(
        wasiBuilds.map((setting: any) => setting.target),
        ['wasm32-wasip1'],
      )
      t.true(wasiBuilds[0].build.includes('--target wasm32-wasip1'))
      const downloadStep = workflow.jobs['test-wasi'].steps.find(
        (step: any) =>
          typeof step.uses === 'string' &&
          step.uses.startsWith('actions/download-artifact@'),
      )
      t.is(downloadStep.with.name, 'bindings-wasm32-wasip1')
      const wasmUpload = workflow.jobs.build.steps.find(
        (step: any) =>
          typeof step.uses === 'string' &&
          step.uses.startsWith('actions/upload-artifact@') &&
          typeof step.with?.path === 'string' &&
          step.with.path.includes('.wasm'),
      )
      for (const pattern of [
        'index.js',
        'browser.js',
        '*.wasi*.cjs',
        '*.wasi*.d.cts',
        '*.wasi*-browser.js',
        '*.wasi*-deferred.js',
        '*.wasi*-deferred.d.ts',
        'wasi-worker*.mjs',
      ]) {
        t.true(wasmUpload.with.path.includes(pattern))
      }
      const wasiTestStep = workflow.jobs['test-wasi'].steps.find(
        (step: any) => step.env?.NAPI_RS_FORCE_WASI !== undefined,
      )
      t.is(wasiTestStep.env.NAPI_RS_FORCE_WASI, 'true')
      if (packageManager === 'pnpm') {
        const buildSteps = workflow.jobs.build.steps
        const setupNodeX86 = buildSteps.find(
          (step: any) => step.name === 'Setup node x86',
        )
        t.is(
          setupNodeX86.if,
          "matrix.settings.target == 'i686-pc-windows-msvc'",
        )
        const nativeUpload = buildSteps.find(
          (step: any) => step.with?.path === '*.node',
        )
        t.is(
          nativeUpload.if,
          "${{ !startsWith(matrix.settings.target, 'wasm32-') }}",
        )
        const pnpmWasmUpload = buildSteps.find(
          (step: any) =>
            typeof step.with?.path === 'string' &&
            step.with.path.includes('*.wasm'),
        )
        t.is(
          pnpmWasmUpload.if,
          "${{ startsWith(matrix.settings.target, 'wasm32-') }}",
        )
      }
      const buildArgs = await installAndRunGeneratedBuild(
        projectPath,
        packageManager,
        t.context.tmpDir,
      )
      t.deepEqual(buildArgs.slice(0, 3), ['build', '--platform', '--release'])
      t.deepEqual(buildArgs.slice(-2), ['--target', 'wasm32-wasip1'])
      t.true(existsSync(join(projectPath, lockfile)))
    },
  )
}

test.serial(
  'scaffold both WASI flavors without CI output collisions',
  async (t) => {
    const projectPath = join(t.context.tmpDir, 'both-wasi-flavors')

    await newProject({
      path: projectPath,
      targets: ['wasm32-wasip1-threads', 'wasm32-wasip1'],
      enableDefaultTargets: false,
    })

    const pkgJson = JSON.parse(
      await readFile(join(projectPath, 'package.json'), 'utf8'),
    )
    t.deepEqual(pkgJson.napi.targets, [
      'wasm32-wasip1-threads',
      'wasm32-wasip1',
    ])
    const workflow = yamlLoad(
      await readFile(
        join(projectPath, '.github', 'workflows', 'CI.yml'),
        'utf8',
      ),
    ) as any
    const wasiBuilds = workflow.jobs.build.strategy.matrix.settings
      .filter((setting: any) => setting.target.startsWith('wasm32-'))
      .map((setting: any) => setting.target)
    t.deepEqual(wasiBuilds, ['wasm32-wasip1-threads', 'wasm32-wasip1'])
    t.deepEqual(workflow.jobs['test-wasi'].strategy.matrix.target, wasiBuilds)
    for (const generatedFile of [
      'index.js',
      'both-wasi-flavors.wasi.cjs',
      'both-wasi-flavors.wasi.d.cts',
      'both-wasi-flavors.wasi-browser.js',
      'both-wasi-flavors.wasip1.d.cts',
      'wasi-worker.mjs',
      'wasi-worker-browser.mjs',
    ]) {
      t.false(
        existsSync(join(projectPath, generatedFile)),
        `${generatedFile} should be supplied by its matrix build artifact`,
      )
    }
    const downloadStep = workflow.jobs['test-wasi'].steps.find(
      (step: any) =>
        typeof step.uses === 'string' &&
        step.uses.startsWith('actions/download-artifact@'),
    )
    t.is(downloadStep.with.name, 'bindings-${{ matrix.target }}')
  },
)

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
  t.is(pkgJson.browser, 'browser.js')
  t.true(pkgJson.files.includes('browser.js'))
  t.true(existsSync(join(projectPath, 'browser.js')))

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

test('aarch64-apple-darwin should keep test-macOS-windows-binding job', async (t) => {
  const projectPath = join(t.context.tmpDir, 'apple-silicon-only')
  const targets = ['aarch64-apple-darwin']

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
  t.truthy(yamlObject.jobs['test-macOS-windows-binding'])
  t.deepEqual(
    yamlObject.jobs['test-macOS-windows-binding'].strategy.matrix.settings.map(
      (setting: any) => setting.target,
    ),
    ['aarch64-apple-darwin'],
  )
  t.truthy(yamlObject.jobs.publish.needs.includes('test-macOS-windows-binding'))
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

test('should fail when git is unavailable', async (t) => {
  const projectPath = join(t.context.tmpDir, 'missing-git')
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/api/new.ts')).href

  const result = await new Promise<{
    code: number | null
    stderr: string
  }>((resolve) => {
    execFile(
      process.execPath,
      [
        '--import',
        '@oxc-node/core/register',
        '--input-type=module',
        '-e',
        `const { newProject } = await import(${JSON.stringify(moduleUrl)}); await newProject({ path: ${JSON.stringify(projectPath)}, enableDefaultTargets: true });`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: '',
        },
      },
      (error, _stdout, stderr) => {
        resolve({
          code:
            error && 'code' in error && typeof error.code === 'number'
              ? error.code
              : 0,
          stderr,
        })
      },
    )
  })

  t.not(result.code, 0)
  t.regex(
    result.stderr,
    /Git is not installed or not available in PATH\. Please install Git to continue\./,
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

test('should report colliding WASI target spellings', async (t) => {
  await t.throwsAsync(
    () =>
      newProject({
        path: join(t.context.tmpDir, 'colliding-wasi-aliases'),
        targets: ['wasm32-wasi-preview1-threads', 'wasm32-wasip1-threads'],
        enableDefaultTargets: false,
      }),
    {
      message:
        /Targets wasm32-wasi-preview1-threads and wasm32-wasip1-threads produce the same wasm32-wasi artifact set/,
    },
  )
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

for (const packageManager of ['yarn', 'pnpm'] as const) {
  test.serial(
    `create ${packageManager} project without type-def removes template declarations`,
    async (t) => {
      const projectPath = join(
        t.context.tmpDir,
        `${packageManager}-no-type-def`,
      )

      await newProject({
        path: projectPath,
        packageManager,
        enableDefaultTargets: true,
        enableTypeDef: false,
      })

      const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf-8')
      const cargoTomlData = parseToml(cargoToml) as any
      t.is(cargoTomlData.dependencies['napi-derive']['default-features'], false)
      t.false(
        cargoTomlData.dependencies['napi-derive'].features.includes('type-def'),
      )
      const packageJson = JSON.parse(
        await readFile(join(projectPath, 'package.json'), 'utf8'),
      )
      t.false('types' in packageJson)
      t.false('typings' in packageJson)
      t.false(
        packageJson.files.some((file: string) => /\.d\.[cm]?ts$/.test(file)),
      )
      t.false(existsSync(join(projectPath, 'index.d.ts')))
    },
  )
}

test('create WASI project without type-def emits executable root loaders', async (t) => {
  const projectPath = join(t.context.tmpDir, 'no-type-def-wasi')
  const binaryName = 'no-type-def-wasi'

  await newProject({
    path: projectPath,
    targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
    enableDefaultTargets: false,
    enableTypeDef: false,
  })

  const pkgJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf-8'),
  )
  t.is(pkgJson.main, 'index.js')
  t.true(pkgJson.files.includes('index.js'))
  t.false('types' in pkgJson)
  t.false('typings' in pkgJson)
  t.false(pkgJson.files.includes('index.d.ts'))
  t.false(existsSync(join(projectPath, 'index.d.ts')))

  const indexJs = await readFile(join(projectPath, 'index.js'), 'utf-8')
  t.notThrows(() => new Function(indexJs))
  const threadedLoader = indexJs.indexOf(`require('./${binaryName}.wasi.cjs')`)
  const threadlessLoader = indexJs.indexOf(
    `require('./${binaryName}.wasip1.cjs')`,
  )
  t.true(threadedLoader >= 0)
  t.true(threadlessLoader > threadedLoader)
  t.true(indexJs.includes(`require('${binaryName}-wasm32-wasi')`))
  t.true(indexJs.includes(`require('${binaryName}-wasm32-wasip1')`))
  t.true(indexJs.includes('module.exports = nativeBinding'))

  const browserJs = await readFile(join(projectPath, 'browser.js'), 'utf8')
  t.is(
    browserJs,
    `export * from '${binaryName}-wasm32-wasip1'\nexport { default } from '${binaryName}-wasm32-wasip1'\n`,
  )
  const browserPackageDir = join(
    projectPath,
    'node_modules',
    `${binaryName}-wasm32-wasip1`,
  )
  await mkdir(browserPackageDir, { recursive: true })
  await writeFile(
    join(browserPackageDir, 'package.json'),
    JSON.stringify({
      name: `${binaryName}-wasm32-wasip1`,
      type: 'module',
      exports: './index.js',
    }),
  )
  await writeFile(
    join(browserPackageDir, 'index.js'),
    'export default { answer: 42 }\n',
  )
  const executableBrowserEntry = join(projectPath, 'browser.mjs')
  await copyFile(join(projectPath, 'browser.js'), executableBrowserEntry)
  const browserBinding = await import(
    `${pathToFileURL(executableBrowserEntry).href}?test=${Date.now()}`
  )
  t.is(browserBinding.default.answer, 42)
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
