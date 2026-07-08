import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { exec, execSync, spawnSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { join as posixJoin, sep as posixSep } from 'node:path/posix'
import { sep as win32Sep } from 'node:path/win32'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ava, { type ExecutionContext, type TestFn } from 'ava'

import {
  buildProject,
  collectStaleWasiBuildOutputNames,
  createArtifactDestinationName,
  createWasiBrowserEntry,
  createWasiCompilerFlags,
  createWasiDeferredBindingTypeDef,
  generateTypeDef,
  getCargoDependencyGraphFingerprint,
  getTypeDefCacheFolder,
  napiCrossToolchainEnvs,
  prepareWasiBindingTypeDef,
  removeWasmCustomSection,
  selectWasiBrowserTarget,
  validateCrossCompileFlags,
  validateNapiCrossSupport,
  verifyWasiReactor,
  writeJsBinding,
} from '../build.js'
import {
  DEFAULT_TYPE_DEF_HEADER,
  getSystemDefaultTarget,
  parseTriple,
} from '../../utils/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

const test = ava as TestFn<{
  tmpDir: string
  projectDir: string
  typeDefDir: string
}>

test.beforeEach(async (t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = posixJoin(
    tmpdir(),
    'napi-rs-test',
    `build-spec-${timestamp}-${random}`,
  )
  const projectDir = posixJoin(tmpDir, 'project')
  const typeDefDir = posixJoin(projectDir, 'target', 'type-def')

  await mkdir(typeDefDir, { recursive: true })

  t.context = { tmpDir, projectDir, typeDefDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('build pipeline generates bindings and artifacts', async (t) => {
  const { projectDir, typeDefDir } = t.context
  const crateName = 'build_integration'
  const binaryName = 'build-integration'
  const packageName = 'build-integration'
  const version = '0.1.0'
  const target = getSystemDefaultTarget()

  const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
    win32Sep,
    posixSep,
  )

  await mkdir(join(projectDir, 'src'), { recursive: true })

  const cargoToml = `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}" }
napi-derive = { path = "${napiDerivePath}" }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`

  await writeFile(join(projectDir, 'Cargo.toml'), cargoToml)
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: [target.triple],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(projectDir, 'build.rs'),
    'fn main() {\n    napi_build::setup();\n}\n',
  )
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  )

  const buildCmd = `cargo build --target ${target.triple}`

  await new Promise<void>((resolve, reject) => {
    const child = exec(buildCmd, {
      cwd: projectDir,
      env: { ...process.env, NAPI_TYPE_DEF_TMP_FOLDER: typeDefDir },
    })
    child.stderr?.on('data', (data) => {
      console.error(data.toString())
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`cargo build exited with code ${code ?? 'null'}`))
      }
    })
    child.on('error', reject)
  })

  const files = await readdir(typeDefDir)
  t.true(files.length > 0, 'type definition files should be generated')

  const { exports, dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
  })

  t.true(exports.includes('sum'), 'generateTypeDef should expose napi exports')

  const jsBinding = await writeJsBinding({
    platform: true,
    idents: exports,
    binaryName,
    packageName,
    version,
    outputDir: projectDir,
  })

  t.truthy(jsBinding)
  t.is(jsBinding?.path, join(projectDir, 'index.js'))

  const libName = crateName.replace(/-/g, '_')
  const srcName =
    target.platform === 'darwin'
      ? `lib${libName}.dylib`
      : target.platform === 'win32'
        ? `${libName}.dll`
        : `lib${libName}.so`
  const profile = 'debug'
  const srcPath = join(projectDir, 'target', target.triple, profile, srcName)
  t.true(existsSync(srcPath), 'compiled artifact should exist')

  const destName = `${binaryName}.${target.platformArchABI}.${srcName.endsWith('.wasm') ? 'wasm' : 'node'}`
  const destPath = join(projectDir, destName)
  await copyFile(srcPath, destPath)
  t.true(existsSync(destPath), 'artifact should be copied to output directory')

  const nodeStat = await stat(destPath)
  t.true(nodeStat.size > 0)

  t.regex(dts, /export declare function sum\(a: number, b: number\): number/)

  const jsPath = join(projectDir, 'index.js')
  t.true(existsSync(jsPath))
  const jsContent = await readFile(jsPath, 'utf-8')
  t.regex(jsContent, /module\.exports\.sum = nativeBinding\.sum/)
})

test('generateTypeDef preserves deterministic file order', async (t) => {
  const { projectDir, typeDefDir } = t.context

  await mkdir(join(typeDefDir, 'nested'), { recursive: true })
  await writeFile(
    join(typeDefDir, 'b.type'),
    '{"kind":"fn","name":"zeta","def":"function zeta(): void"}\n',
  )
  await writeFile(
    join(typeDefDir, 'a.type'),
    '{"kind":"fn","name":"alpha","def":"function alpha(): void"}\n',
  )

  const { exports, dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
  })

  t.deepEqual(exports, ['alpha', 'zeta'])
  t.true(
    dts.indexOf('function alpha(): void') <
      dts.indexOf('function zeta(): void'),
  )
})

test('type definition cache isolates effective Cargo build configurations', async (t) => {
  const { projectDir } = t.context
  const targetDir = join(projectDir, 'target')
  const manifestPath = join(projectDir, 'Cargo.toml')
  const crateName = 'cache_identity'
  const baseOptions = {
    targetDir,
    crateName,
    manifestPath,
    targetTriple: 'x86_64-unknown-linux-gnu',
    profile: 'dev',
  }
  const folderFor = (
    overrides: Partial<Parameters<typeof getTypeDefCacheFolder>[0]> = {},
  ) => getTypeDefCacheFolder({ ...baseOptions, ...overrides })

  const nativeFolder = folderFor()
  const wasiFolder = folderFor({ targetTriple: 'wasm32-wasip1-threads' })
  const releaseFolder = folderFor({ profile: 'release' })
  const featureFolder = folderFor({ features: ['native-lifecycle'] })
  const allFeaturesFolder = folderFor({ allFeatures: true })
  const noDefaultFeaturesFolder = folderFor({ noDefaultFeatures: true })
  const cargoOptionFolder = folderFor({
    cargoOptions: ['--config', 'build.rustflags=["--cfg=from-cargo-option"]'],
  })
  const cargoConfigFolder = folderFor({
    cargoConfig: [
      [join(projectDir, '.cargo', 'config.toml'), 'config-content-a'],
    ],
  })
  const rustCfgFolder = folderFor({
    rustFlags: { RUSTFLAGS: '--cfg native_lifecycle' },
  })
  const profileEnvFolder = folderFor({
    cargoProfileEnv: { CARGO_PROFILE_DEV_DEBUG_ASSERTIONS: 'false' },
  })
  const dependencyGraphFolder = folderFor({
    cargoDependencyGraph: 'dependency-graph-a',
  })

  for (const configuredFolder of [
    wasiFolder,
    releaseFolder,
    featureFolder,
    allFeaturesFolder,
    noDefaultFeaturesFolder,
    cargoOptionFolder,
    cargoConfigFolder,
    rustCfgFolder,
    profileEnvFolder,
    dependencyGraphFolder,
  ]) {
    t.not(configuredFolder, nativeFolder)
  }
  t.is(
    folderFor({ features: ['feature-b', 'feature-a'] }),
    folderFor({ features: ['feature-a,feature-b'] }),
  )
  t.is(
    folderFor({
      cargoProfileEnv: {
        CARGO_PROFILE_DEV_OPT_LEVEL: '1',
        CARGO_PROFILE_DEV_DEBUG_ASSERTIONS: 'false',
      },
    }),
    folderFor({
      cargoProfileEnv: {
        CARGO_PROFILE_DEV_DEBUG_ASSERTIONS: 'false',
        CARGO_PROFILE_DEV_OPT_LEVEL: '1',
      },
    }),
  )
  t.is(
    folderFor({
      cargoConfig: [
        [join(projectDir, '.cargo', 'config.toml'), 'config-content-a'],
        [join(projectDir, '.cargo', 'target.toml'), 'target-content'],
      ],
    }),
    folderFor({
      cargoConfig: [
        [join(projectDir, '.cargo', 'target.toml'), 'target-content'],
        [join(projectDir, '.cargo', 'config.toml'), 'config-content-a'],
      ],
    }),
  )
  t.not(
    cargoConfigFolder,
    folderFor({
      cargoConfig: [
        [join(projectDir, '.cargo', 'config.toml'), 'config-content-b'],
      ],
    }),
  )
  t.not(
    dependencyGraphFolder,
    folderFor({ cargoDependencyGraph: 'dependency-graph-b' }),
  )

  await mkdir(nativeFolder, { recursive: true })
  await writeFile(
    join(nativeFolder, crateName),
    '{"kind":"fn","name":"nativeLifecycle","def":"function nativeLifecycle(): void"}\n',
  )
  await mkdir(wasiFolder, { recursive: true })
  await writeFile(
    join(wasiFolder, crateName),
    '{"kind":"fn","name":"wasiOnly","def":"function wasiOnly(): void"}\n',
  )
  await mkdir(rustCfgFolder, { recursive: true })
  await writeFile(
    join(rustCfgFolder, crateName),
    '{"kind":"fn","name":"cfgOnly","def":"function cfgOnly(): void"}\n',
  )

  const wasiTypeDef = await generateTypeDef({
    typeDefDir: wasiFolder,
    cwd: projectDir,
  })
  t.regex(wasiTypeDef.dts, /function wasiOnly\(\): void/)
  const cfgTypeDef = await generateTypeDef({
    typeDefDir: rustCfgFolder,
    cwd: projectDir,
  })
  t.regex(cfgTypeDef.dts, /function cfgOnly\(\): void/)

  const returnedNativeFolder = folderFor()
  t.is(returnedNativeFolder, nativeFolder)
  const { dts } = await generateTypeDef({
    typeDefDir: returnedNativeFolder,
    cwd: projectDir,
  })
  t.regex(dts, /function nativeLifecycle\(\): void/)
  t.notRegex(dts, /wasiOnly|cfgOnly/)
})

