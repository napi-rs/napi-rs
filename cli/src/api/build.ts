import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, relative, resolve } from 'node:path'

import * as colors from 'colorette'

import type { BuildOptions as RawBuildOptions } from '../def/build.js'
import {
  CLI_VERSION,
  copyFileAsync,
  type Crate,
  debugFactory,
  DEFAULT_TYPE_DEF_HEADER,
  fileExists,
  getSystemDefaultTarget,
  getTargetLinker,
  mkdirAsync,
  type NapiConfig,
  parseMetadata,
  parseTriple,
  processTypeDefs,
  readFileAsync,
  readNapiConfig,
  removeNodeStreamWebTypeImports,
  rewriteTypeImportReferences,
  type Target,
  targetToEnvVar,
  tryInstallCargoBinary,
  unlinkAsync,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  writeFileAsync,
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

type BuildOptions = RawBuildOptions & { cargoOptions?: string[] }
type ParsedBuildOptions = Omit<BuildOptions, 'cwd'> & { cwd: string }

export const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'

export function createWasiCompilerFlags(
  wasiSdkPath: string,
  wasiTarget: string,
  hasThreads: boolean,
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
    compileFlags: joinShellEscapedArguments(compileArguments),
    linkerFlags: joinShellEscapedArguments(linkerArguments),
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

function joinShellEscapedArguments(arguments_: string[]) {
  return arguments_
    .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
    .join(' ')
}

function createWasiArtifactMetadata(rootEntry: string | null) {
  return `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 1,
    rootEntry,
  })}\n`
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
      `${flavor.platformArchABI}.wasm`,
      `${flavor.platformArchABI}.debug.wasm`,
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
  const metadata = await parseMetadata(manifestPath)

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
  private readonly outputDir: string
  private readonly targetDir: string
  private readonly enableTypeDef: boolean = false
  private typeDefWithTypeImports: string | undefined

  constructor(
    private readonly metadata: CargoWorkspaceMetadata,
    private readonly crate: Crate,
    private readonly config: NapiConfig,
    private readonly options: ParsedBuildOptions,
  ) {
    this.target = resolveTarget(options.target)
    this.crateDir = parse(crate.manifest_path).dir
    this.outputDir = resolve(
      this.options.cwd,
      options.outputDir ?? this.crateDir,
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

  build() {
    // Backstop only: `buildProject()` already validated these before running
    // anything with a side effect (see the top of `buildProject`). Kept here
    // so a directly constructed `Builder` cannot skip the validation.
    validateCrossCompileFlags(this.options)
    if (this.options.useNapiCross) {
      validateNapiCrossSupport(this.target.triple)
    }

    if (!this.cdyLibName) {
      const warning =
        'Missing `crate-type = ["cdylib"]` in [lib] config. The build result will not be available as node addon.'

      if (this.binName) {
        debug.warn(warning)
      } else {
        throw new Error(warning)
      }
    }

    return this.pickBinary()
      .setPackage()
      .setFeatures()
      .setTarget()
      .pickCrossToolchain()
      .setEnvs()
      .setBypassArgs()
      .exec()
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
    const buildTask = (
      watch ? Promise.resolve() : this.removeStaleBuildOutputs()
    ).then(
      () =>
        new Promise<void>((resolve, reject) => {
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
            reject(
              new Error(`Build failed with error: ${e.message}`, { cause: e }),
            )
          })

          // watch mode only, they are piped through stderr
          buildProcess.stderr?.on('data', (data) => {
            const output = data.toString()
            console.error(output)
            if (/Finished\s(`dev`|`release`)/.test(output)) {
              this.postBuild().catch(() => {})
            }
          })
        }),
    )

    return {
      task: buildTask.then(() => this.postBuild()),
      abort: () => controller.abort(),
    }
  }

  private async removeStaleBuildOutputs() {
    const [, destName] = this.getArtifactNames()
    const stalePaths = new Set<string>()
    if (destName) {
      stalePaths.add(join(this.outputDir, destName))
      if (destName.endsWith('.wasm')) {
        stalePaths.add(
          join(this.outputDir, destName.replace(/\.wasm$/, '.debug.wasm')),
        )
      }
    }

    if (this.target.platform === 'wasi') {
      for (const name of collectStaleWasiBuildOutputNames(
        this.config.binaryName,
        this.target,
        this.config.targets,
      )) {
        stalePaths.add(join(this.outputDir, name))
      }
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

    await Promise.all([...stalePaths].map((path) => this.unlinkIfExists(path)))
  }

  private async unlinkIfExists(path: string) {
    if (await fileExists(path)) {
      await unlinkAsync(path)
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

  private setEnvs() {
    // TYPE DEF
    if (this.enableTypeDef) {
      this.envs.NAPI_TYPE_DEF_TMP_FOLDER =
        this.generateIntermediateTypeDefFolder()
      this.setForceBuildEnvs(this.envs.NAPI_TYPE_DEF_TMP_FOLDER)
    }

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
    this.metadata.packages.forEach((crate) => {
      if (
        crate.dependencies.some((d) => d.name === 'napi-derive') &&
        !existsSync(join(typeDefTmpFolder, crate.name))
      ) {
        this.envs[
          `NAPI_FORCE_BUILD_${crate.name.replace(/-/g, '_').toUpperCase()}`
        ] = Date.now().toString()
      }
    })
  }

  private setAndroidEnv() {
    const { ANDROID_NDK_LATEST_HOME } = process.env
    if (!ANDROID_NDK_LATEST_HOME) {
      debug.warn(
        `${colors.red(
          'ANDROID_NDK_LATEST_HOME',
        )} environment variable is missing`,
      )
    }

    // skip cross compile setup if host is android
    if (process.platform === 'android') {
      return
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
    const hasThreads = this.target.triple !== 'wasm32-wasip1'
    const hasThreads = wasiTargetHasThreads(this.target)
    const wasiTarget = hasThreads ? 'wasm32-wasip1-threads' : 'wasm32-wasip1'
    const emnapi = join(require.resolve('emnapi'), '..', 'lib', wasiTarget)
    this.envs.EMNAPI_LINK_DIR = emnapi
    const emnapiVersion = require('emnapi/package.json').version
    const projectRequire = createRequire(
      resolve(this.options.cwd, 'package.json'),
    )
    const emnapiCoreVersion = projectRequire('@emnapi/core').version
    const emnapiRuntimeVersion = projectRequire('@emnapi/runtime').version

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
        `--target=${wasiTarget} --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot${hasThreads ? ' -pthread' : ''} -mllvm -wasm-enable-sjlj`,
      )
      this.setEnvIfNotExists(
        'TARGET_CXXFLAGS',
        `--target=${wasiTarget} --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot${hasThreads ? ' -pthread' : ''} -mllvm -wasm-enable-sjlj`,
      )
      this.setEnvIfNotExists(
        `TARGET_LDFLAGS`,
        `-fuse-ld=${WASI_SDK_PATH}/bin/wasm-ld --target=${wasiTarget}`,
      const { compileFlags, linkerFlags } = createWasiCompilerFlags(
        WASI_SDK_PATH,
        wasiTarget,
        hasThreads,
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

  private generateIntermediateTypeDefFolder() {
    let folder = join(
      this.targetDir,
      'napi-rs',
      `${this.crate.name}-${createHash('sha256')
        .update(this.crate.manifest_path)
        .update(CLI_VERSION)
        .digest('hex')
        .substring(0, 8)}`,
    )

    if (!this.options.dtsCache) {
      rmSync(folder, { recursive: true, force: true })
      folder += `_${Date.now()}`
    }

    mkdirAsync(folder, { recursive: true })

    return folder
  }

  private async postBuild() {
    try {
      debug(`Try to create output directory:`)
      debug('  %i', this.outputDir)
      await mkdirAsync(this.outputDir, { recursive: true })
      debug(`Output directory created`)
    } catch (e) {
      throw new Error(`Failed to create output directory ${this.outputDir}`, {
        cause: e,
      })
    }

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

    return this.outputs
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

    try {
      if (await fileExists(dest)) {
        debug('Old artifact found, remove it first')
        await unlinkAsync(dest)
      }
      if (debugDest) {
        await this.unlinkIfExists(debugDest)
      }
      debug('Copy artifact to:')
      debug('  %i', dest)
      if (isWasm) {
        const { ModuleConfig } = await import('@napi-rs/wasm-tools')
        debug('Generate debug wasm module')
        try {
          const debugWasmModule = new ModuleConfig()
            .generateDwarf(true)
            .generateNameSection(true)
            .generateProducersSection(true)
            .preserveCodeTransform(true)
            .strictValidate(false)
            .parse(await readFileAsync(src))
          const debugWasmBinary = debugWasmModule.emitWasm(true)
          await writeFileAsync(debugDest!, debugWasmBinary)
          debug('Generate release wasm module')
          const releaseWasmModule = new ModuleConfig()
            .generateDwarf(false)
            .generateNameSection(false)
            .generateProducersSection(false)
            .preserveCodeTransform(false)
            .strictValidate(false)
            .onlyStableFeatures(false)
            .parse(debugWasmBinary)
          const releaseWasmBinary = releaseWasmModule.emitWasm(false)
          await writeFileAsync(dest, releaseWasmBinary)
        } catch (e) {
          debug.warn(
            `Failed to generate debug wasm module: ${(e as any).message ?? e}`,
          )
          await copyFileAsync(src, dest)
        }
        if (this.target.platform === 'wasi') {
          await verifyWasiReactor(dest)
        }
      } else {
        await copyFileAsync(src, dest)
      }
      this.outputs.push({
        kind: dest.endsWith('.node') ? 'node' : isWasm ? 'wasm' : 'exe',
        path: dest,
      })
      return wasmBinaryName ? join(this.outputDir, wasmBinaryName) : null
    } catch (e) {
      await Promise.all(
        [dest, debugDest]
          .filter((path): path is string => path !== undefined)
          .map((path) => this.unlinkIfExists(path)),
      )
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

    const dest = join(this.outputDir, this.options.dts ?? 'index.d.ts')

    try {
      debug('Writing type def to:')
      debug('  %i', dest)
      await writeFileAsync(dest, dts, 'utf-8')
    } catch (e) {
      debug.error('Failed to write type def file')
      debug.error(e as Error)
    }

    if (exports.length > 0) {
      const dest = join(this.outputDir, this.options.dts ?? 'index.d.ts')
      this.outputs.push({ kind: 'dts', path: dest })
    }

    return exports
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
      // For a wasi build, emit the loader set of the flavor being built; for
      // non-wasi builds regenerate the loader set of EVERY declared wasi
      // flavor (each with its own `hasThreads`), so the emitted files are
      // deterministic regardless of the build target. Two triples mapping to
      // the same `platformArchABI` (e.g. `wasm32-wasip1-threads` and
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
      for (const wasiTarget of wasiTargets) {
        outputs.push(
          ...(await this.writeWasiBindingForTarget(wasiTarget, dir, idents)),
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
        await writeFileAsync(
          browserEntryPath,
          createWasiBrowserEntry(
            this.config.packageName,
            browserFlavor.platformArchABI,
            idents,
          ),
        )
        outputs.push({ kind: 'js', path: browserEntryPath })
      }
      return outputs
    }
    return []
  }

  private async writeWasiBindingForTarget(
    wasiTarget: Target,
    dir: string,
    idents: string[],
  ): Promise<Output[]> {
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
    await writeFileAsync(
      bindingPath,
      createWasiArtifactMetadata(
        this.options.platform && !this.options.noJsBinding
          ? (this.options.jsBinding ?? 'index.js')
          : null,
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
    await writeFileAsync(
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
    const bindingTypeDef = this.enableTypeDef
      ? await readFileAsync(
          join(this.outputDir, this.options.dts ?? 'index.d.ts'),
          'utf8',
        )
      : `${DEFAULT_TYPE_DEF_HEADER}
declare const binding: Record<string, unknown>
export = binding
`
    const selectedBindingTypeDef =
      !hasThreads &&
      this.config.wasm?.browser?.buffer === true &&
      this.typeDefWithTypeImports
        ? this.typeDefWithTypeImports
        : bindingTypeDef
    const targetBindingTypeDef = hasThreads
      ? selectedBindingTypeDef
      : removeNodeStreamWebTypeImports(selectedBindingTypeDef)
    await writeFileAsync(bindingTypeDefPath, targetBindingTypeDef, 'utf8')
    const outputs: Output[] = [
      { kind: 'js', path: bindingPath },
      { kind: 'js', path: browserBindingPath },
      { kind: 'dts', path: bindingTypeDefPath },
    ]
    if (hasThreads) {
      // worker scripts are only referenced by the threaded loaders
      const workerPath = join(dir, 'wasi-worker.mjs')
      const browserWorkerPath = join(dir, 'wasi-worker-browser.mjs')
      await writeFileAsync(workerPath, WASI_WORKER_TEMPLATE, 'utf8')
      await writeFileAsync(
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
      await writeFileAsync(
        deferredBindingPath,
        createWasiDeferredBrowserBinding(
          name,
          this.config.wasm?.initialMemory,
          this.config.wasm?.maximumMemory,
          this.config.wasm?.browser?.buffer,
        ),
        'utf8',
      )
      await writeFileAsync(
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
    await writeFileAsync(dest, binding, 'utf-8')
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
    // `dtsHeaderFile` in config > `dtsHeader` in cli flag > `dtsHeader` in config
    if (options.configDtsHeaderFile) {
      try {
        header = await readFileAsync(
          join(options.cwd, options.configDtsHeaderFile),
          'utf-8',
        )
      } catch (e) {
        debug.warn(
          `Failed to read dts header file ${options.configDtsHeaderFile}`,
          e,
        )
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

  const processedTypeDefs = await processTypeDefs(
    typeDefFiles.map((file) => join(options.typeDefDir, file.name)),
    constEnum,
    runtimeStringEnum,
    header,
  )

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
