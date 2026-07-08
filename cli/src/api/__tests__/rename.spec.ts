import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'
import { load as yamlLoad } from 'js-yaml'

import { renameProject } from '../rename.js'

const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'

const test = ava as TestFn<{
  tmpDir: string
}>

test.beforeEach((t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  t.context = {
    tmpDir: join(
      tmpdir(),
      'napi-rs-test',
      `rename-project-${timestamp}-${random}`,
    ),
  }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

async function createFixtureProject(
  cwd: string,
  options: {
    packageJson: Record<string, unknown>
    cargoPackageName: string
    configPath?: string
    configData?: Record<string, unknown>
  },
) {
  await mkdir(join(cwd, '.github', 'workflows'), { recursive: true })

  await writeFile(
    join(cwd, 'package.json'),
    `${JSON.stringify(options.packageJson, null, 2)}\n`,
  )
  await writeFile(
    join(cwd, 'Cargo.toml'),
    `[package]\nname = "${options.cargoPackageName}"\n`,
  )
  await writeFile(
    join(cwd, '.github', 'workflows', 'CI.yml'),
    'env:\n  APP_NAME: foo\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
  )
  await writeFile(
    join(cwd, '.gitattributes'),
    'foo.wasi-browser.js linguist-generated=true\nfoo.wasi.cjs linguist-generated=true\n',
  )
  await writeFile(join(cwd, 'foo.wasi-browser.js'), 'browser binding\n')
  await writeFile(join(cwd, 'foo.wasi.cjs'), 'node binding\n')

  if (options.configPath && options.configData) {
    await writeFile(
      join(cwd, options.configPath),
      `${JSON.stringify(options.configData, null, 2)}\n`,
    )
  }
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, path)))
    } else {
      files.push(path)
    }
  }
  return files
}

test('omitting binaryName keeps existing wasi artifact names and binary references', async (t) => {
  const projectPath = join(t.context.tmpDir, 'artifact-rename')

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: projectPath,
    name: 'renamed',
  })

  const packageJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
  )
  const cargoToml = await readFile(join(projectPath, 'Cargo.toml'), 'utf8')
  const gitAttributes = await readFile(
    join(projectPath, '.gitattributes'),
    'utf8',
  )
  const ciYaml = yamlLoad(
    await readFile(join(projectPath, '.github', 'workflows', 'CI.yml'), 'utf8'),
  ) as any

  t.is(packageJson.name, 'renamed')
  t.is(packageJson.napi.binaryName, 'foo')
  t.is(packageJson.napi.packageName, '@scope/original')
  t.true(cargoToml.includes('name = "foo"'))
  t.true(existsSync(join(projectPath, 'foo.wasi-browser.js')))
  t.true(existsSync(join(projectPath, 'foo.wasi.cjs')))
  t.false(existsSync(join(projectPath, 'undefined.wasi-browser.js')))
  t.false(existsSync(join(projectPath, 'undefined.wasi.cjs')))
  t.true(gitAttributes.includes('foo.wasi-browser.js'))
  t.true(gitAttributes.includes('foo.wasi.cjs'))
  t.false(gitAttributes.includes('undefined.wasi-browser.js'))
  t.false(gitAttributes.includes('undefined.wasi.cjs'))
  t.is(ciYaml.env.APP_NAME, 'foo')
})

test('omitting binaryName preserves separated napi config fields', async (t) => {
  const projectPath = join(t.context.tmpDir, 'config-rename')

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
    },
    cargoPackageName: 'foo',
    configPath: 'napi.json',
    configData: {
      binaryName: 'foo',
      packageName: '@scope/original',
    },
  })

  await renameProject({
    cwd: projectPath,
    configPath: 'napi.json',
    name: 'renamed',
  })

  const config = JSON.parse(
    await readFile(join(projectPath, 'napi.json'), 'utf8'),
  )

  t.is(config.binaryName, 'foo')
  t.is(config.packageName, '@scope/original')
  t.true(existsSync(join(projectPath, 'foo.wasi-browser.js')))
  t.true(existsSync(join(projectPath, 'foo.wasi.cjs')))
  t.false(existsSync(join(projectPath, 'undefined.wasi-browser.js')))
  t.false(existsSync(join(projectPath, 'undefined.wasi.cjs')))
})

test('repository updates package.json when provided', async (t) => {
  const projectPath = join(t.context.tmpDir, 'repository-rename')

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      repository: {
        type: 'git',
        url: 'https://example.com/old.git',
      },
      napi: {
        binaryName: 'foo',
        packageName: '@scope/original',
      },
    },
    cargoPackageName: 'foo',
  })

  await renameProject({
    cwd: projectPath,
    name: 'renamed',
    repository: 'https://example.com/new.git',
  })

  const packageJson = JSON.parse(
    await readFile(join(projectPath, 'package.json'), 'utf8'),
  )

  t.is(packageJson.name, 'renamed')
  t.is(packageJson.repository.url, 'https://example.com/new.git')
  t.is(packageJson.repository.type, 'git')
})