test('Cargo dependency graph fingerprints are deterministic', (t) => {
  const metadataFor = (reverse: boolean, includeDependency: boolean) => {
    const rootPackage = {
      id: 'root-package',
      manifest_path: '/workspace/root/Cargo.toml',
      features: { default: ['feature-b', 'feature-a'] },
      dependencies: includeDependency
        ? [
            {
              name: 'dependency',
              source: null,
              req: '^1.0.0',
              kind: null,
              rename: null,
              optional: false,
              uses_default_features: true,
              features: reverse
                ? ['feature-b', 'feature-a']
                : ['feature-a', 'feature-b'],
              target: null,
              registry: null,
            },
          ]
        : [],
    }
    const dependencyPackage = {
      id: 'dependency-package',
      manifest_path: '/workspace/dependency/Cargo.toml',
      features: {},
      dependencies: [],
    }
    const rootNode = {
      id: rootPackage.id,
      dependencies: includeDependency ? [dependencyPackage.id] : [],
      deps: includeDependency
        ? [
            {
              name: 'dependency',
              pkg: dependencyPackage.id,
              dep_kinds: reverse
                ? [
                    { kind: 'build', target: null },
                    { kind: null, target: null },
                  ]
                : [
                    { kind: null, target: null },
                    { kind: 'build', target: null },
                  ],
            },
          ]
        : [],
      features: reverse
        ? ['feature-b', 'feature-a']
        : ['feature-a', 'feature-b'],
    }
    const dependencyNode = {
      id: dependencyPackage.id,
      dependencies: [],
      deps: [],
      features: [],
    }
    const packages = includeDependency
      ? [rootPackage, dependencyPackage]
      : [rootPackage]
    const nodes = includeDependency ? [rootNode, dependencyNode] : [rootNode]
    if (reverse) {
      packages.reverse()
      nodes.reverse()
    }
    return {
      packages,
      resolve: { root: rootPackage.id, nodes },
    } as unknown as Parameters<typeof getCargoDependencyGraphFingerprint>[0]
  }

  const fingerprint = getCargoDependencyGraphFingerprint(
    metadataFor(false, true),
    'root-package',
  )
  t.is(
    getCargoDependencyGraphFingerprint(metadataFor(true, true), 'root-package'),
    fingerprint,
  )
  t.not(
    getCargoDependencyGraphFingerprint(
      metadataFor(false, false),
      'root-package',
    ),
    fingerprint,
  )
})

