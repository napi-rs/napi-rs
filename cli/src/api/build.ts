import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp as mkdtempAsync, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'

import * as colors from 'colorette'

import type { BuildOptions as RawBuildOptions } from '../def/build.js'
import {
  CLI_VERSION,
  commitFileSystemTransaction,
  copyFileAtomic,
  type Crate,
  debugFactory,
  DEFAULT_TYPE_DEF_HEADER,
  fileExists,
  getSystemDefaultTarget,
  getNapiDeriveDependentCrates,
  getPackageReconciliationRoot,
  getTargetLinker,
  mkdirAsync,
  type NapiConfig,
  parseMetadata,
  parseTriple,
  processTypeDef,
  readFileAsync,
  readNapiConfig,
  rebaseDeclarationSpecifiers,
  removeNodeStreamWebTypeImports,
  rewriteUnboundNodeGlobalTypeQueries,
  rewriteTypeImportReferences,
  type Target,
  targetToEnvVar,
  tryInstallCargoBinary,
  unlinkAsync,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  writeFileAtomic,
  withFileSystemReconciliation,
  dirExistsAsync,
  readdirAsync,
  type CargoWorkspaceMetadata,
} from '../utils/index.js'

import { createCjsBinding, createEsmBinding } from './templates/index.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
  createWasiDeferredBrowserBinding,
  createWasiDeferredBrowserBindingTypeDef,
} from './templates/load-wasi-template.js'
import {
  createWasiBrowserWorkerBinding,
  WASI_WORKER_TEMPLATE,
} from './templates/wasi-worker-template.js'

const debug = debugFactory('build')
const require = createRequire(import.meta.url)
const MANAGED_WASI_FLAVORS = [
  { platformArchABI: 'wasm32-wasi', loaderSuffix: 'wasi', hasThreads: true },
  {
    platformArchABI: 'wasm32-wasip1',
    loaderSuffix: 'wasip1',
    hasThreads: false,
  },
] as const

type OutputKind = 'js' | 'dts' | 'node' | 'exe' | 'wasm'
type Output = { kind: OutputKind; path: string }
type WasiBindingMetadata = {
  exports: string[]
  bindingTypeDef?: string
}

type BuildOptions = RawBuildOptions & { cargoOptions?: string[] }
type ParsedBuildOptions = Omit<BuildOptions, 'cwd'> & { cwd: string }

export const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'

type CargoConfigFingerprint = readonly [path: string, hash: string]

