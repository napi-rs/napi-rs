import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { Comparator, Range, minVersion, subset } from 'semver'

const require = createRequire(import.meta.url)
const minimumWasiNodeVersion = '>=14.0.0'

import {
  applyDefaultCreateNpmDirsOptions,
  type CreateNpmDirsOptions,
} from '../def/create-npm-dirs.js'
import {
  debugFactory,
  readNapiConfig,
  mkdirAsync as rawMkdirAsync,
  pick,
  writeFileAsync as rawWriteFileAsync,
  type Target,
  type CommonPackageJsonFields,
} from '../utils/index.js'

const debug = debugFactory('create-npm-dirs')

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

  const { targets, binaryName, packageName, packageJson } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolve(options.cwd, options.configPath) : undefined,
    )
  const wasmRuntimeVersion = targets.some((target) => target.arch === 'wasm32')
    ? await getLatestWasmRuntimeVersion()
    : undefined

  for (const target of targets) {
    const targetDir = join(npmPath, `${target.platformArchABI}`)
    await mkdirAsync(targetDir)

    const binaryFileName =
      target.arch === 'wasm32'
        ? `${binaryName}.${target.platformArchABI}.wasm`
        : `${binaryName}.${target.platformArchABI}.node`
    const scopedPackageJson: CommonPackageJsonFields = {
      name: `${packageName}-${target.platformArchABI}`,
      version: packageJson.version,
      cpu: target.arch !== 'universal' ? [target.arch] : undefined,
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
      const entry = `${binaryName}.wasi.cjs`
      scopedPackageJson.main = entry
      scopedPackageJson.browser = `${binaryName}.wasi-browser.js`
      scopedPackageJson.files?.push(
        entry,
        scopedPackageJson.browser,
        `wasi-worker.mjs`,
        `wasi-worker-browser.mjs`,
      )
      if (scopedPackageJson.engines?.node) {
        scopedPackageJson.engines = {
          ...scopedPackageJson.engines,
          node: restrictWasiNodeEngine(scopedPackageJson.engines.node),
        }
      } else {
        scopedPackageJson.engines = {
          node: minimumWasiNodeVersion,
        }
      }
      const emnapiVersion = require('emnapi/package.json').version
      scopedPackageJson.dependencies = {
        '@napi-rs/wasm-runtime': `^${wasmRuntimeVersion}`,
        '@emnapi/core': emnapiVersion,
        '@emnapi/runtime': emnapiVersion,
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

function restrictWasiNodeEngine(nodeRange: string) {
  try {
    if (subset(nodeRange, minimumWasiNodeVersion)) {
      return nodeRange
    }

    if (subset(minimumWasiNodeVersion, nodeRange)) {
      return minimumWasiNodeVersion
    }

    const minimumComparator = new Comparator(minimumWasiNodeVersion)
    const restrictedRangeSets = new Range(nodeRange).set
      .map((comparators) =>
        normalizeComparatorSet([...comparators, minimumComparator]),
      )
      .filter((candidate) => minVersion(candidate) !== null)

    if (restrictedRangeSets.length > 0) {
      return restrictedRangeSets.join(' || ')
    }
  } catch {
    // ignore
  }

  return minimumWasiNodeVersion
}

function normalizeComparatorSet(comparators: Comparator[]) {
  const exactMatch = comparators.find(({ operator }) => operator === '')
  if (exactMatch) {
    return exactMatch.value
  }

  let lowerBound: Comparator | undefined
  let upperBound: Comparator | undefined

  for (const comparator of comparators) {
    if (comparator.operator === '>' || comparator.operator === '>=') {
      if (
        !lowerBound ||
        comparator.semver.compare(lowerBound.semver) > 0 ||
        (comparator.semver.compare(lowerBound.semver) === 0 &&
          comparator.operator === '>')
      ) {
        lowerBound = comparator
      }
    } else if (comparator.operator === '<' || comparator.operator === '<=') {
      if (
        !upperBound ||
        comparator.semver.compare(upperBound.semver) < 0 ||
        (comparator.semver.compare(upperBound.semver) === 0 &&
          comparator.operator === '<')
      ) {
        upperBound = comparator
      }
    }
  }

  return [lowerBound?.value, upperBound?.value].filter(Boolean).join(' ')
}