test.serial(
  'CLI type definition cache isolates Cargo config files and profile env',
  async (t) => {
    const { projectDir } = t.context
    const crateName = 'type_def_cache_e2e'
    const target = getSystemDefaultTarget()
    const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
      win32Sep,
      posixSep,
    )
    const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
      win32Sep,
      posixSep,
    )
    const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
      win32Sep,
      posixSep,
    )
    const configPath = join(projectDir, '.cargo', 'config.toml')
    const typeDefPath = join(projectDir, 'generated', 'types', 'index.d.ts')
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.startsWith('CARGO_PROFILE_'),
      ),
    )
    const cliPath = join(repoRoot, 'cli', 'cli.mjs')

    await mkdir(join(projectDir, 'src'), { recursive: true })
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      join(projectDir, 'Cargo.toml'),
      `[package]
name = "${crateName}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}" }
napi-derive = { path = "${napiDerivePath}" }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`,
    )
    await writeFile(
      join(projectDir, 'package.json'),
      `${JSON.stringify(
        {
          name: crateName,
          version: '0.1.0',
          napi: {
            binaryName: crateName,
            targets: [target.triple],
          },
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(
      join(projectDir, 'build.rs'),
      'fn main() {\n  napi_build::setup();\n}\n',
    )
    await writeFile(
      join(projectDir, 'src', 'lib.rs'),
      `#![allow(unexpected_cfgs)]

use napi_derive::napi;

#[cfg(cache_config_a)]
#[napi]
pub fn cargo_config_a() {}

#[cfg(cache_config_b)]
#[napi]
pub fn cargo_config_b() {}

#[cfg(debug_assertions)]
#[napi]
pub fn debug_assertions_enabled() {}

#[cfg(not(debug_assertions))]
#[napi]
pub fn debug_assertions_disabled() {}
`,
    )

    const writeCargoConfig = (cfg: string) =>
      writeFile(configPath, `[build]\nrustflags = ["--cfg", "${cfg}"]\n`)
    const runBuild = (
      cargoProfileEnv: Record<string, string> = {},
      dts = join('generated', 'types', 'index.d.ts'),
    ) =>
      spawnSync(
        process.execPath,
        [
          cliPath,
          'build',
          '--cwd',
          projectDir,
          '--target',
          target.triple,
          '--dts',
          dts,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...cleanEnv, ...cargoProfileEnv },
          maxBuffer: 20 * 1024 * 1024,
        },
      )
    const expectBuild = (
      cargoProfileEnv: Record<string, string> = {},
      dts?: string,
    ) => {
      const result = runBuild(cargoProfileEnv, dts)
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
    }
    const expectTypeDef = async (included: string[], excluded: string[]) => {
      const source = await readFile(typeDefPath, 'utf8')
      for (const name of included) {
        t.true(source.includes(`function ${name}(`), name)
      }
      for (const name of excluded) {
        t.false(source.includes(`function ${name}(`), name)
      }
    }
    const cacheFolderCount = async () =>
      (
        await readdir(join(projectDir, 'target', 'napi-rs'), {
          withFileTypes: true,
        })
      ).filter((entry) => entry.isDirectory()).length

    await writeCargoConfig('cache_config_a')
    expectBuild()
    await expectTypeDef(
      ['cargoConfigA', 'debugAssertionsEnabled'],
      ['cargoConfigB', 'debugAssertionsDisabled'],
    )
    t.is(await cacheFolderCount(), 1)

    await writeCargoConfig('cache_config_b')
    expectBuild()
    await expectTypeDef(
      ['cargoConfigB', 'debugAssertionsEnabled'],
      ['cargoConfigA', 'debugAssertionsDisabled'],
    )
    t.is(await cacheFolderCount(), 2)

    expectBuild({ CARGO_PROFILE_DEV_DEBUG_ASSERTIONS: 'false' })
    await expectTypeDef(
      ['cargoConfigB', 'debugAssertionsDisabled'],
      ['cargoConfigA', 'debugAssertionsEnabled'],
    )
    t.is(await cacheFolderCount(), 3)

    await writeCargoConfig('cache_config_a')
    expectBuild()
    await expectTypeDef(
      ['cargoConfigA', 'debugAssertionsEnabled'],
      ['cargoConfigB', 'debugAssertionsDisabled'],
    )
    t.is(await cacheFolderCount(), 3)

    const generatedArtifact = (await readdir(projectDir)).find(
      (file) =>
        file.startsWith(`${crateName}.`) &&
        (file.endsWith('.node') || file.endsWith('.wasm')),
    )
    t.truthy(generatedArtifact)
    const generatedArtifactPath = join(projectDir, generatedArtifact!)
    await writeFile(generatedArtifactPath, 'prior native artifact')
    const blockedParent = join(projectDir, 'blocked-type-dir')
    await writeFile(blockedParent, 'not a directory')
    const failedWrite = runBuild({}, join('blocked-type-dir', 'index.d.ts'))
    const failedOutput = `${failedWrite.stdout}\n${failedWrite.stderr}`
    t.not(failedWrite.status, 0, failedOutput)
    t.regex(failedOutput, /Failed to write type def file/)
    t.is(await readFile(generatedArtifactPath, 'utf8'), 'prior native artifact')
  },
)

test.serial(
  'type definition cache drops exports from removed napi-derived dependencies',
  async (t) => {
    const { projectDir } = t.context
    const target = getSystemDefaultTarget()
    const dependencyDir = join(projectDir, 'removed-dependency')
    const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
      win32Sep,
      posixSep,
    )
    const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
      win32Sep,
      posixSep,
    )
    const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
      win32Sep,
      posixSep,
    )
    const rootManifest = (includeDependency: boolean) => `[package]
name = "type_def_dependency_removal"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}" }
napi-derive = { path = "${napiDerivePath}" }
${includeDependency ? 'removed-napi-dependency = { path = "./removed-dependency" }\n' : ''}
[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`
    const rootSource = (includeDependency: boolean) => `use napi_derive::napi;
${includeDependency ? 'pub use removed_napi_dependency::removed_dependency_export;\n' : ''}
#[napi]
pub fn retained_export() {}
`

    await Promise.all([
      mkdir(join(projectDir, 'src'), { recursive: true }),
      mkdir(join(dependencyDir, 'src'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(projectDir, 'Cargo.toml'), rootManifest(true)),
      writeFile(
        join(projectDir, 'package.json'),
        `${JSON.stringify(
          {
            name: 'type-def-dependency-removal',
            version: '0.1.0',
            napi: {
              binaryName: 'type-def-dependency-removal',
              targets: [target.triple],
            },
          },
          null,
          2,
        )}\n`,
      ),
      writeFile(
        join(projectDir, 'build.rs'),
        'fn main() {\n  napi_build::setup();\n}\n',
      ),
      writeFile(join(projectDir, 'src', 'lib.rs'), rootSource(true)),
      writeFile(
        join(dependencyDir, 'Cargo.toml'),
        `[package]
name = "removed-napi-dependency"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["rlib", "cdylib"]

[dependencies]
napi = { path = "${napiPath}" }
napi-derive = { path = "${napiDerivePath}" }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`,
      ),
      writeFile(
        join(dependencyDir, 'build.rs'),
        'fn main() {\n  napi_build::setup();\n}\n',
      ),
      writeFile(
        join(dependencyDir, 'src', 'lib.rs'),
        `use napi_derive::napi;

#[napi]
pub fn removed_dependency_export() {}
`,
      ),
    ])

    const runBuild = async () => {
      const { task } = await buildProject({
        cwd: projectDir,
        target: target.triple,
        platform: true,
        jsBinding: 'index.cjs',
        dts: 'index.d.ts',
      })
      await task
    }
    const readOutputs = () =>
      Promise.all([
        readFile(join(projectDir, 'index.d.ts'), 'utf8'),
        readFile(join(projectDir, 'index.cjs'), 'utf8'),
      ])
    const cacheFolderCount = async () =>
      (
        await readdir(join(projectDir, 'target', 'napi-rs'), {
          withFileTypes: true,
        })
      ).filter((entry) => entry.isDirectory()).length

    await runBuild()
    const [initialDeclarations, initialLoader] = await readOutputs()
    t.regex(initialDeclarations, /function removedDependencyExport\(\): void/)
    t.regex(initialDeclarations, /function retainedExport\(\): void/)
    t.regex(
      initialLoader,
      /module\.exports\.removedDependencyExport = nativeBinding\.removedDependencyExport/,
    )
    t.is(await cacheFolderCount(), 1)

    await runBuild()
    t.is(await cacheFolderCount(), 1)

    await Promise.all([
      writeFile(join(projectDir, 'Cargo.toml'), rootManifest(false)),
      writeFile(join(projectDir, 'src', 'lib.rs'), rootSource(false)),
    ])
    await runBuild()

    const [declarations, loader] = await readOutputs()
    t.regex(declarations, /function retainedExport\(\): void/)
    t.notRegex(declarations, /removedDependencyExport/)
    t.notRegex(loader, /removedDependencyExport/)
    t.is(await cacheFolderCount(), 2)
  },
)

test('should throw on emnapi version mismatch in wasm build', async (t) => {
  const { projectDir } = t.context
  const crateName = 'wasm_version_check'
  const binaryName = 'wasm-version-check'
  const packageName = 'wasm-version-check'
  const version = '0.1.0'

  const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
    win32Sep,
    posixSep,
  )

  await mkdir(join(projectDir, 'src'), { recursive: true })

  const cargoToml = `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}", features = ["noop"] }
napi-derive = { path = "${napiDerivePath}", features = ["noop"] }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`

  await writeFile(join(projectDir, 'Cargo.toml'), cargoToml)
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: ['wasm32-wasi-preview1-threads'],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(projectDir, 'build.rs'),
    'fn main() {\n    napi_build::setup();\n}\n',
  )
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  )

  // Create fake @emnapi/core and @emnapi/runtime with mismatched versions
  const fakeVersion = '0.0.0-fake'
  for (const pkg of ['@emnapi/core', '@emnapi/runtime']) {
    const pkgDir = join(projectDir, 'node_modules', pkg)
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkg, version: fakeVersion, main: 'index.js' }),
    )
    await writeFile(
      join(pkgDir, 'index.js'),
      `module.exports = { version: "${fakeVersion}" }`,
    )
  }

  const error = await t.throwsAsync(() =>
    buildProject({
      target: 'wasm32-wasi-preview1-threads',
      cwd: projectDir,
    }),
  )

  t.truthy(error)
  t.regex(error!.message, /emnapi version mismatch/)
})

test('validateCrossCompileFlags rejects combining two cross-compilation mechanisms', (t) => {
  t.throws(
    () => validateCrossCompileFlags({ useCross: true, crossCompile: true }),
    { message: /`--use-cross`.+`--cross-compile`.+cannot be used together/ },
  )
  t.throws(
    () => validateCrossCompileFlags({ useCross: true, useNapiCross: true }),
    { message: /`--use-cross`.+`--use-napi-cross`.+cannot be used together/ },
  )
  t.throws(
    () => validateCrossCompileFlags({ useNapiCross: true, crossCompile: true }),
    {
      message: /`--use-napi-cross`.+`--cross-compile`.+cannot be used together/,
    },
  )
  t.throws(
    () =>
      validateCrossCompileFlags({
        useCross: true,
        useNapiCross: true,
        crossCompile: true,
      }),
    {
      message:
        /`--use-cross`.+`--use-napi-cross`.+`--cross-compile`.+cannot be used together/,
    },
  )
})

test('validateCrossCompileFlags allows a single cross-compilation mechanism', (t) => {
  t.notThrows(() => validateCrossCompileFlags({}))
  t.notThrows(() => validateCrossCompileFlags({ useCross: true }))
  t.notThrows(() => validateCrossCompileFlags({ crossCompile: true }))
  t.notThrows(() => validateCrossCompileFlags({ useNapiCross: true }))
})

test('validateCrossCompileFlags rejects windows-gnu targets with `--cross-compile`', (t) => {
  const windowsGnuError =
    /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnu/
  // `cargo-xwin` is only used on non-Windows hosts, where it silently
  // no-ops for `windows-gnu` targets, so the combination must be rejected.
  const gnuError = t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'linux',
      ),
    { message: windowsGnuError },
  )
  // `windows-gnu` links with a mingw-w64 GCC toolchain.
  t.regex(gnuError!.message, /x86_64-w64-mingw32-gcc/)
  t.regex(gnuError!.message, /LIBNODE_PATH/)
  t.regex(gnuError!.message, /x86_64-pc-windows-msvc/)
  t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'darwin',
      ),
    { message: windowsGnuError },
  )
  // `gnullvm`-flavored triples take the same broken `cargo-xwin` route, but
  // link with an LLVM toolchain (llvm-mingw), not the mingw-w64 GCC one.
  const gnullvmError = t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnullvm' },
        'linux',
      ),
    {
      message:
        /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnullvm/,
    },
  )
  t.regex(gnullvmError!.message, /llvm-mingw/)
  t.notRegex(gnullvmError!.message, /mingw32-gcc/)
  t.regex(gnullvmError!.message, /LIBNODE_PATH/)
  t.regex(gnullvmError!.message, /x86_64-pc-windows-msvc/)
  // The target can also come from `CARGO_BUILD_TARGET`; the check is fully
  // synchronous, so the environment is mutated and restored without any
  // interleaving point another concurrently running test could observe.
  const originalCargoBuildTarget = process.env.CARGO_BUILD_TARGET
  try {
    process.env.CARGO_BUILD_TARGET = 'x86_64-pc-windows-gnu'
    t.throws(() => validateCrossCompileFlags({ crossCompile: true }, 'linux'), {
      message: windowsGnuError,
    })
  } finally {
    if (originalCargoBuildTarget === undefined) {
      delete process.env.CARGO_BUILD_TARGET
    } else {
      process.env.CARGO_BUILD_TARGET = originalCargoBuildTarget
    }
  }
})

test('validateCrossCompileFlags allows `--cross-compile` for non windows-gnu targets', (t) => {
  // MSVC targets are exactly what `cargo-xwin` supports.
  for (const target of [
    'x86_64-pc-windows-msvc',
    'aarch64-pc-windows-msvc',
    'i686-pc-windows-msvc',
    'x86_64-unknown-linux-gnu',
    'aarch64-apple-darwin',
  ]) {
    t.notThrows(() =>
      validateCrossCompileFlags({ crossCompile: true, target }, 'linux'),
    )
  }
  // On a Windows host `--cross-compile` never routes through `cargo-xwin`
  // (it falls back to a plain `cargo build`), so windows-gnu stays allowed.
  t.notThrows(() =>
    validateCrossCompileFlags(
      { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
      'win32',
    ),
  )
  // Without `--cross-compile` the target is none of this check's business.
  t.notThrows(() =>
    validateCrossCompileFlags({ target: 'x86_64-pc-windows-gnu' }, 'linux'),
  )
})

test('validateCrossCompileFlags rejects watch mode combined with cross builds', (t) => {
  t.throws(() => validateCrossCompileFlags({ watch: true, useCross: true }), {
    message: /`--watch` cannot be used with `--use-cross`/,
  })
  t.throws(
    () => validateCrossCompileFlags({ watch: true, crossCompile: true }),
    { message: /`--watch` cannot be used with `--cross-compile`/ },
  )
  t.notThrows(() => validateCrossCompileFlags({ watch: true }))
  t.notThrows(() =>
    validateCrossCompileFlags({ watch: true, useNapiCross: true }),
  )
})

test('validateNapiCrossSupport rejects unsupported hosts', (t) => {
  t.throws(
    () =>
      validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'darwin', 'arm64'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.throws(
    () => validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'win32', 'x64'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.throws(
    () =>
      validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'linux', 'ia32'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.notThrows(() =>
    validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'linux', 'x64'),
  )
  t.notThrows(() =>
    validateNapiCrossSupport('x86_64-unknown-linux-gnu', 'linux', 'arm64'),
  )
})

test('validateNapiCrossSupport rejects unsupported target triples', (t) => {
  t.throws(
    () => validateNapiCrossSupport('x86_64-unknown-linux-musl', 'linux', 'x64'),
    {
      message:
        /`--use-napi-cross` does not support the target x86_64-unknown-linux-musl/,
    },
  )
  t.throws(
    () =>
      validateNapiCrossSupport('riscv64gc-unknown-linux-gnu', 'linux', 'arm64'),
    {
      message:
        /`--use-napi-cross` does not support the target riscv64gc-unknown-linux-gnu/,
    },
  )
  for (const triple of [
    'x86_64-unknown-linux-gnu',
    'aarch64-unknown-linux-gnu',
    'armv7-unknown-linux-gnueabihf',
    's390x-unknown-linux-gnu',
    'powerpc64le-unknown-linux-gnu',
  ]) {
    t.notThrows(() => validateNapiCrossSupport(triple, 'linux', 'x64'))
    t.notThrows(() => validateNapiCrossSupport(triple, 'linux', 'arm64'))
  }
})

const napiCrossToolchainPath = posixJoin(
  '/home/user/.napi-rs/cross-toolchain/1.0.0',
  'aarch64-unknown-linux-gnu',
)
const napiCrossDownloadedSysroot = join(
  napiCrossToolchainPath,
  'aarch64-unknown-linux-gnu',
  'sysroot',
)

test('napiCrossToolchainEnvs points the build at the downloaded toolchain', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin' },
  )

  t.is(
    envs.CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER,
    join(napiCrossToolchainPath, 'bin', 'aarch64-unknown-linux-gnu-gcc'),
  )
  t.is(envs.TARGET_SYSROOT, napiCrossDownloadedSysroot)
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, `--sysroot=${napiCrossDownloadedSysroot}`)
  t.is(envs.PATH, `${napiCrossToolchainPath}/bin:/usr/bin`)
  // gcc is the default compiler, so no clang-specific flags are set.
  t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'))
  t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'))
})

test('napiCrossToolchainEnvs respects a user-provided TARGET_SYSROOT', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_SYSROOT: '/opt/custom-sysroot' },
  )

  // The user's value wins: it is not overridden...
  t.false(Object.hasOwn(envs, 'TARGET_SYSROOT'))
  // ...and the derived flags use it.
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, '--sysroot=/opt/custom-sysroot')
})

test('napiCrossToolchainEnvs treats an empty TARGET_SYSROOT as unset', (t) => {
  // `setEnvIfNotExists` uses falsy semantics (`!process.env[env]`), so a
  // present-but-empty `TARGET_SYSROOT` still gets the downloaded sysroot
  // written to the build environment — the flags derived from the effective
  // sysroot must follow the same rule instead of producing `--sysroot=`.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_SYSROOT: '' },
  )

  t.is(envs.TARGET_SYSROOT, napiCrossDownloadedSysroot)
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, `--sysroot=${napiCrossDownloadedSysroot}`)
})

test('napiCrossToolchainEnvs derives clang flags from the effective sysroot', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {
      PATH: '/usr/bin',
      // Present-but-empty values must fall back to the downloaded sysroot.
      TARGET_SYSROOT: '',
      TARGET_CC: 'clang',
      TARGET_CXX: 'clang++',
      TARGET_CFLAGS: '-O2',
    },
  )

  t.is(
    envs.TARGET_CFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} -O2`,
  )
  t.is(
    envs.TARGET_CXXFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `,
  )
})

test('napiCrossToolchainEnvs sets a bare toolchain PATH when the env has none', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {},
  )

  // No `:undefined` tail when the provided env has no PATH at all.
  t.is(envs.PATH, `${napiCrossToolchainPath}/bin`)
})

test('napiCrossToolchainEnvs recognizes path-qualified, prefixed and versioned clang', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  for (const [cc, cxx] of [
    ['/usr/bin/clang', '/opt/llvm/bin/clang++'],
    ['aarch64-linux-gnu-clang', 'aarch64-linux-gnu-clang++'],
    ['clang-18', 'clang++-18'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs ignores CC/CXX when the toolchain compiler is effective', (t) => {
  // With TARGET_CC/TARGET_CXX unset, the function itself exports the
  // toolchain gcc/g++ as TARGET_CC/TARGET_CXX — and cc-rs prefers TARGET_CC
  // over CC for cross builds, so a clang in CC/CXX never actually runs.
  // Injecting the clang-only `--gcc-toolchain=` flag here would hard-error
  // the gcc that does run.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', CC: '/usr/bin/clang', CXX: '/opt/llvm/bin/clang++' },
  )

  t.true(envs.TARGET_CC.endsWith('-gcc'))
  t.true(envs.TARGET_CXX.endsWith('-g++'))
  t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'))
  t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'))
})

test('napiCrossToolchainEnvs treats an empty TARGET_CC as unset for clang detection', (t) => {
  // Falsy semantics: a present-but-empty TARGET_CC still gets the toolchain
  // gcc written to the build environment, so the CC fallback must not
  // resurrect clang detection for a compiler that will not run.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: '', CC: '/usr/bin/clang' },
  )

  t.is(
    envs.TARGET_CC,
    join(napiCrossToolchainPath, 'bin', 'aarch64-unknown-linux-gnu-gcc'),
  )
  t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'))
})

test('napiCrossToolchainEnvs lets a user TARGET_CC=clang win over CC=gcc', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: 'clang', CC: 'gcc' },
  )

  t.is(
    envs.TARGET_CFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `,
  )
  // The CXX side is untouched, so it stays on the toolchain g++ without
  // clang flags — each language is detected independently.
  t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'))
})

