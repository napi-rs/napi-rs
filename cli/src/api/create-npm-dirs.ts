import { rm as rawRmAsync } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const directBufferDependency = '^6.0.3'

import {
  applyDefaultCreateNpmDirsOptions,
  type CreateNpmDirsOptions,
} from '../def/create-npm-dirs.js'
import {
  createWasmModuleTypeDef,
  debugFactory,
  MINIMUM_WASI_NODE_VERSION,
  readNapiConfig,
  mkdirAsync as rawMkdirAsync,
  pick,
  restrictWasiNodeEngine,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  writeFileAsync as rawWriteFileAsync,
  type Target,
  type CommonPackageJsonFields,
} from '../utils/index.js'

const debug = debugFactory('create-npm-dirs')
const MANAGED_WASI_PACKAGE_DIRS = ['wasm32-wasi', 'wasm32-wasip1']

export interface PackageMeta {
  'dist-tags': { [index: string]: string }
}

const WASM_RUNTIME_PACKAGE_NAME = '@napi-rs/wasm-runtime'

async function getLatestWasmRuntimeVersion() {
  const npmRegistryBase =
    process.env.npm_config_registry?.replace(/\/?$/, '/') ??
    'https://registry.npmjs.org/'
  const packageMetadataUrl = `${npmRegistryBase}${WASM_RUNTIME_PACKAGE_NAME}`
  let response: Response

  try {
    response = await fetch(packageMetadataUrl)
  } catch (error) {
    throw new Error(
      `Failed to fetch ${packageMetadataUrl} while resolving ${WASM_RUNTIME_PACKAGE_NAME}. Check your network connection and npm registry availability.`,
      { cause: error },
    )
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${packageMetadataUrl} while resolving ${WASM_RUNTIME_PACKAGE_NAME}: npm registry responded with ${response.status} ${response.statusText || 'Unknown Status'}`,
    )
  }

  let packageMeta: PackageMeta

  try {
    packageMeta = (await response.json()) as PackageMeta
  } catch (error) {
    throw new Error(
      `Failed to parse npm registry metadata for ${WASM_RUNTIME_PACKAGE_NAME} from ${packageMetadataUrl}`,
      { cause: error },
    )
  }

  const latestVersion = packageMeta['dist-tags']?.latest

  if (typeof latestVersion !== 'string' || latestVersion.trim().length === 0) {
    throw new Error(
      `npm registry metadata for ${WASM_RUNTIME_PACKAGE_NAME} from ${packageMetadataUrl} did not include a latest dist-tag`,
    )
  }

  return latestVersion.trim()
}

export async function createNpmDirs(userOptions: CreateNpmDirsOptions) {
  const options = applyDefaultCreateNpmDirsOptions(userOptions)

  async function mkdirAsync(dir: string) {
    debug('Try to create dir: %i', dir)
    if (options.dryRun) {
      return
    }

    await rawMkdirAsync(dir, {
      recursive: true,
    })
  }

  async function writeFileAsync(file: string, content: string) {
    debug('Writing file %i', file)

    if (options.dryRun) {
      debug(content)
      return
    }

    await rawWriteFileAsync(file, content)
  }

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)
  const npmPath = resolve(options.cwd, options.npmDir)

  debug(`Read content from [${options.configPath ?? packageJsonPath}]`)

  const { targets, binaryName, packageName, packageJson, wasm } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolve(options.cwd, options.configPath) : undefined,
    )
  const configuredPackageDirs = new Set(
    targets.map((target) => target.platformArchABI),
  )
  const wasmRuntimeVersion = targets.some((target) => target.arch === 'wasm32')
    ? await getLatestWasmRuntimeVersion()
    : undefined
  if (!options.dryRun) {
    await Promise.all(
      MANAGED_WASI_PACKAGE_DIRS.filter(
        (packageDir) => !configuredPackageDirs.has(packageDir),
      ).map((packageDir) =>
        rawRmAsync(join(npmPath, packageDir), {
          recursive: true,
          force: true,
        }),
      ),
    )
  }

  for (const target of targets) {
    const targetDir = join(npmPath, `${target.platformArchABI}`)
    await mkdirAsync(targetDir)

    const binaryFileName =
      target.arch === 'wasm32'
        ? `${binaryName}.${target.platformArchABI}.wasm`
        : `${binaryName}.${target.platformArchABI}.node`
    let wasmModuleTypeDef: string | undefined
    const scopedPackageJson: CommonPackageJsonFields = {
      name: `${packageName}-${target.platformArchABI}`,
      version: packageJson.version,
      // WASI modules execute inside a normal host Node/browser/workerd process.
      // Marking them as cpu=wasm32 makes npm reject direct installation and
      // silently skip the package when it is an optional dependency on x64 or
      // arm64 hosts.
      cpu:
        target.arch !== 'universal' && target.arch !== 'wasm32'
          ? [target.arch]
          : undefined,
      main: binaryFileName,
      files: [binaryFileName],
      ...pick(
        packageJson,
        'description',
        'keywords',
        'author',
        'authors',
        'homepage',
        'license',
        'engines',
        'repository',
        'bugs',
      ),
    }
    if (packageJson.publishConfig) {
      scopedPackageJson.publishConfig = pick(
        packageJson.publishConfig,
        'registry',
        'access',
      )
    }
    if (target.arch !== 'wasm32') {
      scopedPackageJson.os = [target.platform]
    } else {
      const loaderSuffix = wasiLoaderSuffix(target.platformArchABI)
      const entry = `${binaryName}.${loaderSuffix}.cjs`
      const loaderTypeDef = `${binaryName}.${loaderSuffix}.d.cts`
      scopedPackageJson.main = entry
      scopedPackageJson.types = loaderTypeDef
      scopedPackageJson.browser = `${binaryName}.${loaderSuffix}-browser.js`
      scopedPackageJson.type = 'module'
      scopedPackageJson.files?.push(
        entry,
        loaderTypeDef,
        scopedPackageJson.browser,
      )
      if (wasiTargetHasThreads(target)) {
        // worker scripts are only referenced by the threaded loaders
        scopedPackageJson.files?.push(
          `wasi-worker.mjs`,
          `wasi-worker-browser.mjs`,
        )
      } else {
        const deferredEntry = `${binaryName}.${loaderSuffix}-deferred.js`
        const deferredTypeDef = `${binaryName}.${loaderSuffix}-deferred.d.ts`
        wasmModuleTypeDef = `${binaryFileName}.d.ts`
        // the deferred workerd-safe loader is only emitted for non-threaded
        // WASI builds (mirrors `hasThreads` in `writeWasiBinding`)
        scopedPackageJson.files?.push(
          deferredEntry,
          deferredTypeDef,
          wasmModuleTypeDef,
        )
        scopedPackageJson.exports = {
          '.': {
            types: `./${loaderTypeDef}`,
            browser: `./${scopedPackageJson.browser}`,
            require: `./${entry}`,
            default: `./${entry}`,
          },
          './workerd': {
            types: `./${deferredTypeDef}`,
            default: `./${deferredEntry}`,
          },
          './wasm': {
            types: `./${wasmModuleTypeDef}`,
            default: `./${binaryFileName}`,
          },
          './wasm.wasm': {
            types: `./${wasmModuleTypeDef}`,
            default: `./${binaryFileName}`,
          },
          './package.json': './package.json',
        }
      }
      scopedPackageJson.engines = {
        ...scopedPackageJson.engines,
        node: scopedPackageJson.engines?.node
          ? restrictWasiNodeEngine(scopedPackageJson.engines.node)
          : MINIMUM_WASI_NODE_VERSION,
      }
      const emnapiVersion = require('emnapi/package.json').version
      scopedPackageJson.dependencies = {
        '@napi-rs/wasm-runtime': `^${wasmRuntimeVersion}`,
        '@emnapi/core': emnapiVersion,
        '@emnapi/runtime': emnapiVersion,
        ...(wasm?.browser?.buffer === true &&
        (wasm.browser.fs !== true || !wasiTargetHasThreads(target))
          ? { buffer: directBufferDependency }
          : {}),
      }
    }

    if (target.abi === 'gnu') {
      scopedPackageJson.libc = ['glibc']
    } else if (target.abi === 'musl') {
      scopedPackageJson.libc = ['musl']
    }

    const targetPackageJson = join(targetDir, 'package.json')
    await writeFileAsync(
      targetPackageJson,
      JSON.stringify(scopedPackageJson, null, 2) + '\n',
    )
    if (wasmModuleTypeDef) {
      await writeFileAsync(
        join(targetDir, wasmModuleTypeDef),
        createWasmModuleTypeDef(),
      )
    }
    const targetReadme = join(targetDir, 'README.md')
    await writeFileAsync(targetReadme, readme(packageName, target))

    debug.info(`${packageName} -${target.platformArchABI} created`)
  }
}

function readme(packageName: string, target: Target) {
  return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`
}