export function getCargoDependencyGraphFingerprint(
  metadata: CargoWorkspaceMetadata,
  rootPackageId: string,
): string {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]))
  const nodes = new Map(
    (metadata.resolve?.nodes ?? []).map((node) => [node.id, node]),
  )
  const pending = [rootPackageId]
  const visited = new Set<string>()
  const graph = []

  while (pending.length > 0) {
    const id = pending.pop()!
    if (visited.has(id)) {
      continue
    }
    visited.add(id)

    const node = nodes.get(id)
    const pkg = packages.get(id)
    const dependencies = (node?.deps ?? [])
      .map((dependency) => ({
        name: dependency.name,
        pkg: dependency.pkg,
        kinds: dependency.dep_kinds
          .map(({ kind, target }) => ({ kind, target }))
          .sort(
            (left, right) =>
              (left.kind ?? '').localeCompare(right.kind ?? '') ||
              (left.target ?? '').localeCompare(right.target ?? ''),
          ),
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      )
    for (const dependency of dependencies) {
      pending.push(dependency.pkg)
    }

    graph.push({
      id,
      manifestPath: pkg?.manifest_path,
      resolvedFeatures: [...(node?.features ?? [])].sort(),
      dependencies,
      declaredDependencies: (pkg?.dependencies ?? [])
        .map((dependency) => ({
          name: dependency.name,
          source: dependency.source,
          requirement: dependency.req,
          kind: dependency.kind,
          rename: dependency.rename,
          optional: dependency.optional,
          usesDefaultFeatures: dependency.uses_default_features,
          features: [...dependency.features].sort(),
          target: dependency.target,
          registry: dependency.registry,
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
      declaredFeatures: Object.entries(pkg?.features ?? {})
        .map(([name, features]) => [name, [...features].sort()] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    })
  }

  graph.sort((left, right) => left.id.localeCompare(right.id))
  return createHash('sha256').update(JSON.stringify(graph)).digest('hex')
}

export function getTypeDefCacheFolder(options: {
  targetDir: string
  crateName: string
  manifestPath: string
  targetTriple: string
  profile: string
  features?: string[]
  allFeatures?: boolean
  noDefaultFeatures?: boolean
  cargoOptions?: string[]
  rustFlags?: Record<string, string | undefined>
  cargoProfileEnv?: Record<string, string | undefined>
  cargoConfig?: CargoConfigFingerprint[]
  cargoDependencyGraph?: string
}) {
  const features = [
    ...new Set(
      (options.features ?? []).flatMap((feature) =>
        feature.split(/[,\s]+/).filter(Boolean),
      ),
    ),
  ].sort()
  const rustFlags = Object.entries(options.rustFlags ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  const cargoConfig = [...(options.cargoConfig ?? [])].sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const cargoProfileEnv = Object.entries(options.cargoProfileEnv ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  const identity = JSON.stringify({
    version: 4,
    cliVersion: CLI_VERSION,
    manifestPath: options.manifestPath,
    cargoDependencyGraph: options.cargoDependencyGraph,
    targetTriple: options.targetTriple,
    profile: options.profile,
    features: {
      selected: features,
      all: options.allFeatures === true,
      noDefault: options.noDefaultFeatures === true,
    },
    cargoOptions: options.cargoOptions ?? [],
    rustFlags,
    cargoProfileEnv,
    cargoConfig,
  })
  const hash = createHash('sha256')
    .update(identity)
    .digest('hex')
    .substring(0, 16)

  return join(options.targetDir, 'napi-rs', `${options.crateName}-${hash}`)
}

export function createWasiCompilerFlags(
  wasiSdkPath: string,
  wasiTarget: string,
  hasThreads: boolean,
  shellEscapedFlags = true,
) {
  const compileArguments = [
    `--target=${wasiTarget}`,
    `--sysroot=${join(wasiSdkPath, 'share', 'wasi-sysroot')}`,
    ...(hasThreads ? ['-pthread'] : []),
    '-mllvm',
    '-wasm-enable-sjlj',
  ]
  const linkerArguments = [
    `-fuse-ld=${join(wasiSdkPath, 'bin', 'wasm-ld')}`,
    `--target=${wasiTarget}`,
  ]
  return {
    compileFlags: joinCompilerArguments(compileArguments, shellEscapedFlags),
    linkerFlags: joinCompilerArguments(linkerArguments, shellEscapedFlags),
  }
}

export function createArtifactDestinationName(
  binaryName: string,
  target: Target,
  sourceName: string,
  platform: boolean,
) {
  let destinationName = binaryName
  if (platform || target.platform === 'wasi') {
    destinationName += `.${target.platformArchABI}`
  }
  return `${destinationName}.${sourceName.endsWith('.wasm') ? 'wasm' : 'node'}`
}

function joinCompilerArguments(
  arguments_: string[],
  shellEscapedFlags: boolean,
) {
  if (!shellEscapedFlags) {
    const argumentWithWhitespace = arguments_.find((argument) =>
      /\s/.test(argument),
    )
    if (argumentWithWhitespace) {
      throw new Error(
        `CC_SHELL_ESCAPED_FLAGS disables shell parsing, so the WASI SDK argument cannot contain whitespace: ${argumentWithWhitespace}`,
      )
    }
    return arguments_.join(' ')
  }
  return arguments_
    .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
    .join(' ')
}

function envBoolean(value: string | undefined) {
  return (
    value !== undefined &&
    value !== '' &&
    value !== '0' &&
    value !== 'false' &&
    value !== 'no'
  )
}

function createWasiArtifactMetadata(
  rootEntry: string | null,
  binaryName: string,
  exports: string[],
) {
  return `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry,
    exports,
    managedRootEntries: [
      'browser.js',
      ...(rootEntry ? [rootEntry] : []),
      `${binaryName}.wasm`,
      `${binaryName}.debug.wasm`,
    ],
  })}\n`
}

function parseExistingWasiArtifactMetadata(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0]
  if (!firstLine.startsWith(WASI_ARTIFACT_METADATA_PREFIX)) {
    return undefined
  }
  try {
    const metadata = JSON.parse(
      firstLine.slice(WASI_ARTIFACT_METADATA_PREFIX.length),
    ) as Record<string, unknown>
    if (
      (metadata.version !== 1 && metadata.version !== 2) ||
      (metadata.rootEntry !== null && typeof metadata.rootEntry !== 'string')
    ) {
      return undefined
    }
    const managedRootEntries =
      metadata.version === 1
        ? ['browser.js', ...(metadata.rootEntry ? [metadata.rootEntry] : [])]
        : metadata.managedRootEntries
    if (
      !Array.isArray(managedRootEntries) ||
      !managedRootEntries.every((entry) => typeof entry === 'string')
    ) {
      return undefined
    }
    const exports = metadata.exports
    return {
      managedRootEntries,
      exports:
        Array.isArray(exports) &&
        exports.every((entry) => typeof entry === 'string')
          ? exports
          : undefined,
    }
  } catch {
    return undefined
  }
}

function resolveManagedOutputPath(
  outputDir: string,
  entry: string,
  description: string,
) {
  if (!entry || isAbsolute(entry)) {
    throw new Error(
      `${description} must be a non-empty relative path: ${entry}`,
    )
  }
  const outputRoot = resolve(outputDir)
  const path = resolve(outputRoot, entry)
  const relativePath = relative(outputRoot, path)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${description} escapes its output directory: ${entry}`)
  }
  return path
}

export function selectWasiBrowserTarget(
  buildTarget: Target,
  configuredTargets: Target[],
  emittedTargets: Target[],
) {
  if (buildTarget.platform === 'wasi') {
    return buildTarget
  }
  const configuredWasiTargets = configuredTargets.filter(
    (target) => target.platform === 'wasi',
  )
  return (
    configuredWasiTargets.find((target) => !wasiTargetHasThreads(target)) ??
    configuredWasiTargets[0] ??
    emittedTargets.find((target) => !wasiTargetHasThreads(target)) ??
    emittedTargets[0]
  )
}

export function createWasiBrowserEntry(
  packageName: string,
  platformArchABI: string,
  idents: string[],
) {
  const packageSpecifier = `${packageName}-${platformArchABI}`
  return (
    `export * from '${packageSpecifier}'\n` +
    (idents.length === 0
      ? `export { default } from '${packageSpecifier}'\n`
      : '')
  )
}

export function createWasiDeferredBindingTypeDef(
  bindingModuleSpecifier: string,
  hasTypeDef: boolean,
) {
  const typeDef = createWasiDeferredBrowserBindingTypeDef(
    bindingModuleSpecifier,
  )
  if (hasTypeDef) {
    return typeDef
  }

  const rootBindingType = `typeof import('${bindingModuleSpecifier}')`
  if (!typeDef.includes(rootBindingType)) {
    throw new Error(
      'The deferred WASI type definition no longer contains its root binding type',
    )
  }

  return typeDef.replace(rootBindingType, 'Record<string, unknown>')
}

export function prepareWasiBindingTypeDef(
  source: string,
  sourcePath: string,
  destinationPath: string,
  hasThreads: boolean,
  packageType?: 'module' | 'commonjs',
) {
  if (
    sourcePath.endsWith('.d.mts') ||
    (sourcePath.endsWith('.d.ts') && packageType === 'module')
  ) {
    throw new Error(
      `Cannot emit the CommonJS WASI declaration ${destinationPath} from the ESM declaration ${sourcePath}. Use a .d.cts --dts path for WASI builds in module packages.`,
    )
  }
  const targetSource = hasThreads
    ? source
    : rewriteUnboundNodeGlobalTypeQueries(
        removeNodeStreamWebTypeImports(source),
      )
  return rebaseDeclarationSpecifiers(targetSource, sourcePath, destinationPath)
}

export function collectStaleWasiBuildOutputNames(
  binaryName: string,
  buildTarget: Target,
  configuredTargets: Target[],
) {
  const staleNames = new Set<string>()
  const retainedFlavors = new Set(
    [
      ...configuredTargets.filter((target) => target.platform === 'wasi'),
      buildTarget,
    ].map((target) => target.platformArchABI),
  )
  for (const flavor of MANAGED_WASI_FLAVORS) {
    const regenerated = flavor.platformArchABI === buildTarget.platformArchABI
    if (!regenerated && retainedFlavors.has(flavor.platformArchABI)) {
      continue
    }
    for (const suffix of [
      `${flavor.loaderSuffix}.cjs`,
      `${flavor.loaderSuffix}.d.cts`,
      `${flavor.loaderSuffix}-browser.js`,
      `${flavor.loaderSuffix}-deferred.js`,
      `${flavor.loaderSuffix}-deferred.d.ts`,
      ...(!regenerated
        ? [
            `${flavor.platformArchABI}.wasm`,
            `${flavor.platformArchABI}.debug.wasm`,
          ]
        : []),
    ]) {
      staleNames.add(`${binaryName}.${suffix}`)
    }
  }
  const regeneratesWorkers = wasiTargetHasThreads(buildTarget)
  const retainsThreadedFlavor = MANAGED_WASI_FLAVORS.some(
    (flavor) =>
      flavor.hasThreads && retainedFlavors.has(flavor.platformArchABI),
  )
  if (regeneratesWorkers || !retainsThreadedFlavor) {
    staleNames.add('wasi-worker.mjs')
    staleNames.add('wasi-worker-browser.mjs')
  }
  return staleNames
}

export function removeWasmCustomSection(
  binary: Uint8Array,
  sectionName: string,
): Uint8Array {
  if (
    binary.length < 8 ||
    binary[0] !== 0x00 ||
    binary[1] !== 0x61 ||
    binary[2] !== 0x73 ||
    binary[3] !== 0x6d
  ) {
    throw new Error('Invalid WebAssembly module header')
  }

  const retainedChunks: Uint8Array[] = []
  let retainedStart = 0
  let offset = 8
  let removed = false

  while (offset < binary.length) {
    const sectionStart = offset
    const sectionId = binary[offset++]
    const sectionSize = readWasmU32(binary, offset)
    const payloadStart = sectionSize.nextOffset
    const sectionEnd = payloadStart + sectionSize.value
    if (sectionEnd > binary.length) {
      throw new Error('Invalid WebAssembly section size')
    }

    let shouldRemove = false
    if (sectionId === 0) {
      const nameSize = readWasmU32(binary, payloadStart)
      const nameEnd = nameSize.nextOffset + nameSize.value
      if (nameEnd > sectionEnd) {
        throw new Error('Invalid WebAssembly custom section name')
      }
      shouldRemove =
        Buffer.from(binary.subarray(nameSize.nextOffset, nameEnd)).toString(
          'utf8',
        ) === sectionName
    }

    if (shouldRemove) {
      retainedChunks.push(binary.subarray(retainedStart, sectionStart))
      retainedStart = sectionEnd
      removed = true
    }
    offset = sectionEnd
  }

  if (!removed) {
    return binary
  }
  retainedChunks.push(binary.subarray(retainedStart))
  const outputLength = retainedChunks.reduce(
    (length, chunk) => length + chunk.length,
    0,
  )
  const output = new Uint8Array(outputLength)
  let outputOffset = 0
  for (const chunk of retainedChunks) {
    output.set(chunk, outputOffset)
    outputOffset += chunk.length
  }
  return output
}

function readWasmU32(binary: Uint8Array, start: number) {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < binary.length && shift <= 28) {
    const byte = binary[offset++]
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: offset }
    }
    shift += 7
  }
  throw new Error('Invalid WebAssembly unsigned LEB128 value')
}

export async function buildProject(rawOptions: BuildOptions) {
  debug('napi build command receive options: %O', rawOptions)

  const options: ParsedBuildOptions = {
    dtsCache: true,
    ...rawOptions,
    cwd: rawOptions.cwd ?? process.cwd(),
  }

  // Reject invalid cross-compilation flag combinations before anything with
  // a side effect runs (`cargo metadata`, cargo binary auto-installs,
  // toolchain downloads, ...), so the user always gets the validation error
  // rather than an unrelated failure from those steps.
  validateCrossCompileFlags(options)
  if (options.useNapiCross) {
    // Check the host constraint before resolving the target: without an
    // explicit `--target` (or `CARGO_BUILD_TARGET`) the target resolution
    // spawns `rustc -vV`, and on an unsupported host without Rust on the
    // `PATH` that spawn failure would mask the actual validation error.
    validateNapiCrossHost()
    validateNapiCrossSupport(resolveTarget(options.target).triple)
  }

  const resolvePath = (...paths: string[]) => resolve(options.cwd, ...paths)

  const manifestPath = resolvePath(options.manifestPath ?? 'Cargo.toml')
  const metadataTarget = options.target ?? process.env.CARGO_BUILD_TARGET
  const metadata = await parseMetadata(manifestPath, {
    cwd: options.cwd,
    featurePackage: options.package,
    features: options.features,
    allFeatures: options.allFeatures,
    noDefaultFeatures: options.noDefaultFeatures,
    cargoOptions: options.cargoOptions,
    filterPlatform: metadataTarget
      ? parseTriple(metadataTarget).triple
      : undefined,
  })

  const crate = metadata.packages.find((p) => {
    // package with given name
    if (options.package) {
      return p.name === options.package
    } else {
      return p.manifest_path === manifestPath
    }
  })

  if (!crate) {
    throw new Error(
      'Unable to find crate to build. It seems you are trying to build a crate in a workspace, try using `--package` option to specify the package to build.',
    )
  }
  const config = await readNapiConfig(
    resolvePath(options.packageJsonPath ?? 'package.json'),
    options.configPath ? resolvePath(options.configPath) : undefined,
  )

  const builder = new Builder(metadata, crate, config, options)

  return builder.build()
}

/**
 * Resolve the target triple the build will run against, following the same
 * precedence the build itself uses: the explicit `--target` option, then the
 * `CARGO_BUILD_TARGET` environment variable, then the host default target.
 */
function resolveTarget(targetOption?: string): Target {
  return targetOption
    ? parseTriple(targetOption)
    : process.env.CARGO_BUILD_TARGET
      ? parseTriple(process.env.CARGO_BUILD_TARGET)
      : getSystemDefaultTarget()
}

/**
 * Validate the combination of the cross-compilation related flags.
 *
 * `--use-cross`, `--use-napi-cross` and `--cross-compile` (`-x`) are three
 * mutually exclusive cross-compilation mechanisms; combining any two of them
 * leaves both active at once and produces broken builds, so it is rejected
 * upfront before any side effect (like auto-installing cargo binaries or
 * downloading toolchains) happens.
 *
 * `--cross-compile` with a `windows-gnu` target is rejected as well: on a
 * non-Windows host it routes the build to `cargo xwin build`, but
 * `cargo-xwin` only sets up MSVC toolchains — for `windows-gnu` targets it
 * silently does nothing and the build dies much later with a cryptic
 * ``error: linker `x86_64-w64-mingw32-gcc` not found`` that never mentions
 * `cargo-xwin`. Only an explicitly requested target (`--target` or
 * `CARGO_BUILD_TARGET`) is inspected, so this validation never has to spawn
 * `rustc -vV`; a non-Windows host's default target can never be
 * `windows-gnu` anyway.
 */
export function validateCrossCompileFlags(
  options: {
    useCross?: boolean
    crossCompile?: boolean
    useNapiCross?: boolean
    watch?: boolean
    target?: string
  },
  hostPlatform: string = process.platform,
): void {
  const enabledCrossFlags = [
    options.useCross ? '`--use-cross`' : null,
    options.useNapiCross ? '`--use-napi-cross`' : null,
    options.crossCompile ? '`--cross-compile` (`-x`)' : null,
  ].filter((flag): flag is string => flag !== null)

  if (enabledCrossFlags.length > 1) {
    throw new Error(
      `${enabledCrossFlags.join(' and ')} cannot be used together. Please pick exactly one cross-compilation mechanism: \`--use-cross\`, \`--use-napi-cross\`, or \`--cross-compile\` (\`-x\`).`,
    )
  }

  if (options.watch && options.useCross) {
    throw new Error(
      '`--watch` cannot be used with `--use-cross`. `cargo watch` only supports the plain `cargo build` flow, please drop one of the two flags.',
    )
  }

  if (options.watch && options.crossCompile) {
    throw new Error(
      '`--watch` cannot be used with `--cross-compile` (`-x`). `cargo watch` only supports the plain `cargo build` flow, please drop one of the two flags.',
    )
  }

  // On a Windows host `--cross-compile` never picks `cargo-xwin` (it falls
  // back to a plain `cargo build`), so windows-gnu targets are only broken
  // on non-Windows hosts.
  if (options.crossCompile && hostPlatform !== 'win32') {
    const explicitTarget = options.target ?? process.env.CARGO_BUILD_TARGET
    if (explicitTarget) {
      const target = parseTriple(explicitTarget)
      if (target.platform === 'win32' && target.abi?.startsWith('gnu')) {
        const msvcTriple = explicitTarget.replace(/gnu(llvm)?$/, 'msvc')
        // `*-windows-gnu` links with a mingw-w64 GCC toolchain, while
        // `*-windows-gnullvm` needs an LLVM toolchain (llvm-mingw): `rustc`
        // has no default working linker for it without one on the `PATH`.
        const toolchainHint =
          target.abi === 'gnullvm'
            ? `an llvm-mingw (LLVM/Clang) toolchain on the \`PATH\` (\`rustc\` has no default working linker for ${explicitTarget} without one; \`napi-build\` additionally needs \`libnode.dll\` via the \`LIBNODE_PATH\` environment variable)`
            : `a mingw-w64 toolchain (\`rustc\` uses the \`${explicitTarget.split('-')[0]}-w64-mingw32-gcc\` linker; \`napi-build\` additionally needs \`libnode.dll\` via the \`LIBNODE_PATH\` environment variable)`
        throw new Error(
          `\`--cross-compile\` (\`-x\`) does not support the target ${explicitTarget}: \`cargo-xwin\` only handles MSVC targets and the build would fail at link time. Drop \`-x\` and build with ${toolchainHint}, or target ${msvcTriple} instead.`,
        )
      }
    }
  }
}

/**
 * Validate that the current host can run the `@napi-rs/cross-toolchain`
 * pre-built toolchains at all: they only run on Linux x64 and Linux arm64
 * hosts. This check is separate from (and must run before) the per-target
 * validation, because resolving the target may need to spawn `rustc`.
 */
function validateNapiCrossHost(
  hostPlatform: string = process.platform,
  hostArch: string = process.arch,
): asserts hostArch is 'x64' | 'arm64' {
  if (
    hostPlatform !== 'linux' ||
    (hostArch !== 'x64' && hostArch !== 'arm64')
  ) {
    throw new Error(
      `\`--use-napi-cross\` requires a Linux x64 or Linux arm64 host, but the current host is ${hostPlatform}-${hostArch}. Please use \`--cross-compile\` (\`-x\`) or \`--use-cross\` to cross compile on this host.`,
    )
  }
}

/**
 * Validate that `--use-napi-cross` can actually handle the requested target
 * on the current host. The supported target set is read from the
 * `@napi-rs/cross-toolchain` package, and the pre-built toolchains only run
 * on Linux x64 and Linux arm64 hosts.
 */
export function validateNapiCrossSupport(
  targetTriple: string,
  hostPlatform: string = process.platform,
  hostArch: string = process.arch,
): void {
  validateNapiCrossHost(hostPlatform, hostArch)

  const toolchains: Record<
    'x64' | 'arm64',
    Record<string, string | undefined>
  > = require('@napi-rs/cross-toolchain')
  const supportedTargets = Object.keys(toolchains[hostArch])

  if (!supportedTargets.includes(targetTriple)) {
    throw new Error(
      `\`--use-napi-cross\` does not support the target ${targetTriple}. Supported targets: ${supportedTargets.join(', ')}. Please use \`--cross-compile\` (\`-x\`) or \`--use-cross\` for this target.`,
    )
  }
}

/**
 * Compute the environment variables that route a `--use-napi-cross` build
 * through the `@napi-rs/cross-toolchain` toolchain extracted at
 * `toolchainPath`.
 *
 * Follows the same rule as `Builder#setEnvIfNotExists`: a variable the user
 * already set in `env` wins and is not returned, and a present-but-empty
 * variable counts as unset (falsy semantics). The only exceptions are the
 * clang-specific `TARGET_CFLAGS`/`TARGET_CXXFLAGS`, which prepend the sysroot
 * flags to the user's value, and `PATH`, which always gets the toolchain
 * `bin` directory prepended.
 *
 * Exported for tests.
 */
export function napiCrossToolchainEnvs(
  toolchainPath: string,
  targetTriple: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const alias: Record<string, string> = {
    's390x-unknown-linux-gnu': 's390x-ibm-linux-gnu',
  }

  const envs: Record<string, string> = {}
  const setEnvIfNotExists = (name: string, value: string) => {
    if (!env[name]) {
      envs[name] = value
    }
  }

  const upperCaseTarget = targetToEnvVar(targetTriple)
  const crossTargetName = alias[targetTriple] ?? targetTriple
  setEnvIfNotExists(
    `CARGO_TARGET_${upperCaseTarget}_LINKER`,
    join(toolchainPath, 'bin', `${crossTargetName}-gcc`),
  )
  setEnvIfNotExists(
    'TARGET_SYSROOT',
    join(toolchainPath, crossTargetName, 'sysroot'),
  )
  setEnvIfNotExists(
    'TARGET_AR',
    join(toolchainPath, 'bin', `${crossTargetName}-ar`),
  )
  setEnvIfNotExists(
    'TARGET_RANLIB',
    join(toolchainPath, 'bin', `${crossTargetName}-ranlib`),
  )
  setEnvIfNotExists(
    'TARGET_READELF',
    join(toolchainPath, 'bin', `${crossTargetName}-readelf`),
  )
  setEnvIfNotExists(
    'TARGET_C_INCLUDE_PATH',
    join(toolchainPath, crossTargetName, 'sysroot', 'usr', 'include/'),
  )
  setEnvIfNotExists(
    'TARGET_CC',
    join(toolchainPath, 'bin', `${crossTargetName}-gcc`),
  )
  setEnvIfNotExists(
    'TARGET_CXX',
    join(toolchainPath, 'bin', `${crossTargetName}-g++`),
  )
  // `setEnvIfNotExists` skips `envs` when the user already set the variable
  // in their environment, so read the effective value back from `env` first
  // — with the same falsy semantics: a present-but-empty `TARGET_SYSROOT`
  // counts as unset and falls back to the downloaded sysroot (`??` would
  // keep the empty string and produce a broken `--sysroot=`).
  const targetSysroot = env.TARGET_SYSROOT || envs.TARGET_SYSROOT
  setEnvIfNotExists('BINDGEN_EXTRA_CLANG_ARGS', `--sysroot=${targetSysroot}`)

  // cc-rs parses the env value before executing it (`env_tool` in cc's
  // lib.rs): when the WHOLE value exists on the filesystem (`check_exe`)
  // it is the compiler as-is — that is how it supports spaces in paths
  // like `/opt/LLVM 18/bin/clang` — and only otherwise is the value split
  // on whitespace; then, when the first token is a known wrapper
  // (`sccache clang`) the second token is the compiler that actually runs,
  // otherwise the first token is and the rest are arguments
  // (`clang -target …`). Mirror that ordering, filesystem probe included:
  // a pure whole-value basename heuristic would misread argument forms
  // that merely END in `clang`, like `gcc --sysroot=/opt/clang`, and
  // inject clang-only flags into a gcc compile. Match on the executable
  // name so path-qualified (`/usr/bin/clang`), triple-prefixed
  // (`aarch64-linux-gnu-clang`) and versioned (`clang-18`) compilers are
  // all recognized — but not clang-family tools that are not compilers
  // (`clang-format`).
  const ccWrappers = new Set([
    'ccache',
    'distcc',
    'sccache',
    'icecc',
    'cachepot',
    'buildcache',
    'kache',
  ])
  const clangExecutableName = /(^|-)clang(\+\+)?(-\d+)?$/
  // cc-rs's `check_exe` only probes for existence (plus an `.exe` retry on
  // Windows, where this napi-cross path never runs); requiring a regular
  // file additionally keeps directories from being taken for compilers.
  const isExistingFile = (path: string): boolean => {
    try {
      return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
    } catch {
      return false
    }
  }
  const isClangCompiler = (value: string | undefined): boolean => {
    if (!value) {
      return false
    }
    const trimmed = value.trim()
    if (isExistingFile(trimmed)) {
      return clangExecutableName.test(basename(trimmed))
    }
    const [first, second] = trimmed.split(/\s+/)
    const compiler = first && ccWrappers.has(basename(first)) ? second : first
    return (
      compiler !== undefined && clangExecutableName.test(basename(compiler))
    )
  }

  // Detect clang on the EFFECTIVE target compiler: the user's TARGET_CC if
  // set, otherwise the toolchain gcc exported above (`envs.TARGET_CC`).
  // cc-rs prefers TARGET_CC over CC for cross builds, so a plain `CC=clang`
  // never runs here and must not trigger the clang-only `--gcc-toolchain=`
  // flag (gcc hard-errors on it). The trailing `env.CC`/`env.CXX` terms are
  // unreachable today (exactly one of the first two is always truthy) but
  // keep the check correct if the toolchain default ever becomes conditional.
  if (isClangCompiler(env.TARGET_CC || envs.TARGET_CC || env.CC)) {
    const TARGET_CFLAGS = env.TARGET_CFLAGS || ''
    envs.TARGET_CFLAGS = `--sysroot=${targetSysroot} --gcc-toolchain=${toolchainPath} ${TARGET_CFLAGS}`
  }
  if (isClangCompiler(env.TARGET_CXX || envs.TARGET_CXX || env.CXX)) {
    const TARGET_CXXFLAGS = env.TARGET_CXXFLAGS || ''
    envs.TARGET_CXXFLAGS = `--sysroot=${targetSysroot} --gcc-toolchain=${toolchainPath} ${TARGET_CXXFLAGS}`
  }
  envs.PATH = env.PATH
    ? `${toolchainPath}/bin:${env.PATH}`
    : `${toolchainPath}/bin`
  return envs
}

class Builder {
  private readonly args: string[] = []
  private readonly envs: Record<string, string> = {}
  private readonly outputs: Output[] = []

  private readonly target: Target
  private readonly crateDir: string
  private readonly finalOutputDir: string
  private outputDir: string
  private readonly reconciliationRoot: string
  private readonly targetDir: string
  private readonly enableTypeDef: boolean = false
  private readonly stagedOutputDestinations = new Map<string, string>()
  private typeDefWithTypeImports: string | undefined

  constructor(
    private readonly metadata: CargoWorkspaceMetadata,
    private readonly crate: Crate,
    private readonly config: NapiConfig,
    private readonly options: ParsedBuildOptions,
  ) {
    this.target = resolveTarget(options.target)
    this.crateDir = parse(crate.manifest_path).dir
    this.finalOutputDir = resolve(
      this.options.cwd,
      options.outputDir ?? this.crateDir,
    )
    this.outputDir = this.finalOutputDir
    this.reconciliationRoot = getPackageReconciliationRoot(
      this.options.cwd,
      this.options.packageJsonPath,
    )
    this.targetDir =
      options.targetDir ??
      process.env.CARGO_BUILD_TARGET_DIR ??
      metadata.target_directory
    this.enableTypeDef = this.crate.dependencies.some(
      (dep) =>
        dep.name === 'napi-derive' &&
        (dep.uses_default_features || dep.features.includes('type-def')),
    )

    if (!this.enableTypeDef) {
      const requirementWarning =
        '`napi-derive` crate is not used or `type-def` feature is not enabled for `napi-derive` crate'
      debug.warn(
        `${requirementWarning}. Will skip binding generation for \`.node\`, \`.wasi\` and \`.d.ts\` files.`,
      )

      if (
        this.options.dts ||
        this.options.dtsHeader ||
        this.config.dtsHeader ||
        this.config.dtsHeaderFile
      ) {
        debug.warn(
          `${requirementWarning}. \`dts\` related options are enabled but will be ignored.`,
        )
      }
    }
  }

  get cdyLibName() {
    if (this.options.bin) {
      return
    }
    return this.crate.targets.find((t) => t.crate_types.includes('cdylib'))
      ?.name
  }

  get binName() {
    return (
      this.options.bin ??
      // only available if not cdylib or bin name specified
      (this.cdyLibName
        ? null
        : this.crate.targets.find((t) => t.crate_types.includes('bin'))?.name)
    )
  }

  async build() {
    // Backstop only: `buildProject()` already validated these before running
    // anything with a side effect (see the top of `buildProject`). Kept here
    // so a directly constructed `Builder` cannot skip the validation.
    validateCrossCompileFlags(this.options)
    if (this.options.useNapiCross) {
      validateNapiCrossSupport(this.target.triple)
    }

    if (this.options.bin) {
      debug.warn(
        `Building Cargo binary target ${this.binName}; the result will be an executable, not a Node.js addon.`,
      )
    } else if (!this.cdyLibName) {
      const warning =
        'Missing `crate-type = ["cdylib"]` in [lib] config. The build result will not be available as node addon.'

      if (this.binName) {
        debug.warn(warning)
      } else {
        throw new Error(warning)
      }
    }

    this.pickBinary()
      .setPackage()
      .setFeatures()
      .setTarget()
      .pickCrossToolchain()
    await this.setEnvs()
    return this.setBypassArgs().exec()
  }

  private pickCrossToolchain() {
    if (!this.options.useNapiCross) {
      return this
    }

    try {
      const { version, download } = require('@napi-rs/cross-toolchain')

      const toolchainPath = join(
        homedir(),
        '.napi-rs',
        'cross-toolchain',
        version,
        this.target.triple,
      )
      mkdirSync(toolchainPath, { recursive: true })
      if (existsSync(join(toolchainPath, 'package.json'))) {
        debug(`Toolchain ${toolchainPath} exists, skip extracting`)
      } else {
        const tarArchive = download(process.arch, this.target.triple)
        tarArchive.unpack(toolchainPath)
      }
      Object.assign(
        this.envs,
        napiCrossToolchainEnvs(toolchainPath, this.target.triple),
      )
    } catch (e) {
      throw new Error(
        `Failed to set up the \`--use-napi-cross\` toolchain for ${this.target.triple}: ${(e as Error).message}. Check filesystem permissions and network connectivity to the npm registry, then retry, or use \`--cross-compile\` (\`-x\`) / \`--use-cross\` instead.`,
        { cause: e },
      )
    }
    return this
  }

  private exec() {
    debug(`Start building crate: ${this.crate.name}`)
    debug('  %i', `cargo ${this.args.join(' ')}`)

    const controller = new AbortController()

    const watch = this.options.watch
    const buildTask = new Promise<void>((resolve, reject) => {
      const cargoOverride = process.env.CARGO
      if (
        cargoOverride &&
        (this.options.useCross || this.options.crossCompile)
      ) {
        const expectedBinary = this.options.useCross ? 'cross' : 'cargo'
        const requestedFlag = this.options.useCross
          ? '`--use-cross`'
          : '`--cross-compile` (`-x`)'
        debug.warn(
          `The \`CARGO\` environment variable is set to \`${cargoOverride}\`; it will be spawned instead of the \`${expectedBinary}\` binary that ${requestedFlag} relies on. Unset \`CARGO\` if this is not intended.`,
        )
      }
      const command =
        cargoOverride ?? (this.options.useCross ? 'cross' : 'cargo')
      const buildProcess = spawn(command, this.args, {
        env: { ...process.env, ...this.envs },
        stdio: watch ? ['inherit', 'inherit', 'pipe'] : 'inherit',
        cwd: this.options.cwd,
        signal: controller.signal,
      })

      buildProcess.once('exit', (code) => {
        if (code === 0) {
          debug('%i', `Build crate ${this.crate.name} successfully!`)
          resolve()
        } else {
          reject(new Error(`Build failed with exit code ${code}`))
        }
      })

      buildProcess.once('error', (e) => {
        reject(new Error(`Build failed with error: ${e.message}`, { cause: e }))
      })

      // watch mode only, they are piped through stderr
      buildProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        console.error(output)
        if (/Finished\s(`dev`|`release`)/.test(output)) {
          this.postBuild().catch(() => {})
        }
      })
    })

    return {
      task: buildTask.then(() => this.postBuild()),
      abort: () => controller.abort(),
    }
  }

  private async collectStaleBuildOutputPaths() {
    const stalePaths = new Set<string>()
    const managedRootEntries = await this.readManagedWasiRootEntries()

    for (const name of collectStaleWasiBuildOutputNames(
      this.config.binaryName,
      this.target,
      this.config.targets,
    )) {
      stalePaths.add(join(this.outputDir, name))
    }
    const hasWasiOutput =
      this.target.platform === 'wasi' ||
      this.config.targets.some((target) => target.platform === 'wasi') ||
      managedRootEntries.size > 0
    if (hasWasiOutput) {
      stalePaths.add(join(this.outputDir, 'browser.js'))
      stalePaths.add(join(this.outputDir, `${this.config.binaryName}.wasm`))
      stalePaths.add(
        join(this.outputDir, `${this.config.binaryName}.debug.wasm`),
      )
      if (this.options.platform && !this.options.noJsBinding) {
        stalePaths.add(
          join(this.outputDir, this.options.jsBinding ?? 'index.js'),
        )
      }
    }
    for (const entry of managedRootEntries) {
      stalePaths.add(
        resolveManagedOutputPath(this.outputDir, entry, 'WASI root entry'),
      )
    }

    return stalePaths
  }

  private async unlinkIfExists(path: string) {
    try {
      await unlinkAsync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  private async readManagedWasiRootEntries() {
    const entries = new Set<string>()
    for (const { loaderSuffix } of MANAGED_WASI_FLAVORS) {
      const path = join(
        this.outputDir,
        `${this.config.binaryName}.${loaderSuffix}.cjs`,
      )
      if (!(await fileExists(path))) {
        continue
      }
      const metadata = parseExistingWasiArtifactMetadata(
        await readFileAsync(path, 'utf8'),
      )
      for (const entry of metadata?.managedRootEntries ?? []) {
        entries.add(entry)
      }
    }
    return entries
  }

  private async readExistingWasiBindingMetadata(wasiTarget: Target) {
    const loaderSuffix = wasiLoaderSuffix(wasiTarget.platformArchABI)
    const bindingPath = join(
      this.finalOutputDir,
      `${this.config.binaryName}.${loaderSuffix}.cjs`,
    )
    const bindingTypeDefPath = join(
      this.finalOutputDir,
      `${this.config.binaryName}.${loaderSuffix}.d.cts`,
    )
    if (
      !(await fileExists(bindingPath)) ||
      !(await fileExists(bindingTypeDefPath))
    ) {
      return undefined
    }
    const artifactMetadata = parseExistingWasiArtifactMetadata(
      await readFileAsync(bindingPath, 'utf8'),
    )
    if (artifactMetadata?.exports === undefined) {
      return undefined
    }
    return {
      exports: artifactMetadata.exports,
      bindingTypeDef: await readFileAsync(bindingTypeDefPath, 'utf8'),
    }
  }

  private pickBinary() {
    let set = false
    if (this.options.watch) {
      if (process.env.CI) {
        debug.warn('Watch mode is not supported in CI environment')
      } else {
        debug('Use %i', 'cargo-watch')
        tryInstallCargoBinary('cargo-watch', 'watch')
        // yarn napi watch --target x86_64-unknown-linux-gnu
        // ===>
        // cargo watch [...] -- cargo build --target x86_64-unknown-linux-gnu
        this.args.push(
          'watch',
          '--why',
          '-i',
          '*.{js,ts,node}',
          '-w',
          this.crateDir,
          '--',
          'cargo',
          'build',
        )
        set = true
      }
    }

    if (this.options.crossCompile) {
      if (this.target.platform === 'win32') {
        if (process.platform === 'win32') {
          debug.warn(
            'You are trying to cross compile to win32 platform on win32 platform which is unnecessary.',
          )
        } else {
          // use cargo-xwin to cross compile to win32 platform
          debug('Use %i', 'cargo-xwin')
          tryInstallCargoBinary('cargo-xwin', 'xwin')
          this.args.push('xwin', 'build')
          if (this.target.arch === 'ia32') {
            this.envs.XWIN_ARCH = 'x86'
          }
          set = true
        }
      } else {
        // use cargo-zigbuild to cross compile to other platforms
        debug('Use %i', 'cargo-zigbuild')
        tryInstallCargoBinary('cargo-zigbuild', 'zigbuild')
        this.args.push('zigbuild')
        set = true
      }
    }

    if (!set) {
      this.args.push('build')
    }
    return this
  }

  private setPackage() {
    const args = []

    if (this.options.package) {
      args.push('--package', this.options.package)
    }

    if (this.binName) {
      args.push('--bin', this.binName)
    }

    if (args.length) {
      debug('Set package flags: ')
      debug('  %O', args)
      this.args.push(...args)
    }

    return this
  }

  private setTarget() {
    debug('Set compiling target to: ')
    debug('  %i', this.target.triple)

    this.args.push('--target', this.target.triple)

    return this
  }

  private async setEnvs() {
    // RUSTFLAGS
    let rustflags =
      process.env.RUSTFLAGS ?? process.env.CARGO_BUILD_RUSTFLAGS ?? ''

    if (
      this.target.abi?.includes('musl') &&
      !rustflags.includes('target-feature=-crt-static')
    ) {
      rustflags += ' -C target-feature=-crt-static'
    }

    if (this.options.strip && !rustflags.includes('link-arg=-s')) {
      rustflags += ' -C link-arg=-s'
    }

    // TYPE DEF
    if (this.enableTypeDef) {
      this.envs.NAPI_TYPE_DEF_TMP_FOLDER =
        await this.generateIntermediateTypeDefFolder(rustflags)
      this.setForceBuildEnvs(this.envs.NAPI_TYPE_DEF_TMP_FOLDER)
    }

    if (rustflags.length) {
      this.envs.RUSTFLAGS = rustflags
    }
    // END RUSTFLAGS

    // LINKER
    const linker = this.options.crossCompile
      ? void 0
      : getTargetLinker(this.target.triple)
    // TODO:
    //   directly set CARGO_TARGET_<target>_LINKER will cover .cargo/config.toml
    //   will detect by cargo config when it becomes stable
    //   see: https://github.com/rust-lang/cargo/issues/9301
    const linkerEnv = `CARGO_TARGET_${targetToEnvVar(
      this.target.triple,
    )}_LINKER`
    if (linker && !process.env[linkerEnv] && !this.envs[linkerEnv]) {
      this.envs[linkerEnv] = linker
    }

    if (this.target.platform === 'android') {
      this.setAndroidEnv()
    }

    if (this.target.platform === 'wasi') {
      this.setWasiEnv()
    }

    if (this.target.platform === 'openharmony') {
      this.setOpenHarmonyEnv()
    }

    debug('Set envs: ')
    Object.entries(this.envs).forEach(([k, v]) => {
      debug('  %i', `${k}=${v}`)
    })

    return this
  }

  private setForceBuildEnvs(typeDefTmpFolder: string) {
    // dynamically check all napi-rs deps and set `NAPI_FORCE_BUILD_{uppercase(snake_case(name))} = timestamp`
    getNapiDeriveDependentCrates(this.metadata).forEach((crate) => {
      if (!existsSync(join(typeDefTmpFolder, crate.name))) {
        this.envs[
          `NAPI_FORCE_BUILD_${crate.name.replace(/-/g, '_').toUpperCase()}`
        ] = Date.now().toString()
      }
    })
  }

  private setAndroidEnv() {
    // Native Android hosts and `cross` provide their own Android toolchains.
    if (process.platform === 'android' || this.options.useCross) {
      return
    }

    const { ANDROID_NDK_LATEST_HOME } = process.env
    if (!ANDROID_NDK_LATEST_HOME) {
      throw new Error(
        `${colors.red(
          'ANDROID_NDK_LATEST_HOME',
        )} environment variable is required when building an Android target from a non-Android host`,
      )
    }

    const targetArch = this.target.arch === 'arm' ? 'armv7a' : 'aarch64'
    const targetPlatform =
      this.target.arch === 'arm' ? 'androideabi24' : 'android24'
    const hostPlatform =
      process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux'
    Object.assign(this.envs, {
      CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-android24-clang`,
      CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-androideabi24-clang`,
      TARGET_CC: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang`,
      TARGET_CXX: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang++`,
      TARGET_AR: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ar`,
      TARGET_RANLIB: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ranlib`,
      ANDROID_NDK: ANDROID_NDK_LATEST_HOME,
      PATH: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
    })
  }

  private setWasiEnv() {
    const emnapi = join(
      require.resolve('emnapi'),
      '..',
      'lib',
      'wasm32-wasip1-threads',
    )
    const hasThreads = wasiTargetHasThreads(this.target)
    const wasiTarget = hasThreads ? 'wasm32-wasip1-threads' : 'wasm32-wasip1'
    const emnapi = join(require.resolve('emnapi'), '..', 'lib', wasiTarget)
    const emnapiVersion = require('emnapi/package.json').version
    const emnapiArchive = join(
      emnapi,
      hasThreads ? 'libemnapi-napi-rs-mt.a' : 'libemnapi.a',
    )
    if (!existsSync(emnapiArchive)) {
      throw new Error(
        `emnapi@${emnapiVersion} is missing the ${wasiTarget} archive required by napi-rs at ${emnapiArchive}. Install emnapi v2 with support for this target.`,
      )
    }
    this.envs.EMNAPI_LINK_DIR = emnapi
    const projectRequire = createRequire(
      resolve(this.options.cwd, 'package.json'),
    )
    const emnapiCoreVersion = projectRequire(
      '@emnapi/core/package.json',
    ).version
    const emnapiRuntimeVersion = projectRequire(
      '@emnapi/runtime/package.json',
    ).version

    if (
      emnapiVersion !== emnapiCoreVersion ||
      emnapiVersion !== emnapiRuntimeVersion
    ) {
      throw new Error(
        `emnapi version mismatch: emnapi@${emnapiVersion}, @emnapi/core@${emnapiCoreVersion}, @emnapi/runtime@${emnapiRuntimeVersion}. Please ensure all emnapi packages are the same version.`,
      )
    }
    const { WASI_SDK_PATH } = process.env

    if (WASI_SDK_PATH && existsSync(WASI_SDK_PATH)) {
      this.envs.CARGO_TARGET_WASM32_WASI_PREVIEW1_THREADS_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.envs.CARGO_TARGET_WASM32_WASIP1_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.envs.CARGO_TARGET_WASM32_WASIP1_THREADS_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.envs.CARGO_TARGET_WASM32_WASIP2_LINKER = join(
        WASI_SDK_PATH,
        'bin',
        'wasm-ld',
      )
      this.setEnvIfNotExists('TARGET_CC', join(WASI_SDK_PATH, 'bin', 'clang'))
      this.setEnvIfNotExists(
        'TARGET_CXX',
        join(WASI_SDK_PATH, 'bin', 'clang++'),
      )
      this.setEnvIfNotExists('TARGET_AR', join(WASI_SDK_PATH, 'bin', 'ar'))
      this.setEnvIfNotExists(
        'TARGET_RANLIB',
        join(WASI_SDK_PATH, 'bin', 'ranlib'),
      )
      this.setEnvIfNotExists(
        'TARGET_CFLAGS',
        `--target=wasm32-wasip1-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`,
      )
      this.setEnvIfNotExists(
        'TARGET_CXXFLAGS',
        `--target=wasm32-wasip1-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`,
      )
      this.setEnvIfNotExists(
        `TARGET_LDFLAGS`,
        `-fuse-ld=${WASI_SDK_PATH}/bin/wasm-ld --target=wasm32-wasip1-threads`,
      const { compileFlags, linkerFlags } = createWasiCompilerFlags(
        WASI_SDK_PATH,
        wasiTarget,
        hasThreads,
        process.env.CC_SHELL_ESCAPED_FLAGS
          ? envBoolean(process.env.CC_SHELL_ESCAPED_FLAGS)
          : true,
      )
      this.setEnvIfNotExists('CC_SHELL_ESCAPED_FLAGS', '1')
      this.setEnvIfNotExists('TARGET_CFLAGS', compileFlags)
      this.setEnvIfNotExists('TARGET_CXXFLAGS', compileFlags)
      this.setEnvIfNotExists(`TARGET_LDFLAGS`, linkerFlags)
    }
  }

  private setOpenHarmonyEnv() {
    const { OHOS_SDK_PATH, OHOS_SDK_NATIVE } = process.env
    const ndkPath = OHOS_SDK_PATH ? `${OHOS_SDK_PATH}/native` : OHOS_SDK_NATIVE
    // @ts-expect-error
    if (!ndkPath && process.platform !== 'openharmony') {
      debug.warn(
        `${colors.red('OHOS_SDK_PATH')} or ${colors.red('OHOS_SDK_NATIVE')} environment variable is missing`,
      )
      return
    }
    const linkerName = `CARGO_TARGET_${this.target.triple.toUpperCase().replace(/-/g, '_')}_LINKER`
    const ranPath = `${ndkPath}/llvm/bin/llvm-ranlib`
    const arPath = `${ndkPath}/llvm/bin/llvm-ar`
    const ccPath = `${ndkPath}/llvm/bin/${this.target.triple}-clang`
    const cxxPath = `${ndkPath}/llvm/bin/${this.target.triple}-clang++`
    const asPath = `${ndkPath}/llvm/bin/llvm-as`
    const ldPath = `${ndkPath}/llvm/bin/ld.lld`
    const stripPath = `${ndkPath}/llvm/bin/llvm-strip`
    const objDumpPath = `${ndkPath}/llvm/bin/llvm-objdump`
    const objCopyPath = `${ndkPath}/llvm/bin/llvm-objcopy`
    const nmPath = `${ndkPath}/llvm/bin/llvm-nm`
    const binPath = `${ndkPath}/llvm/bin`
    const libPath = `${ndkPath}/llvm/lib`

    this.setEnvIfNotExists('LIBCLANG_PATH', libPath)
    this.setEnvIfNotExists('DEP_ATOMIC', 'clang_rt.builtins')
    this.setEnvIfNotExists(linkerName, ccPath)
    this.setEnvIfNotExists('TARGET_CC', ccPath)
    this.setEnvIfNotExists('TARGET_CXX', cxxPath)
    this.setEnvIfNotExists('TARGET_AR', arPath)
    this.setEnvIfNotExists('TARGET_RANLIB', ranPath)
    this.setEnvIfNotExists('TARGET_AS', asPath)
    this.setEnvIfNotExists('TARGET_LD', ldPath)
    this.setEnvIfNotExists('TARGET_STRIP', stripPath)
    this.setEnvIfNotExists('TARGET_OBJDUMP', objDumpPath)
    this.setEnvIfNotExists('TARGET_OBJCOPY', objCopyPath)
    this.setEnvIfNotExists('TARGET_NM', nmPath)
    this.envs.PATH = `${binPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`
  }

  private setFeatures() {
    const args = []
    if (this.options.allFeatures && this.options.noDefaultFeatures) {
      throw new Error(
        'Cannot specify --all-features and --no-default-features together',
      )
    }
    if (this.options.allFeatures) {
      args.push('--all-features')
    } else if (this.options.noDefaultFeatures) {
      args.push('--no-default-features')
    }
    if (this.options.features) {
      args.push('--features', ...this.options.features)
    }

    debug('Set features flags: ')
    debug('  %O', args)
    this.args.push(...args)

    return this
  }

  private setBypassArgs() {
    if (this.options.release) {
      this.args.push('--release')
    }

    if (this.options.verbose) {
      this.args.push('--verbose')
    }

    if (this.options.targetDir) {
      this.args.push('--target-dir', this.options.targetDir)
    }

    if (this.options.profile) {
      this.args.push('--profile', this.options.profile)
    }

    if (this.options.manifestPath) {
      this.args.push('--manifest-path', this.options.manifestPath)
    }

    if (this.options.cargoOptions?.length) {
      this.args.push(...this.options.cargoOptions)
    }

    return this
  }

  private async generateIntermediateTypeDefFolder(rustflags: string) {
    const targetRustFlagsEnv = `CARGO_TARGET_${targetToEnvVar(
      this.target.triple,
    )}_RUSTFLAGS`
    let folder = getTypeDefCacheFolder({
      targetDir: this.targetDir,
      crateName: this.crate.name,
      manifestPath: this.crate.manifest_path,
      targetTriple: this.target.triple,
      profile:
        this.options.profile ?? (this.options.release ? 'release' : 'dev'),
      features: this.options.features,
      allFeatures: this.options.allFeatures,
      noDefaultFeatures: this.options.noDefaultFeatures,
      cargoOptions: this.options.cargoOptions,
      rustFlags: {
        RUSTFLAGS: rustflags || undefined,
        CARGO_ENCODED_RUSTFLAGS: process.env.CARGO_ENCODED_RUSTFLAGS,
        CARGO_BUILD_RUSTFLAGS: process.env.CARGO_BUILD_RUSTFLAGS,
        [targetRustFlagsEnv]: process.env[targetRustFlagsEnv],
      },
      cargoProfileEnv: Object.fromEntries(
        Object.entries(process.env).filter(([name]) =>
          name.startsWith('CARGO_PROFILE_'),
        ),
      ),
      cargoConfig: this.getCargoConfigFingerprints(),
      cargoDependencyGraph: getCargoDependencyGraphFingerprint(
        this.metadata,
        this.crate.id,
      ),
    })

    if (!this.options.dtsCache) {
      await mkdirAsync(dirname(folder), { recursive: true })
      folder = await mkdtempAsync(`${folder}-`)
    } else {
      await mkdirAsync(folder, { recursive: true })
    }

    return folder
  }

  private getCargoConfigFingerprints(): CargoConfigFingerprint[] {
    const configPaths = new Set<string>()
    const addConfigIfPresent = (path: string) => {
      if (existsSync(path) && statSync(path).isFile()) {
        configPaths.add(path)
      }
    }
    const addConfigDirectory = (directory: string) => {
      addConfigIfPresent(join(directory, 'config.toml'))
      addConfigIfPresent(join(directory, 'config'))
    }

    let currentDirectory = resolve(this.options.cwd)
    while (true) {
      addConfigDirectory(join(currentDirectory, '.cargo'))
      const parentDirectory = dirname(currentDirectory)
      if (parentDirectory === currentDirectory) {
        break
      }
      currentDirectory = parentDirectory
    }

    addConfigDirectory(
      process.env.CARGO_HOME
        ? resolve(this.options.cwd, process.env.CARGO_HOME)
        : join(homedir(), '.cargo'),
    )

    const cargoOptions = this.options.cargoOptions ?? []
    for (let index = 0; index < cargoOptions.length; index++) {
      const option = cargoOptions[index]
      if (option === '--config') {
        const value = cargoOptions[index + 1]
        if (value) {
          addConfigIfPresent(resolve(this.options.cwd, value))
          index++
        }
      } else if (option.startsWith('--config=')) {
        addConfigIfPresent(
          resolve(this.options.cwd, option.slice('--config='.length)),
        )
      }
    }

    return [...configPaths]
      .sort()
      .map((path) => [
        path,
        createHash('sha256').update(readFileSync(path)).digest('hex'),
      ])
  }

  private postBuild() {
    return withFileSystemReconciliation(this.reconciliationRoot, () =>
      this.postBuildUnlocked(),
    )
  }

  private async postBuildUnlocked() {
    const finalOutputDir = this.outputDir
    try {
      debug(`Try to create output directory:`)
      debug('  %i', finalOutputDir)
      await mkdirAsync(finalOutputDir, { recursive: true })
      debug(`Output directory created`)
    } catch (e) {
      throw new Error(`Failed to create output directory ${finalOutputDir}`, {
        cause: e,
      })
    }

    const stalePaths = this.options.watch
      ? new Set<string>()
      : await this.collectStaleBuildOutputPaths()
    const stagingDir = await mkdtempAsync(
      join(dirname(finalOutputDir), `.${basename(finalOutputDir)}.napi-stage-`),
    )
    const outputStart = this.outputs.length
    this.stagedOutputDestinations.clear()
    this.outputDir = stagingDir

    try {
      const wasmBinaryName = await this.copyArtifact()

      // only for cdylib
      if (this.cdyLibName) {
        const idents = await this.generateTypeDef()
        const jsOutput = await this.writeJsBinding(idents)
        const wasmBindingsOutput = await this.writeWasiBinding(
          wasmBinaryName,
          idents,
        )
        if (jsOutput) {
          this.outputs.push(jsOutput)
        }
        if (wasmBindingsOutput) {
          this.outputs.push(...wasmBindingsOutput)
        }
      }

      const stagedFiles = await collectFilesRecursively(stagingDir)
      const writes = [
        ...stagedFiles
          .filter((source) => !this.stagedOutputDestinations.has(source))
          .map((source) => ({
            source,
            destination: join(finalOutputDir, relative(stagingDir, source)),
          })),
        ...[...this.stagedOutputDestinations].map(([source, destination]) => ({
          source,
          destination,
        })),
      ]
      const writtenDestinations = new Set(
        writes.map(({ destination }) => destination),
      )
      const transactionRoot = commonPathAncestor([
        finalOutputDir,
        ...writtenDestinations,
        ...stalePaths,
      ])
      await commitFileSystemTransaction(
        transactionRoot,
        writes,
        [...stalePaths].filter((path) => !writtenDestinations.has(path)),
      )

      const committedOutputs = this.outputs
        .slice(outputStart)
        .map((output) => ({
          ...output,
          path:
            this.stagedOutputDestinations.get(output.path) ??
            join(finalOutputDir, relative(stagingDir, output.path)),
        }))
      this.outputs.splice(
        outputStart,
        this.outputs.length - outputStart,
        ...committedOutputs,
      )
      return this.outputs
    } catch (error) {
      this.outputs.splice(outputStart)
      throw error
    } finally {
      this.outputDir = finalOutputDir
      this.stagedOutputDestinations.clear()
      await rm(stagingDir, { force: true, recursive: true })
    }
  }

  private async copyArtifact() {
    const [srcName, destName, wasmBinaryName] = this.getArtifactNames()
    if (!srcName || !destName) {
      return
    }

    const profile =
      this.options.profile ?? (this.options.release ? 'release' : 'debug')
    const src = join(this.targetDir, this.target.triple, profile, srcName)
    debug(`Copy artifact from: [${src}]`)
    const dest = join(this.outputDir, destName)
    const isWasm = dest.endsWith('.wasm')
    const debugDest = isWasm
      ? dest.replace(/\.wasm$/, '.debug.wasm')
      : undefined
    let artifactReplaced = false

    try {
      debug('Copy artifact to:')
      debug('  %i', dest)
      if (isWasm) {
        const { ModuleConfig } = await import('@napi-rs/wasm-tools')
        debug('Generate debug wasm module')
        try {
          const debugWasmBinary = removeWasmCustomSection(
            new ModuleConfig()
              .generateDwarf(true)
              .generateNameSection(true)
              .generateProducersSection(true)
              .preserveCodeTransform(true)
              .strictValidate(false)
              .parse(await readFileAsync(src))
              .emitWasm(true),
            'build_id',
          )
          await writeFileAtomic(debugDest!, debugWasmBinary)
          debug('Generate release wasm module')
          const releaseWasmBinary = removeWasmCustomSection(
            new ModuleConfig()
              .generateDwarf(false)
              .generateNameSection(false)
              .generateProducersSection(false)
              .preserveCodeTransform(false)
              .strictValidate(false)
              .onlyStableFeatures(false)
              .parse(debugWasmBinary)
              .emitWasm(false),
            'build_id',
          )
          await writeFileAtomic(dest, releaseWasmBinary)
          artifactReplaced = true
        } catch (e) {
          debug.warn(
            `Failed to generate debug wasm module: ${(e as any).message ?? e}`,
          )
          await this.unlinkIfExists(debugDest!)
          await copyFileAtomic(src, dest)
          artifactReplaced = true
        }
        if (this.target.platform === 'wasi') {
          await verifyWasiReactor(dest)
        }
      } else {
        await copyFileAtomic(src, dest)
        artifactReplaced = true
      }
      this.outputs.push({
        kind: dest.endsWith('.node') ? 'node' : isWasm ? 'wasm' : 'exe',
        path: dest,
      })
      return wasmBinaryName ? join(this.outputDir, wasmBinaryName) : null
    } catch (e) {
      if (artifactReplaced) {
        await Promise.all(
          [dest, debugDest]
            .filter((path): path is string => path !== undefined)
            .map((path) => this.unlinkIfExists(path)),
        )
      }
      throw new Error('Failed to copy artifact', { cause: e })
    }
  }

  private getArtifactNames() {
    if (this.cdyLibName) {
      const cdyLib = this.cdyLibName.replace(/-/g, '_')
      // When building a wasi target, name the wasm artifact after the flavor
      // being built (two wasi flavors may be declared side by side); for
      // non-wasi builds fall back to the first declared wasi target so the
      // loader set can still be regenerated deterministically.
      const wasiTarget =
        this.target.platform === 'wasi'
          ? this.target
          : this.config.targets.find((t) => t.platform === 'wasi')

      const srcName =
        this.target.platform === 'darwin'
          ? `lib${cdyLib}.dylib`
          : this.target.platform === 'win32'
            ? `${cdyLib}.dll`
            : this.target.platform === 'wasi' || this.target.platform === 'wasm'
              ? `${cdyLib}.wasm`
              : `lib${cdyLib}.so`

      const destName = createArtifactDestinationName(
        this.config.binaryName,
        this.target,
        srcName,
        this.options.platform ?? false,
      )

      return [
        srcName,
        destName,
        wasiTarget
          ? `${this.config.binaryName}.${wasiTarget.platformArchABI}.wasm`
          : null,
      ]
    } else if (this.binName) {
      const srcName =
        this.target.platform === 'win32' ? `${this.binName}.exe` : this.binName

      return [srcName, srcName]
    }

    return []
  }

  private async generateTypeDef() {
    const typeDefDir = this.envs.NAPI_TYPE_DEF_TMP_FOLDER
    if (!this.enableTypeDef) {
      return []
    }

    const { exports, dts, dtsWithTypeImports } = await generateTypeDef({
      typeDefDir,
      noDtsHeader: this.options.noDtsHeader,
      dtsHeader: this.options.dtsHeader,
      configDtsHeader: this.config.dtsHeader,
      configDtsHeaderFile: this.config.dtsHeaderFile,
      constEnum: this.options.constEnum ?? this.config.constEnum,
      runtimeStringEnum:
        this.options.runtimeStringEnum ?? this.config.runtimeStringEnum,
      cwd: this.options.cwd,
    })
    this.typeDefWithTypeImports = dtsWithTypeImports

    const typeDefRelativePath = this.options.dts ?? 'index.d.ts'
    const finalDest = join(this.finalOutputDir, typeDefRelativePath)
    const dest = this.getStagedOutputPath(finalDest)

    try {
      debug('Writing type def to:')
      debug('  %i', dest)
      assertWritableOutputDestination(finalDest)
      await mkdirAsync(dirname(dest), { recursive: true })
      await writeFileAtomic(dest, dts, 'utf-8')
    } catch (e) {
      throw new Error(`Failed to write type def file ${dest}`, { cause: e })
    }

    if (exports.length > 0) {
      this.outputs.push({ kind: 'dts', path: dest })
    }

    return exports
  }

  private getStagedOutputPath(finalPath: string) {
    if (this.outputDir === this.finalOutputDir) {
      return finalPath
    }
    const relativePath = relative(this.finalOutputDir, finalPath)
    if (
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath)
    ) {
      return join(this.outputDir, relativePath)
    }
    const stagedPath = join(
      this.outputDir,
      '.napi-external',
      createHash('sha256').update(finalPath).digest('hex'),
    )
    this.stagedOutputDestinations.set(stagedPath, finalPath)
    return stagedPath
  }

  private async writeJsBinding(idents: string[]) {
    // Default WASI fallback order: threaded first. The generated root loader
    // also lets consumers pin one exact declared flavor with
    // NAPI_RS_WASI_FLAVOR.
    const declaredWasiTargets = this.config.targets.filter(
      (t) => t.platform === 'wasi',
    )
    // A direct `napi build --target wasm32-wasip1` (or any wasi triple) must
    // participate even when the config does not declare that target —
    // `writeWasiBinding` emits its loader set, so the index chain has to
    // reference the same flavor.
    if (
      this.target.platform === 'wasi' &&
      !declaredWasiTargets.some(
        (t) => t.platformArchABI === this.target.platformArchABI,
      )
    ) {
      declaredWasiTargets.push(this.target)
    }
    const wasiFlavors = [
      ...new Set(
        [
          ...declaredWasiTargets.filter(wasiTargetHasThreads),
          ...declaredWasiTargets.filter((t) => !wasiTargetHasThreads(t)),
        ].map((t) => t.platformArchABI),
      ),
    ]
    return writeJsBinding({
      platform: this.options.platform,
      noJsBinding: this.options.noJsBinding,
      idents,
      jsBinding: this.options.jsBinding,
      esm: this.options.esm,
      binaryName: this.config.binaryName,
      packageName: this.options.jsPackageName ?? this.config.packageName,
      version: process.env.npm_new_version ?? this.config.packageJson.version,
      outputDir: this.outputDir,
      wasiFlavors,
    })
  }

  private async writeWasiBinding(
    distFileName: string | undefined | null,
    idents: string[],
  ) {
    if (distFileName) {
      const { dir } = parse(distFileName)
      // A WASI build owns the export/declaration metadata for its flavor.
      // Non-WASI builds use that metadata to regenerate declared loader sets
      // without substituting the native surface. Legacy flavor files without
      // metadata remain untouched. Two triples mapping to the same
      // `platformArchABI` (e.g. `wasm32-wasip1-threads` and
      // `wasm32-wasi-preview1-threads`) describe the same artifact set, so
      // dedupe on it.
      const wasiTargets: Target[] = []
      const seen = new Set<string>()
      const declaredWasiTargets =
        this.target.platform === 'wasi'
          ? [this.target]
          : this.config.targets.filter((t) => t.platform === 'wasi')
      for (const wasiTarget of declaredWasiTargets) {
        if (seen.has(wasiTarget.platformArchABI)) {
          continue
        }
        seen.add(wasiTarget.platformArchABI)
        wasiTargets.push(wasiTarget)
      }
      const outputs: Output[] = []
      const metadataByFlavor = new Map<string, WasiBindingMetadata>()
      for (const wasiTarget of wasiTargets) {
        const metadata =
          this.target.platform === 'wasi' &&
          wasiTarget.platformArchABI === this.target.platformArchABI
            ? { exports: idents }
            : await this.readExistingWasiBindingMetadata(wasiTarget)
        if (!metadata) {
          continue
        }
        metadataByFlavor.set(wasiTarget.platformArchABI, metadata)
        outputs.push(
          ...(await this.writeWasiBindingForTarget(wasiTarget, dir, metadata)),
        )
      }
      if (wasiTargets.length > 0) {
        // The browser entry re-exports a single flavor: the non-threaded one
        // when declared (browser environments without cross-origin isolation
        // cannot use the threaded flavor). An explicit WASI build target is
        // authoritative, even when package config declares another flavor.
        const browserFlavor = selectWasiBrowserTarget(
          this.target,
          this.config.targets,
          wasiTargets,
        )
        const browserEntryPath = join(dir, 'browser.js')
        const browserMetadata = metadataByFlavor.get(
          browserFlavor.platformArchABI,
        )
        if (browserMetadata) {
          await writeFileAtomic(
            browserEntryPath,
            createWasiBrowserEntry(
              this.config.packageName,
              browserFlavor.platformArchABI,
              browserMetadata.exports,
            ),
          )
          outputs.push({ kind: 'js', path: browserEntryPath })
        } else {
          const existingBrowserEntryPath = join(
            this.finalOutputDir,
            'browser.js',
          )
          if (await fileExists(existingBrowserEntryPath)) {
            await copyFileAtomic(existingBrowserEntryPath, browserEntryPath)
            outputs.push({ kind: 'js', path: browserEntryPath })
          }
        }
      }
      return outputs
    }
    return []
  }

  private async writeWasiBindingForTarget(
    wasiTarget: Target,
    dir: string,
    metadata: WasiBindingMetadata,
  ): Promise<Output[]> {
    const { exports: idents } = metadata
    const hasThreads = wasiTargetHasThreads(wasiTarget)
    const loaderSuffix = wasiLoaderSuffix(wasiTarget.platformArchABI)
    // the wasm file stem referenced from inside the loaders
    const name = `${this.config.binaryName}.${wasiTarget.platformArchABI}`
    const bindingPath = join(
      dir,
      `${this.config.binaryName}.${loaderSuffix}.cjs`,
    )
    const browserBindingPath = join(
      dir,
      `${this.config.binaryName}.${loaderSuffix}-browser.js`,
    )
    const bindingTypeDefPath = join(
      dir,
      `${this.config.binaryName}.${loaderSuffix}.d.cts`,
    )
    const exportsCode =
      `module.exports = __napiModule.exports\n` +
      idents
        .map(
          (ident) => `module.exports.${ident} = __napiModule.exports.${ident}`,
        )
        .join('\n')
    await writeFileAtomic(
      bindingPath,
      createWasiArtifactMetadata(
        this.options.platform && !this.options.noJsBinding
          ? (this.options.jsBinding ?? 'index.js')
          : null,
        this.config.binaryName,
        idents,
      ) +
        createWasiBinding(
          name,
          this.config.packageName,
          this.config.wasm?.initialMemory,
          this.config.wasm?.maximumMemory,
          hasThreads,
          wasiTarget.platformArchABI,
          `${this.config.binaryName}.${wasiTarget.platformArchABI}`,
        ) +
        exportsCode +
        '\n',
      'utf8',
    )
    await writeFileAtomic(
      browserBindingPath,
      createWasiBrowserBinding(
        name,
        this.config.wasm?.initialMemory,
        this.config.wasm?.maximumMemory,
        this.config.wasm?.browser?.fs,
        this.config.wasm?.browser?.asyncInit,
        this.config.wasm?.browser?.buffer,
        this.config.wasm?.browser?.errorEvent,
        hasThreads,
      ) +
        `export default __napiModule.exports\n` +
        idents
          .map(
            (ident) => `export const ${ident} = __napiModule.exports.${ident}`,
          )
          .join('\n') +
        '\n',
      'utf8',
    )
    let bindingTypeDef = metadata.bindingTypeDef
    if (bindingTypeDef === undefined) {
      const finalSourceTypeDefPath = join(
        this.finalOutputDir,
        this.options.dts ?? 'index.d.ts',
      )
      const sourceTypeDefPath = this.enableTypeDef
        ? this.getStagedOutputPath(finalSourceTypeDefPath)
        : finalSourceTypeDefPath
      const sourceTypeDef = this.enableTypeDef
        ? await readFileAsync(sourceTypeDefPath, 'utf8')
        : `${DEFAULT_TYPE_DEF_HEADER}
declare const binding: Record<string, unknown>
export = binding
`
      const selectedSourceTypeDef =
        !hasThreads &&
        this.config.wasm?.browser?.buffer === true &&
        this.typeDefWithTypeImports
          ? this.typeDefWithTypeImports
          : sourceTypeDef
      bindingTypeDef = this.enableTypeDef
        ? prepareWasiBindingTypeDef(
            selectedSourceTypeDef,
            finalSourceTypeDefPath,
            join(
              this.finalOutputDir,
              relative(this.outputDir, bindingTypeDefPath),
            ),
            hasThreads,
            this.config.packageJson.type,
          )
        : hasThreads
          ? selectedSourceTypeDef
          : removeNodeStreamWebTypeImports(selectedSourceTypeDef)
    }
    await writeFileAtomic(bindingTypeDefPath, bindingTypeDef, 'utf8')
    const outputs: Output[] = [
      { kind: 'js', path: bindingPath },
      { kind: 'js', path: browserBindingPath },
      { kind: 'dts', path: bindingTypeDefPath },
    ]
    if (hasThreads) {
      // worker scripts are only referenced by the threaded loaders
      const workerPath = join(dir, 'wasi-worker.mjs')
      const browserWorkerPath = join(dir, 'wasi-worker-browser.mjs')
      await writeFileAtomic(workerPath, WASI_WORKER_TEMPLATE, 'utf8')
      await writeFileAtomic(
        browserWorkerPath,
        createWasiBrowserWorkerBinding(
          this.config.wasm?.browser?.fs ?? false,
          this.config.wasm?.browser?.errorEvent ?? false,
        ),
        'utf8',
      )
      outputs.push(
        { kind: 'js', path: workerPath },
        { kind: 'js', path: browserWorkerPath },
      )
    } else {
      // the deferred workerd-safe loader only exists for non-threaded flavors
      const deferredBindingPath = join(
        dir,
        `${this.config.binaryName}.${loaderSuffix}-deferred.js`,
      )
      const deferredTypeDefPath = join(
        dir,
        `${this.config.binaryName}.${loaderSuffix}-deferred.d.ts`,
      )
      await writeFileAtomic(
        deferredBindingPath,
        createWasiDeferredBrowserBinding(
          name,
          this.config.wasm?.initialMemory,
          this.config.wasm?.maximumMemory,
          this.config.wasm?.browser?.buffer,
        ),
        'utf8',
      )
      await writeFileAtomic(
        deferredTypeDefPath,
        createWasiDeferredBindingTypeDef(
          `./${this.config.binaryName}.${loaderSuffix}.cjs`,
          this.enableTypeDef,
        ),
        'utf8',
      )
      outputs.push(
        { kind: 'js', path: deferredBindingPath },
        { kind: 'dts', path: deferredTypeDefPath },
      )
    }
    return outputs
  }

  private setEnvIfNotExists(env: string, value: string) {
    if (!process.env[env]) {
      this.envs[env] = value
    }
  }
}

export async function verifyWasiReactor(wasmPath: string): Promise<void> {
  const bytes = await readFileAsync(wasmPath)
  let module: WebAssembly.Module
  try {
    module = new WebAssembly.Module(bytes)
  } catch (error) {
    throw new Error(`Failed to validate WASI artifact ${wasmPath}`, {
      cause: error,
    })
  }
  if (
    !WebAssembly.Module.exports(module).some(
      ({ name, kind }) => name === '_initialize' && kind === 'function',
    )
  ) {
    throw new Error(
      `WASI artifact ${wasmPath} does not export _initialize. Ensure napi-build can locate crt1-reactor.o for the selected Rust target.`,
    )
  }
}

function assertWritableOutputDestination(path: string) {
  if (existsSync(path) && statSync(path).isDirectory()) {
    throw new Error(`Output destination is a directory: ${path}`)
  }

  let parent = dirname(path)
  while (!existsSync(parent)) {
    const nextParent = dirname(parent)
    if (nextParent === parent) {
      return
    }
    parent = nextParent
  }
  if (!statSync(parent).isDirectory()) {
    throw new Error(`Output parent is not a directory: ${parent}`)
  }
}

function commonPathAncestor(paths: Iterable<string>) {
  const resolvedPaths = [...paths].map((path) => resolve(path))
  if (resolvedPaths.length === 0) {
    throw new Error('Cannot compute a common path for no filesystem outputs')
  }
  let common = resolvedPaths[0]
  for (const path of resolvedPaths.slice(1)) {
    while (true) {
      const relativePath = relative(common, path)
      if (
        relativePath === '' ||
        (relativePath !== '..' &&
          !relativePath.startsWith(`..${sep}`) &&
          !isAbsolute(relativePath))
      ) {
        break
      }
      const parent = dirname(common)
      if (parent === common) {
        break
      }
      common = parent
    }
  }
  return common
}

async function collectFilesRecursively(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdirAsync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files.sort()
}

export interface WriteJsBindingOptions {
  platform?: boolean
  noJsBinding?: boolean
  idents: string[]
  jsBinding?: string
  esm?: boolean
  binaryName: string
  packageName: string
  version: string
  outputDir: string
  /**
   * `platformArchABI`s of the declared WASI targets in fallback preference
   * order (threaded first). Defaults to the legacy `['wasm32-wasi']` chain
   * when omitted or empty. Generated loaders expose these exact identities
   * through `NAPI_RS_WASI_FLAVOR`.
   */
  wasiFlavors?: string[]
}

export async function writeJsBinding(
  options: WriteJsBindingOptions,
): Promise<Output | undefined> {
  const hasWasiFallback = Boolean(options.wasiFlavors?.length)
  if (
    !options.platform ||
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    options.noJsBinding ||
    (options.idents.length === 0 && !hasWasiFallback)
  ) {
    return
  }

  const name = options.jsBinding ?? 'index.js'
  const dest = join(options.outputDir, name)
  const localWasiName = relative(
    dirname(dest),
    join(options.outputDir, options.binaryName),
  ).replaceAll('\\', '/')
  const localWasiSpecifier = localWasiName.startsWith('.')
    ? localWasiName
    : `./${localWasiName}`

  const createBinding = options.esm ? createEsmBinding : createCjsBinding
  const binding = createBinding(
    options.binaryName,
    options.packageName,
    options.idents,
    // in npm preversion hook
    options.version,
    options.wasiFlavors,
    localWasiSpecifier,
  )

  try {
    debug('Writing js binding to:')
    debug('  %i', dest)
    await mkdirAsync(dirname(dest), { recursive: true })
    await writeFileAtomic(dest, binding, 'utf-8')
    return { kind: 'js', path: dest } satisfies Output
  } catch (e) {
    throw new Error('Failed to write js binding file', { cause: e })
  }
}

export interface GenerateTypeDefOptions {
  typeDefDir: string
  noDtsHeader?: boolean
  dtsHeader?: string
  dtsHeaderFile?: string
  configDtsHeader?: string
  configDtsHeaderFile?: string
  constEnum?: boolean
  runtimeStringEnum?: boolean
  cwd: string
}

/**
 * Walk the napi-derive intermediate type-def directory, render every entry
 * into TypeScript via {@link processTypeDef}, and return the concatenated
 * `.d.ts` source plus the list of identifiers to re-export from
 * `index.js`.
 */
export async function generateTypeDef(
  options: GenerateTypeDefOptions,
): Promise<{
  exports: string[]
  dts: string
  dtsWithTypeImports: string
}> {
  if (!(await dirExistsAsync(options.typeDefDir))) {
    return { exports: [], dts: '', dtsWithTypeImports: '' }
  }

  let header = ''
  let dts = ''
  let exports: string[] = []

  if (!options.noDtsHeader) {
    const dtsHeader = options.dtsHeader ?? options.configDtsHeader
    const dtsHeaderFile = options.dtsHeaderFile ?? options.configDtsHeaderFile
    // An explicit API header file takes precedence over the config file;
    // either file takes precedence over inline header text.
    if (dtsHeaderFile) {
      try {
        header = await readFileAsync(join(options.cwd, dtsHeaderFile), 'utf-8')
      } catch (e) {
        debug.warn(`Failed to read dts header file ${dtsHeaderFile}`, e)
      }
    } else if (dtsHeader) {
      header = dtsHeader
    } else {
      header = DEFAULT_TYPE_DEF_HEADER
    }
  }

  const files = await readdirAsync(options.typeDefDir, { withFileTypes: true })

  if (!files.length) {
    debug('No type def files found. Skip generating dts file.')
    return { exports: [], dts: '', dtsWithTypeImports: '' }
  }

  const typeDefFiles = files
    .filter((file) => file.isFile())
    .sort((a, b) => a.name.localeCompare(b.name))

  const constEnum = options.constEnum ?? true
  const runtimeStringEnum = options.runtimeStringEnum ?? false
  if (runtimeStringEnum && constEnum) {
    debug.warn(
      '`--runtime-string-enum` has no effect when `--const-enum` is enabled (the default). Pass `--no-const-enum` to activate runtime string enum emission.',
    )
  }

  const processedTypeDefs = await Promise.all(
    typeDefFiles.map((file) =>
      processTypeDef(
        join(options.typeDefDir, file.name),
        constEnum,
        runtimeStringEnum,
      ),
    ),
  )

  dts = processedTypeDefs.map(({ dts }) => dts).join('')
  exports = processedTypeDefs.flatMap(({ exports }) => exports)
  dts = processedTypeDefs.dts
  exports = processedTypeDefs.exports
  const dtsWithTypeImportMarkers = processedTypeDefs.dtsWithTypeImportMarkers
  const typeImports = processedTypeDefs.typeImports

  if (dts.indexOf('ExternalObject<') > -1) {
    header += `
export declare class ExternalObject<T> {
  readonly '': {
    readonly '': unique symbol
    [K: symbol]: T
  }
}
`
  }

  if (dts.indexOf('TypedArray') > -1) {
    header += `
export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array
`
  }

  dts = header + dts
  const dtsWithTypeImports = rewriteTypeImportReferences(
    header + dtsWithTypeImportMarkers,
    typeImports,
    true,
  )

  return {
    exports,
    dts,
    dtsWithTypeImports,
  }
}