test('napiCrossToolchainEnvs injects no flags on either side when only CC=clang is set', (t) => {
  // Both languages default to the toolchain gcc/g++; neither effective
  // compiler is clang, so neither flag set is injected.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', CC: 'clang' },
  )

  t.true(envs.TARGET_CC.endsWith('-gcc'))
  t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'))
  t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'))
})

test('napiCrossToolchainEnvs does not mistake non-clang tools for clang', (t) => {
  for (const [cc, cxx] of [
    ['gcc', 'g++'],
    ['x86_64-unknown-linux-gnu-gcc', 'x86_64-unknown-linux-gnu-g++'],
    // `clang-format` is a clang-family tool but not a compiler.
    ['clang-format', 'clang-format'],
    ['someclangthing', 'someclangthing'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'), `TARGET_CC=${cc}`)
    t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'), `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs detects clang behind cc-rs wrapper and argument forms', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  // cc-rs parses the env value before executing it (`env_tool`): the value
  // is split on whitespace, a known wrapper prefix (`sccache clang`) runs
  // the second token, and an argument form (`clang -target …`) runs the
  // first token with the rest as arguments — clang runs in both cases.
  for (const [cc, cxx] of [
    ['sccache clang', 'sccache clang++'],
    ['ccache clang-18', 'ccache clang++-18'],
    ['distcc /usr/bin/clang', 'distcc /usr/bin/clang++'],
    [
      'clang -target aarch64-unknown-linux-gnu',
      'clang++ -target aarch64-unknown-linux-gnu',
    ],
    ['/usr/bin/clang --sysroot=/x', '/usr/bin/clang++ --sysroot=/x'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
  }
})

// Writes empty files at `relativePaths` under a fresh temp directory whose
// subdirectories contain spaces, mirroring installs like `/opt/LLVM 18`.
// Returns the temp directory root; removal is registered on `t.teardown`.
const makeCompilerFixture = (
  t: ExecutionContext,
  relativePaths: Array<string>,
): string => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'napi-clang-detect-'))
  t.teardown(() => rmSync(fixtureRoot, { recursive: true, force: true }))
  for (const relativePath of relativePaths) {
    const absolutePath = join(fixtureRoot, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, '')
  }
  return fixtureRoot
}

test('napiCrossToolchainEnvs matches clang in space-containing paths that exist on disk', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  // cc-rs's `env_tool` treats the WHOLE env value as the compiler when it
  // exists on the filesystem (`check_exe`) before any whitespace splitting,
  // so `TARGET_CC="<tmp>/LLVM 18/bin/clang"` runs clang — splitting it into
  // `<tmp>/LLVM` + `18/bin/clang` would miss the clang detection entirely.
  const fixtureRoot = makeCompilerFixture(t, [
    'LLVM 18/bin/clang',
    'LLVM 18/bin/clang++-17',
  ])
  const cc = join(fixtureRoot, 'LLVM 18', 'bin', 'clang')
  const cxx = join(fixtureRoot, 'LLVM 18', 'bin', 'clang++-17')
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
  )

  t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
  t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
})