test('binaryName renames every configured WASI artifact and package reference', async (t) => {
  const projectPath = join(t.context.tmpDir, 'wasi-artifact-rename')
  const oldName = 'foo'
  const newName = 'renamed'
  const threadedSuffixes = [
    'wasm32-wasi.wasm',
    'wasm32-wasi.debug.wasm',
    'wasi.cjs',
    'wasi.d.cts',
    'wasi-browser.js',
  ]
  const threadlessSuffixes = [
    'wasm32-wasip1.wasm',
    'wasm32-wasip1.debug.wasm',
    'wasm32-wasip1.wasm.d.ts',
    'wasm32-wasip1.wasm.d.mts',
    'wasm32-wasip1.workerd.mjs',
    'wasm32-wasip1.workerd.d.mts',
    'wasip1.cjs',
    'wasip1.d.cts',
    'wasip1-browser.js',
    'wasip1-deferred.js',
    'wasip1-deferred.d.ts',
  ]
  const managedSuffixes = [
    'wasm',
    'debug.wasm',
    ...threadedSuffixes,
    ...threadlessSuffixes,
  ]
  const oldManagedFiles = managedSuffixes.map(
    (suffix) => `${oldName}.${suffix}`,
  )
  const newManagedFiles = managedSuffixes.map(
    (suffix) => `${newName}.${suffix}`,
  )
  const allOldReferences = oldManagedFiles.join('\n')
  const artifactContent = (file: string) => {
    if (file.endsWith('.wasm')) {
      return 'wasm artifact'
    }
    const metadata = file.endsWith('.cjs')
      ? `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
          version: 2,
          rootEntry: 'index.cjs',
          exports: [],
          managedRootEntries: [
            'browser.js',
            'index.cjs',
            `${oldName}.wasm`,
            `${oldName}.debug.wasm`,
          ],
        })}\n`
      : ''
    return `${metadata}${allOldReferences}\n`
  }

  await createFixtureProject(projectPath, {
    packageJson: {
      name: 'original',
      main: 'index.cjs',
      browser: 'browser.js',
      files: oldManagedFiles,
      exports: {
        './workerd': `./${oldName}.wasm32-wasip1.workerd.mjs`,
        './wasm': `./${oldName}.wasm32-wasip1.wasm`,
      },
      napi: {
        binaryName: oldName,
        packageName: '@scope/original',
        targets: ['wasm32-wasip1', 'wasm32-wasip1-threads'],
      },
    },
    cargoPackageName: oldName,
  })

  await Promise.all([
    ...oldManagedFiles.map((file) =>
      writeFile(join(projectPath, file), artifactContent(file)),
    ),
    writeFile(join(projectPath, 'index.cjs'), `${allOldReferences}\n`),
    writeFile(join(projectPath, 'browser.js'), `${allOldReferences}\n`),
    writeFile(
      join(projectPath, '.gitattributes'),
      `${oldManagedFiles
        .map((file) => `${file} linguist-generated=true`)
        .join('\n')}\n`,
    ),
  ])

  for (const platformArchABI of ['wasm32-wasi', 'wasm32-wasip1']) {
    const packageDirectory = join(projectPath, 'npm', platformArchABI)
    await mkdir(packageDirectory, { recursive: true })
    const packageFiles = (
      platformArchABI === 'wasm32-wasi' ? threadedSuffixes : threadlessSuffixes
    ).map((suffix) => `${oldName}.${suffix}`)
    await Promise.all([
      ...packageFiles.map((file) =>
        writeFile(join(packageDirectory, file), artifactContent(file)),
      ),
      writeFile(
        join(packageDirectory, 'package.json'),
        `${JSON.stringify(
          {
            name: `@scope/original-${platformArchABI}`,
            main:
              platformArchABI === 'wasm32-wasi'
                ? `${oldName}.wasi.cjs`
                : `${oldName}.wasip1.cjs`,
            files: packageFiles,
            exports:
              platformArchABI === 'wasm32-wasip1'
                ? {
                    './workerd': `./${oldName}.wasip1-deferred.js`,
                    './wasm': `./${oldName}.wasm32-wasip1.wasm`,
                  }
                : undefined,
          },
          null,
          2,
        )}\n`,
      ),
    ])
  }

  await renameProject({
    cwd: projectPath,
    binaryName: newName,
  })

  const files = await listFiles(projectPath)
  for (const oldFile of oldManagedFiles) {
    t.false(
      files.some((file) => file.split(/[\\/]/).includes(oldFile)),
      `stale filename: ${oldFile}`,
    )
  }
  for (const newFile of newManagedFiles) {
    t.true(existsSync(join(projectPath, newFile)), newFile)
  }
  for (const platformArchABI of ['wasm32-wasi', 'wasm32-wasip1']) {
    const packageDirectory = join(projectPath, 'npm', platformArchABI)
    const suffixes =
      platformArchABI === 'wasm32-wasi' ? threadedSuffixes : threadlessSuffixes
    for (const suffix of suffixes) {
      t.true(
        existsSync(join(packageDirectory, `${newName}.${suffix}`)),
        `${platformArchABI}: ${newName}.${suffix}`,
      )
    }
  }

  for (const file of files) {
    if (file.endsWith('.wasm')) {
      continue
    }
    const content = await readFile(join(projectPath, file), 'utf8')
    for (const oldFile of oldManagedFiles) {
      t.false(content.includes(oldFile), `${file}: ${oldFile}`)
    }
  }
})