test('napiCrossToolchainEnvs does not mistake existing space-containing non-clang paths for clang', (t) => {
  const fixtureRoot = makeCompilerFixture(t, [
    'app dir/bin/gcc',
    'app dir/bin/g++',
    // A clang-family tool that is not a compiler, in a space-containing path.
    'LLVM 18/bin/clang-format',
  ])
  for (const [cc, cxx] of [
    [
      join(fixtureRoot, 'app dir', 'bin', 'gcc'),
      join(fixtureRoot, 'app dir', 'bin', 'g++'),
    ],
    [
      join(fixtureRoot, 'LLVM 18', 'bin', 'clang-format'),
      join(fixtureRoot, 'LLVM 18', 'bin', 'clang-format'),
    ],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'), `TARGET_CC=${cc}`)
    t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'), `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs splits space-containing paths that do not exist on disk', (t) => {
  // cc-rs only takes the whole value as a compiler path when it exists on
  // the filesystem; otherwise it splits on whitespace, so this value runs
  // `/nonexistent` with `dir/bin/clang` as an argument — never clang.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {
      PATH: '/usr/bin',
      TARGET_CC: '/nonexistent dir/bin/clang',
      TARGET_CXX: '/nonexistent dir/bin/clang++',
    },
  )

  t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'))
  t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'))
})

test('napiCrossToolchainEnvs does not mistake gcc with clang-ending arguments for clang', (t) => {
  // The basename of each WHOLE value below is `clang`, but none of them
  // exists as a file, so cc-rs splits on whitespace and runs gcc — clang
  // flags injected here would hard-error the gcc compile.
  for (const [cc, cxx] of [
    ['gcc --sysroot=/opt/clang', 'g++ --sysroot=/opt/clang'],
    ['gcc -B/opt/LLVM 18/bin/clang', 'g++ -B/opt/LLVM 18/bin/clang'],
    ['sccache gcc --sysroot=/opt/clang', 'sccache g++ --sysroot=/opt/clang'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'), `TARGET_CC=${cc}`)
    t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'), `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs does not mistake wrapped or argument-form non-clang for clang', (t) => {
  for (const [cc, cxx] of [
    ['sccache gcc', 'sccache g++'],
    ['ccache gcc', 'ccache g++'],
    ['gcc -B/foo', 'g++ -B/foo'],
    // The compiler token behind the wrapper is still not a compiler.
    ['sccache clang-format', 'sccache clang-format'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.false(Object.hasOwn(envs, 'TARGET_CFLAGS'), `TARGET_CC=${cc}`)
    t.false(Object.hasOwn(envs, 'TARGET_CXXFLAGS'), `TARGET_CXX=${cxx}`)
  }
})

test('buildProject rejects invalid cross flag combinations upfront', async (t) => {
  const { projectDir } = t.context

  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(
    join(projectDir, 'Cargo.toml'),
    `[package]
name = "cross_flags_check"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
`,
  )
  await writeFile(join(projectDir, 'src', 'lib.rs'), '')
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'cross-flags-check',
        version: '0.1.0',
        napi: { binaryName: 'cross-flags-check' },
      },
      null,
      2,
    )}\n`,
  )

  const comboError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, useCross: true, crossCompile: true }),
  )
  t.regex(comboError!.message, /cannot be used together/)

  const watchError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, crossCompile: true }),
  )
  t.regex(
    watchError!.message,
    /`--watch` cannot be used with `--cross-compile`/,
  )

  const napiCrossError = await t.throwsAsync(() =>
    buildProject({
      cwd: projectDir,
      useNapiCross: true,
      target: 'riscv64gc-unknown-linux-gnu',
    }),
  )
  t.regex(napiCrossError!.message, /`--use-napi-cross`/)
})

test('buildProject validates cross flags before resolving the crate manifest', async (t) => {
  // `projectDir` deliberately contains no `Cargo.toml`: if `buildProject`
  // resolved the manifest (and spawned `cargo metadata`) before validating
  // the cross-compilation flags, these calls would fail with
  // "No crate found in manifest" instead of the validation errors below.
  const { projectDir } = t.context

  const comboError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, useCross: true, crossCompile: true }),
  )
  t.regex(
    comboError!.message,
    /`--use-cross`.+`--cross-compile`.+cannot be used together/,
  )

  const watchError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, useCross: true }),
  )
  t.regex(watchError!.message, /`--watch` cannot be used with `--use-cross`/)

  const watchCrossCompileError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, crossCompile: true }),
  )
  t.regex(
    watchCrossCompileError!.message,
    /`--watch` cannot be used with `--cross-compile`/,
  )

  // Rejected either for the unsupported host (non Linux x64/arm64) or for
  // the unsupported target triple (on Linux x64/arm64 hosts) — both are
  // `--use-napi-cross` validation errors, keeping this assertion
  // host-platform independent.
  const napiCrossError = await t.throwsAsync(() =>
    buildProject({
      cwd: projectDir,
      useNapiCross: true,
      target: 'riscv64gc-unknown-linux-gnu',
    }),
  )
  t.regex(napiCrossError!.message, /`--use-napi-cross`/)
})

// On a Windows host `--cross-compile` never routes through `cargo-xwin`,
// so the windows-gnu rejection only exists on non-Windows hosts.
;(process.platform === 'win32' ? test.skip : test)(
  'buildProject rejects `--cross-compile` with a windows-gnu target before any side effect',
  async (t) => {
    // `projectDir` deliberately contains no `Cargo.toml`: if `buildProject`
    // resolved the manifest (and spawned `cargo metadata`) before validating
    // the target, this call would fail with a manifest error instead of the
    // windows-gnu validation error below.
    const { projectDir } = t.context

    const error = await t.throwsAsync(() =>
      buildProject({
        cwd: projectDir,
        crossCompile: true,
        target: 'x86_64-pc-windows-gnu',
      }),
    )
    t.regex(
      error!.message,
      /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnu/,
    )
    t.regex(error!.message, /cargo-xwin/)
  },
)

// The scenario below only exists on hosts `--use-napi-cross` does not
// support (anything but Linux x64 / Linux arm64), so skip it elsewhere.
const isNapiCrossUnsupportedHost =
  process.platform !== 'linux' ||
  (process.arch !== 'x64' && process.arch !== 'arm64')

;(isNapiCrossUnsupportedHost ? test : test.skip)(
  'buildProject reports the `--use-napi-cross` host error before resolving the target',
  async (t) => {
    const { projectDir } = t.context

    // Without an explicit `--target` (or `CARGO_BUILD_TARGET`), resolving
    // the target spawns `rustc -vV`. Point `PATH` at an empty directory so
    // that spawn is guaranteed to fail — whether or not Rust is installed on
    // this machine: if `buildProject` resolved the target before validating
    // the host, the error below would be the `rustc` spawn failure instead
    // of the host validation error.
    const emptyPathDir = join(projectDir, 'empty-path')
    await mkdir(emptyPathDir, { recursive: true })

    const originalPath = process.env.PATH
    const originalCargoBuildTarget = process.env.CARGO_BUILD_TARGET
    process.env.PATH = emptyPathDir
    delete process.env.CARGO_BUILD_TARGET
    // The cross-flag validation runs synchronously at the top of
    // `buildProject`, so the promise below is already settled (rejected)
    // when the environment is restored right after — no other concurrently
    // running test can observe the modified `PATH`.
    let buildPromise: Promise<unknown>
    try {
      buildPromise = buildProject({ cwd: projectDir, useNapiCross: true })
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = originalPath
      }
      if (originalCargoBuildTarget === undefined) {
        delete process.env.CARGO_BUILD_TARGET
      } else {
        process.env.CARGO_BUILD_TARGET = originalCargoBuildTarget
      }
    }

    const error = await t.throwsAsync(() => buildPromise)
    t.regex(
      error!.message,
      /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/,
    )
  },
)

test('WASI artifact names remain flavor-specific without --platform', (t) => {
  const sourceName = 'binding.wasm'
  const threaded = createArtifactDestinationName(
    'binding',
    parseTriple('wasm32-wasip1-threads'),
    sourceName,
    false,
  )
  const threadless = createArtifactDestinationName(
    'binding',
    parseTriple('wasm32-wasip1'),
    sourceName,
    false,
  )

  t.is(threaded, 'binding.wasm32-wasi.wasm')
  t.is(threadless, 'binding.wasm32-wasip1.wasm')
  t.not(threaded, threadless)
})

test('WASI SDK compiler flags preserve paths containing spaces', (t) => {
  const wasiSdkPath = join(t.context.tmpDir, 'WASI SDK')
  const sysroot = join(wasiSdkPath, 'share', 'wasi-sysroot')
  const linker = join(wasiSdkPath, 'bin', 'wasm-ld')
  const flags = createWasiCompilerFlags(
    wasiSdkPath,
    'wasm32-wasip1-threads',
    true,
  )

  t.is(
    flags.compileFlags,
    `'--target=wasm32-wasip1-threads' '--sysroot=${sysroot}' '-pthread' '-mllvm' '-wasm-enable-sjlj'`,
  )
  t.is(
    flags.linkerFlags,
    `'-fuse-ld=${linker}' '--target=wasm32-wasip1-threads'`,
  )
})

test('WASI SDK flags honor shell parsing mode for Windows-style paths', (t) => {
  const windowsPath = String.raw`C:\WASI SDK`
  const escaped = createWasiCompilerFlags(
    windowsPath,
    'wasm32-wasip1',
    false,
    true,
  )
  t.true(
    escaped.compileFlags.includes(
      String.raw`'--sysroot=C:\WASI SDK/share/wasi-sysroot'`,
    ),
  )

  const unescaped = createWasiCompilerFlags(
    String.raw`C:\wasi-sdk`,
    'wasm32-wasip1',
    false,
    false,
  )
  t.is(
    unescaped.compileFlags,
    String.raw`--target=wasm32-wasip1 --sysroot=C:\wasi-sdk/share/wasi-sysroot -mllvm -wasm-enable-sjlj`,
  )
  t.throws(
    () => createWasiCompilerFlags(windowsPath, 'wasm32-wasip1', false, false),
    { message: /CC_SHELL_ESCAPED_FLAGS.*cannot contain whitespace/ },
  )
})

test('WASI declarations rebase nested modules and reject ESM roots', (t) => {
  const source = `export { value } from './nested.mjs'\n`
  t.is(
    prepareWasiBindingTypeDef(
      source,
      join(t.context.projectDir, 'types', 'index.d.cts'),
      join(t.context.projectDir, 'binding.wasi.d.cts'),
      true,
    ),
    `export { value } from './types/nested.mjs'\n`,
  )
  const error = t.throws(() =>
    prepareWasiBindingTypeDef(
      source,
      join(t.context.projectDir, 'types', 'index.d.mts'),
      join(t.context.projectDir, 'binding.wasi.d.cts'),
      true,
    ),
  )
  t.regex(error.message, /Cannot emit the CommonJS WASI declaration/)
  const modulePackageError = t.throws(() =>
    prepareWasiBindingTypeDef(
      source,
      join(t.context.projectDir, 'types', 'index.d.ts'),
      join(t.context.projectDir, 'binding.wasi.d.cts'),
      true,
      'module',
    ),
  )
  t.regex(
    modulePackageError.message,
    /Cannot emit the CommonJS WASI declaration/,
  )
  t.notThrows(() =>
    prepareWasiBindingTypeDef(
      source,
      join(t.context.projectDir, 'types', 'index.d.ts'),
      join(t.context.projectDir, 'binding.wasi.d.cts'),
      true,
      'commonjs',
    ),
  )
  t.is(
    prepareWasiBindingTypeDef(
      'export declare const runtimeGlobal: typeof global\n',
      join(t.context.projectDir, 'types', 'index.d.cts'),
      join(t.context.projectDir, 'binding.wasip1.d.cts'),
      false,
    ),
    'export declare const runtimeGlobal: typeof globalThis\n',
  )
})

test('writeJsBinding executes nested custom entries with local WASI loaders', async (t) => {
  const { projectDir } = t.context
  await writeFile(
    join(projectDir, 'nested-wasi.wasip1.cjs'),
    'module.exports = { answer: 42 }\n',
  )
  await writeFile(join(projectDir, 'nested-wasi.wasm32-wasip1.wasm'), '')
  const output = await writeJsBinding({
    platform: true,
    idents: [],
    jsBinding: join('dist', 'binding.cjs'),
    binaryName: 'nested-wasi',
    packageName: 'nested-wasi',
    version: '1.0.0',
    outputDir: projectDir,
    wasiFlavors: ['wasm32-wasip1'],
  })

  t.is(output?.path, join(projectDir, 'dist', 'binding.cjs'))
  t.true(existsSync(output!.path))
  const binding = await readFile(output!.path, 'utf8')
  t.true(binding.includes("require('../nested-wasi.wasip1.cjs')"))

  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `process.stdout.write(String(require(${JSON.stringify(output!.path)}).answer))`,
    ],
    {
      cwd: projectDir,
      encoding: 'utf8',
      env: { ...process.env, NAPI_RS_FORCE_WASI: 'true' },
    },
  )
  t.is(result.status, 0, result.stderr)
  t.is(result.stdout, '42')
})

test('writeJsBinding emits an untyped CJS WASI fallback loader', async (t) => {
  const { projectDir } = t.context
  const output = await writeJsBinding({
    platform: true,
    idents: [],
    binaryName: 'untyped-wasi',
    packageName: 'untyped-wasi',
    version: '1.0.0',
    outputDir: projectDir,
    wasiFlavors: ['wasm32-wasip1'],
  })

  t.is(output?.path, join(projectDir, 'index.js'))
  const binding = await readFile(join(projectDir, 'index.js'), 'utf8')
  t.true(binding.includes("require('./untyped-wasi.wasip1.cjs')"))
  t.true(binding.includes("require('untyped-wasi-wasm32-wasip1')"))
  t.true(binding.includes('module.exports = nativeBinding'))
})

test.serial(
  'writeJsBinding emits an executable untyped ESM WASI fallback loader',
  async (t) => {
    const { projectDir } = t.context
    await writeFile(
      join(projectDir, 'untyped-esm-wasi.wasip1.cjs'),
      'module.exports = { answer: 42 }\n',
    )
    await writeFile(join(projectDir, 'untyped-esm-wasi.wasm32-wasip1.wasm'), '')
    const output = await writeJsBinding({
      platform: true,
      esm: true,
      idents: [],
      jsBinding: 'index.mjs',
      binaryName: 'untyped-esm-wasi',
      packageName: 'untyped-esm-wasi',
      version: '1.0.0',
      outputDir: projectDir,
      wasiFlavors: ['wasm32-wasip1'],
    })

    t.is(output?.path, join(projectDir, 'index.mjs'))
    const previousForceWasi = process.env.NAPI_RS_FORCE_WASI
    process.env.NAPI_RS_FORCE_WASI = 'true'
    try {
      const binding = await import(
        `${pathToFileURL(output!.path).href}?test=${Date.now()}`
      )
      t.is(binding.default.answer, 42)
      t.false('answer' in binding)
    } finally {
      if (previousForceWasi === undefined) {
        delete process.env.NAPI_RS_FORCE_WASI
      } else {
        process.env.NAPI_RS_FORCE_WASI = previousForceWasi
      }
    }
  },
)

test('WASI artifact verification requires a reactor initializer', async (t) => {
  const missingPath = join(t.context.tmpDir, 'missing-initialize.wasm')
  await writeFile(missingPath, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
  const error = await t.throwsAsync(() => verifyWasiReactor(missingPath))
  t.regex(error.message, /does not export _initialize/)

  const validPath = join(t.context.tmpDir, 'reactor.wasm')
  await writeFile(
    validPath,
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 15, 1, 11,
      95, 105, 110, 105, 116, 105, 97, 108, 105, 122, 101, 0, 0, 10, 4, 1, 2, 0,
      11,
    ]),
  )
  await t.notThrowsAsync(() => verifyWasiReactor(validPath))
})

// An explicit threadless target controls the emitted loader and browser entry
// even when package config declares only the threaded flavor.
test('explicit WASI build target selects the browser flavor', (t) => {
  const target = selectWasiBrowserTarget(
    parseTriple('wasm32-wasip1'),
    [parseTriple('wasm32-wasip1-threads')],
    [parseTriple('wasm32-wasip1')],
  )

  t.is(target?.platformArchABI, 'wasm32-wasip1')
})

test('WASI cleanup preserves configured sibling flavors and removes obsolete ones', (t) => {
  const binaryName = 'cleanup-wasi'
  const threadless = parseTriple('wasm32-wasip1')
  const threaded = parseTriple('wasm32-wasip1-threads')
  const native = parseTriple('x86_64-unknown-linux-gnu')
  const withConfiguredThreaded = collectStaleWasiBuildOutputNames(
    binaryName,
    threadless,
    [threaded],
  )
  t.false(withConfiguredThreaded.has(`${binaryName}.wasi.cjs`))
  t.false(withConfiguredThreaded.has('wasi-worker.mjs'))
  t.true(withConfiguredThreaded.has(`${binaryName}.wasip1.cjs`))
  t.false(withConfiguredThreaded.has(`${binaryName}.wasm32-wasip1.wasm`))
  t.false(withConfiguredThreaded.has(`${binaryName}.wasm32-wasip1.debug.wasm`))

  const afterThreadlessTransition = collectStaleWasiBuildOutputNames(
    binaryName,
    threadless,
    [threadless],
  )
  for (const file of [
    `${binaryName}.wasi.cjs`,
    `${binaryName}.wasi.d.cts`,
    `${binaryName}.wasi-browser.js`,
    `${binaryName}.wasm32-wasi.wasm`,
    `${binaryName}.wasm32-wasi.debug.wasm`,
    'wasi-worker.mjs',
    'wasi-worker-browser.mjs',
  ]) {
    t.true(afterThreadlessTransition.has(file))
  }

  const afterNativeTransition = collectStaleWasiBuildOutputNames(
    binaryName,
    native,
    [native],
  )
  for (const file of [
    `${binaryName}.wasip1.cjs`,
    `${binaryName}.wasip1.d.cts`,
    `${binaryName}.wasip1-browser.js`,
    `${binaryName}.wasip1-deferred.js`,
    `${binaryName}.wasip1-deferred.d.ts`,
    `${binaryName}.wasm32-wasip1.wasm`,
    `${binaryName}.wasm32-wasip1.debug.wasm`,
    `${binaryName}.wasi.cjs`,
    `${binaryName}.wasi.d.cts`,
    `${binaryName}.wasi-browser.js`,
    `${binaryName}.wasm32-wasi.wasm`,
    `${binaryName}.wasm32-wasi.debug.wasm`,
    'wasi-worker.mjs',
    'wasi-worker-browser.mjs',
  ]) {
    t.true(afterNativeTransition.has(file), file)
  }
})

test('WASM rewriting removes nondeterministic build IDs structurally', (t) => {
  const encodeU32 = (value: number) => {
    const bytes = []
    do {
      let byte = value & 0x7f
      value >>>= 7
      if (value !== 0) {
        byte |= 0x80
      }
      bytes.push(byte)
    } while (value !== 0)
    return bytes
  }
  const customSection = (name: string, payload: number[]) => {
    const nameBytes = [...Buffer.from(name)]
    const contents = [...encodeU32(nameBytes.length), ...nameBytes, ...payload]
    return [0, ...encodeU32(contents.length), ...contents]
  }
  const moduleWithBuildId = (buildId: number[]) =>
    new Uint8Array([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      ...customSection('keep', [1, 2, 3]),
      ...customSection('build_id', buildId),
    ])

  const first = removeWasmCustomSection(
    moduleWithBuildId([1, 2, 3]),
    'build_id',
  )
  const second = removeWasmCustomSection(
    moduleWithBuildId([4, 5, 6]),
    'build_id',
  )

  t.deepEqual(first, second)
  const module = new WebAssembly.Module(first as BufferSource)
  t.is(WebAssembly.Module.customSections(module, 'build_id').length, 0)
  t.is(WebAssembly.Module.customSections(module, 'keep').length, 1)
})

test('untyped WASI browser entry forwards the default export', async (t) => {
  const { projectDir } = t.context
  const packageName = 'untyped-browser-entry-wasm32-wasip1'
  const packageDir = join(projectDir, 'node_modules', packageName)
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      type: 'module',
      exports: './index.js',
    }),
  )
  await writeFile(
    join(packageDir, 'index.js'),
    'export default { answer: 42 }\n',
  )
  const entryPath = join(projectDir, 'browser.mjs')
  await writeFile(
    entryPath,
    createWasiBrowserEntry('untyped-browser-entry', 'wasm32-wasip1', []),
  )

  const binding = await import(
    `${pathToFileURL(entryPath).href}?test=${Date.now()}`
  )
  t.is(binding.default.answer, 42)
  t.is(
    createWasiBrowserEntry('typed-browser-entry', 'wasm32-wasip1', ['sum']),
    "export * from 'typed-browser-entry-wasm32-wasip1'\n",
  )
})

test('deferred WASI declarations preserve typed and untyped bindings', (t) => {
  t.true(
    createWasiDeferredBindingTypeDef('./binding.wasip1.cjs', true).includes(
      "export type WasiBinding = typeof import('./binding.wasip1.cjs')",
    ),
  )
  const untyped = createWasiDeferredBindingTypeDef(
    './binding.wasip1.cjs',
    false,
  )
  t.true(untyped.includes('export type WasiBinding = Record<string, unknown>'))
  t.false(untyped.includes("import('./binding.wasip1.cjs')"))
})

test.serial(
  'direct untyped wasm32-wasip1 build emits complete browser and workerd entries',
  async (t) => {
    // The wasm32-wasip1 build needs the Rust target; generic CLI test lanes only
    // install the host toolchain, so skip when the target is unavailable.
    const targetLibDir = execSync(
      'rustc --print target-libdir --target wasm32-wasip1',
      {
        encoding: 'utf8',
      },
    ).trim()
    if (
      !existsSync(targetLibDir) ||
      !(await readdir(targetLibDir)).some((file) => file.startsWith('libcore-'))
    ) {
      t.pass('skipped: wasm32-wasip1 rust target is not installed')
      return
    }

    const { projectDir } = t.context
    const crateName = 'wasip1_direct'
    const binaryName = 'wasip1-direct'
    const packageName = 'wasip1-direct'
    const version = '0.1.0'

    const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
      win32Sep,
      posixSep,
    )
    const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
      win32Sep,
      posixSep,
    )
    const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
      win32Sep,
      posixSep,
    )

    await mkdir(join(projectDir, 'src'), { recursive: true })

    await writeFile(
      join(projectDir, 'Cargo.toml'),
      `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}", default-features = false, features = ["napi4"] }
napi-derive = { path = "${napiDerivePath}", default-features = false, features = ["strict"] }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`,
    )
    await writeFile(
      join(projectDir, 'package.json'),
      `${JSON.stringify(
        {
          name: packageName,
          version,
          napi: {
            binaryName,
            targets: ['wasm32-wasip1-threads'],
          },
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(
      join(projectDir, 'build.rs'),
      'fn main() {\n    napi_build::setup();\n}\n',
    )
    await writeFile(
      join(projectDir, 'src', 'lib.rs'),
      'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
    )

    // `setWasiEnv` requires @emnapi/core and @emnapi/runtime resolvable from
    // the project with versions matching the CLI's own `emnapi` package.
    const emnapiVersion = JSON.parse(
      await readFile(
        join(repoRoot, 'node_modules', 'emnapi', 'package.json'),
        'utf-8',
      ),
    ).version
    for (const pkg of ['@emnapi/core', '@emnapi/runtime']) {
      const pkgDir = join(projectDir, 'node_modules', pkg)
      await mkdir(pkgDir, { recursive: true })
      await writeFile(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: pkg, version: emnapiVersion, main: 'index.js' }),
      )
      await writeFile(
        join(pkgDir, 'index.js'),
        `module.exports = { version: "${emnapiVersion}" }`,
      )
    }

    // `buildProject` resolves to `{ task }` without awaiting the build; the
    // cargo compile and post-build work run on the returned task promise.
    const { task } = await buildProject({
      platform: true,
      target: 'wasm32-wasip1',
      cwd: projectDir,
    })
    await task

    t.true(existsSync(join(projectDir, `${binaryName}.wasip1.cjs`)))
    t.true(existsSync(join(projectDir, `${binaryName}.wasip1.d.cts`)))
    t.true(existsSync(join(projectDir, `${binaryName}.wasip1-browser.js`)))
    t.true(existsSync(join(projectDir, `${binaryName}.wasip1-deferred.js`)))
    t.true(existsSync(join(projectDir, `${binaryName}.wasip1-deferred.d.ts`)))
    t.false(existsSync(join(projectDir, `${binaryName}.wasi.cjs`)))

    // The built flavor participates in the fallback chain even though it differs
    // from the configured flavor.
    const js = await readFile(join(projectDir, 'index.js'), 'utf-8')
    t.regex(js, new RegExp(`require\\('\\./${binaryName}\\.wasip1\\.cjs'\\)`))
    t.regex(js, new RegExp(`require\\('${packageName}-wasm32-wasip1'\\)`))
    t.is(
      await readFile(join(projectDir, 'browser.js'), 'utf8'),
      `export * from '${packageName}-wasm32-wasip1'\nexport { default } from '${packageName}-wasm32-wasip1'\n`,
    )
    const workerdTypeDef = await readFile(
      join(projectDir, `${binaryName}.wasip1-deferred.d.ts`),
      'utf8',
    )
    t.true(
      workerdTypeDef.includes(
        'export type WasiBinding = Record<string, unknown>',
      ),
    )
    t.false(workerdTypeDef.includes(`import('${packageName}')`))
    t.is(
      await readFile(join(projectDir, `${binaryName}.wasip1.d.cts`), 'utf8'),
      `${DEFAULT_TYPE_DEF_HEADER}
declare const binding: Record<string, unknown>
export = binding
`,
    )
    t.false(existsSync(join(projectDir, 'index.d.ts')))

    const previousOutputs = new Map(
      await Promise.all(
        [
          `${binaryName}.wasm32-wasip1.wasm`,
          `${binaryName}.wasip1.cjs`,
          `${binaryName}.wasip1.d.cts`,
          'index.js',
        ].map(
          async (file) =>
            [file, await readFile(join(projectDir, file))] as const,
        ),
      ),
    )
    const sourceWasm = join(
      projectDir,
      'target',
      'wasm32-wasip1',
      'debug',
      `${crateName}.wasm`,
    )
    const previousSourceWasm = await readFile(sourceWasm)
    await writeFile(sourceWasm, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
    const cargoShim = join(projectDir, 'cargo-shim.cjs')
    const cargoExecutable = execSync('command -v cargo', {
      encoding: 'utf8',
    }).trim()
    await writeFile(
      cargoShim,
      `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
if (args.includes('metadata')) {
  const result = spawnSync(${JSON.stringify(cargoExecutable)}, args, {
    stdio: 'inherit',
  })
  process.exit(result.status === null ? 1 : result.status)
}
`,
    )
    await chmod(cargoShim, 0o755)
    const originalCargo = process.env.CARGO
    process.env.CARGO = cargoShim
    try {
      const { task: invalidReactorTask } = await buildProject({
        platform: true,
        target: 'wasm32-wasip1',
        cwd: projectDir,
      })
      const invalidReactorError = await t.throwsAsync(invalidReactorTask)
      t.regex(invalidReactorError.message, /Failed to copy artifact/)
      t.regex(
        String(
          (invalidReactorError as Error & { cause?: Error }).cause?.message,
        ),
        /does not export _initialize/,
      )
    } finally {
      if (originalCargo === undefined) {
        delete process.env.CARGO
      } else {
        process.env.CARGO = originalCargo
      }
      await writeFile(sourceWasm, previousSourceWasm)
    }
    for (const [file, contents] of previousOutputs) {
      t.deepEqual(await readFile(join(projectDir, file)), contents, file)
    }

    const staleThreadedFiles = [
      `${binaryName}.wasi.cjs`,
      `${binaryName}.wasi.d.cts`,
      `${binaryName}.wasi-browser.js`,
      `${binaryName}.wasi-deferred.js`,
      `${binaryName}.wasi-deferred.d.ts`,
      `${binaryName}.wasm32-wasi.wasm`,
      `${binaryName}.wasm32-wasi.debug.wasm`,
      'wasi-worker.mjs',
      'wasi-worker-browser.mjs',
    ]
    await Promise.all(
      staleThreadedFiles.map((file) =>
        writeFile(join(projectDir, file), `stale ${file}\n`),
      ),
    )

    // A subsequent build removes threaded outputs after configuration
    // transitions to threadless-only.
    const packageJsonPath = join(projectDir, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    packageJson.napi.targets = ['wasm32-wasip1']
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    )
    const { task: rebuildTask } = await buildProject({
      platform: true,
      target: 'wasm32-wasip1',
      cwd: projectDir,
    })
    await rebuildTask
    for (const file of staleThreadedFiles) {
      t.false(existsSync(join(projectDir, file)))
    }
  },
)
