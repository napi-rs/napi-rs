import { underline, yellow } from 'colorette'
import { merge, omit } from 'es-toolkit'

import { fileExists, readFileAsync } from './misc.js'
import { DEFAULT_TARGETS, parseTriple, type Target } from './target.js'

export type ValueOfConstArray<T> = T[Exclude<keyof T, keyof Array<any>>]

export const SupportedPackageManagers = ['yarn', 'pnpm'] as const
export const SupportedTestFrameworks = ['ava'] as const

export type SupportedPackageManager = ValueOfConstArray<
  typeof SupportedPackageManagers
>
export type SupportedTestFramework = ValueOfConstArray<
  typeof SupportedTestFrameworks
>

/**
 * A single output binary in a multi-binary project.
 *
 * A project that ships more than one addon from the same repository — for
 * example a full-featured build and a slimmed-down build compiled from a
 * different crate — lists each one here. `napi build` then builds every entry
 * in order, each into its own private type-def cache so their generated
 * bindings never collide, or a single entry selected with
 * `napi build --binary <name>`.
 *
 * When `binaries` is absent the top-level single-binary fields (`binaryName`,
 * `manifestPath`, ...) are used unchanged, so existing single-binary projects
 * are unaffected.
 */
export interface BinaryConfig {
  /**
   * Stable identifier for this binary. It is the `napi build --binary <name>`
   * selector and keys this binary's private type-def cache, so it must be
   * unique across all entries. It is independent of `binaryName` (the output
   * artifact name), so a binary can be renamed on disk without changing how it
   * is selected on the command line.
   */
  name: string
  /**
   * Path to the `Cargo.toml` of the crate this binary is compiled from,
   * relative to the working directory. Provide exactly one of `manifestPath`
   * or `package`.
   */
  manifestPath?: string
  /**
   * Cargo package to build (`cargo build --package <package>`), for selecting
   * one crate out of a workspace. Provide exactly one of `manifestPath` or
   * `package`.
   */
  package?: string
  /**
   * Output artifact base name for this binary (the `.node`/`.wasm` file).
   * Overrides the top-level `binaryName`; defaults to it when omitted.
   */
  binaryName?: string
  /**
   * Path and filename of the generated JS binding file for this binary,
   * relative to the output directory. Defaults to `index.js` when omitted.
   */
  js?: string
  /**
   * Path and filename of the generated type-def (`.d.ts`) file for this
   * binary, relative to the output directory. Defaults to `index.d.ts` when
   * omitted.
   */
  dts?: string
}

export interface UserNapiConfig {
  /**
   * Name of the binary to be generated, default to `index`
   */
  binaryName?: string

  /**
   * Build more than one output binary from a single `napi build` invocation.
   *
   * Each entry describes one addon (its crate, output artifact name, and
   * generated `js`/`dts` paths). When present, `napi build` builds every entry
   * in order — each with its own isolated type-def cache — or a single entry
   * selected by `napi build --binary <name>`. When absent, the top-level
   * single-binary fields are used and behavior is unchanged.
   */
  binaries?: BinaryConfig[]
  /**
   * Name of the npm package, default to the name of root package.json name
   *
   * Always given `@scope/pkg` and arch suffix will be appended like `@scope/pkg-linux-gnu-x64`
   */
  packageName?: string
  /**
   * All targets the crate will be compiled for
   */
  targets?: string[]

  /**
   * The npm client project uses.
   */
  npmClient?: string

  /**
   * Whether generate const enum for typescript bindings
   */
  constEnum?: boolean

  /**
   * Emit `#[napi(string_enum)]` enums as runtime enums (`export declare enum`) under `--no-const-enum`. Default: type-only union.
   */
  runtimeStringEnum?: boolean

  /**
   * Emit a top-level `export type <RustIdent> = <js_name>` alias for every
   * `#[napi]` class whose `js_name` differs from its Rust identifier.
   * Default `true`, preserving today's behavior — this alias predates
   * `(namespace, js_name)` becoming the canonical identity and may already be
   * relied on by downstream consumers. Set `false` to stop emitting it.
   */
  emitRustNameTypeAlias?: boolean

  /**
   * dts header prepend to the generated dts file
   */
  dtsHeader?: string

  /**
   * dts header file path to be prepended to the generated dts file
   * if both dtsHeader and dtsHeaderFile are provided, dtsHeaderFile will be used
   */
  dtsHeaderFile?: string

  /**
   * wasm compilation options
   */
  wasm?: {
    /**
     * https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory
     * @default 4000 pages (250 MiB), or 1024 pages (64 MiB) for the deferred workerd loader
     */
    initialMemory?: number
    /**
     * @default 65536 pages (4GiB)
     */
    maximumMemory?: number

    /**
     * Whether the generated `<packageName>-wasm32-wasi` package is declared as
     * an `optionalDependency` of the root package.
     *
     * When native targets are configured the WASI package is a fallback for
     * hosts that cannot load a `.node` binary, so declaring it would make every
     * consumer download the `.wasm` binary they will never load. It is
     * therefore omitted by default and is expected to be installed on demand by
     * the environments that need it.
     *
     * When WASI is the only configured target it is the primary artifact and is
     * declared by default.
     *
     * Set this explicitly to override either default.
     *
     * @default true when every configured target is WASI, false otherwise
     */
    optionalDependency?: boolean

    /**
     * Browser wasm binding configuration
     */
    browser?: {
      /**
       * Whether to use fs module in browser
       */
      fs?: boolean
      /**
       * Whether to initialize wasm asynchronously
       */
      asyncInit?: boolean
      /**
       * Whether to inject `buffer` to emnapi context
       */
      buffer?: boolean
      /**
       * Whether to emit custom events for errors in worker
       */
      errorEvent?: boolean
    }
  }

  /**
   * @deprecated binaryName instead
   */
  name?: string
  /**
   * @deprecated use packageName instead
   */
  package?: {
    name?: string
  }
  /**
   * @deprecated use targets instead
   */
  triples?: {
    /**
     * Whether enable default targets
     */
    defaults: boolean
    /**
     * Additional targets to be compiled for
     */
    additional?: string[]
  }
}

export interface CommonPackageJsonFields {
  name: string
  version: string
  description?: string
  keywords?: string[]
  author?: string
  authors?: string[]
  license?: string
  cpu?: string[]
  os?: string[]
  libc?: string[]
  files?: string[]
  repository?: any
  homepage?: any
  engines?: Record<string, string>
  publishConfig?: any
  bugs?: any
  // eslint-disable-next-line no-use-before-define
  napi?: UserNapiConfig
  type?: 'module' | 'commonjs'
  scripts?: Record<string, string>

  // modules
  main?: string
  module?: string
  types?: string
  browser?: string
  exports?: any

  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>

  ava?: {
    timeout?: string
  }
}

export type NapiConfig = Required<
  Pick<UserNapiConfig, 'binaryName' | 'packageName' | 'npmClient'>
> &
  Pick<
    UserNapiConfig,
    | 'wasm'
    | 'dtsHeader'
    | 'dtsHeaderFile'
    | 'constEnum'
    | 'runtimeStringEnum'
    | 'binaries'
  > & {
    targets: Target[]
    packageJson: CommonPackageJsonFields
  }

export async function readNapiConfig(
  path: string,
  configPath?: string,
): Promise<NapiConfig> {
  if (configPath && !(await fileExists(configPath))) {
    throw new Error(`NAPI-RS config not found at ${configPath}`)
  }
  if (!(await fileExists(path))) {
    throw new Error(`package.json not found at ${path}`)
  }
  // May support multiple config sources later on.
  const content = await readFileAsync(path, 'utf8')
  let pkgJson
  try {
    pkgJson = JSON.parse(content) as CommonPackageJsonFields
  } catch (e) {
    throw new Error(`Failed to parse package.json at ${path}`, {
      cause: e,
    })
  }

  let separatedConfig: UserNapiConfig | undefined
  if (configPath) {
    const configContent = await readFileAsync(configPath, 'utf8')
    try {
      separatedConfig = JSON.parse(configContent) as UserNapiConfig
    } catch (e) {
      throw new Error(`Failed to parse NAPI-RS config at ${configPath}`, {
        cause: e,
      })
    }
  }

  const userNapiConfig = pkgJson.napi ?? {}
  if (pkgJson.napi && separatedConfig) {
    const pkgJsonPath = underline(path)
    const configPathUnderline = underline(configPath!)
    console.warn(
      yellow(
        `Both napi field in ${pkgJsonPath} and [NAPI-RS config](${configPathUnderline}) file are found, the NAPI-RS config file will be used.`,
      ),
    )
  }
  if (separatedConfig) {
    Object.assign(userNapiConfig, separatedConfig)
  }
  const napiConfig: NapiConfig = merge(
    {
      binaryName: 'index',
      packageName: pkgJson.name,
      targets: [],
      packageJson: pkgJson,
      npmClient: 'npm',
    },
    omit(userNapiConfig, ['targets']),
  )

  let targets: string[] = userNapiConfig.targets ?? []

  // compatible with old config
  if (userNapiConfig?.name) {
    console.warn(
      yellow(
        `[DEPRECATED] napi.name is deprecated, use napi.binaryName instead.`,
      ),
    )
    napiConfig.binaryName = userNapiConfig.name
  }

  if (!targets.length) {
    let deprecatedWarned = false
    const warning = yellow(
      `[DEPRECATED] napi.triples is deprecated, use napi.targets instead.`,
    )
    if (userNapiConfig.triples?.defaults) {
      deprecatedWarned = true
      console.warn(warning)
      targets = targets.concat(DEFAULT_TARGETS)
    }

    if (userNapiConfig.triples?.additional?.length) {
      targets = targets.concat(userNapiConfig.triples.additional)
      if (!deprecatedWarned) {
        console.warn(warning)
      }
    }
  }

  // find duplicate targets
  const uniqueTargets = new Set(targets)
  if (uniqueTargets.size !== targets.length) {
    const duplicateTarget = targets.find(
      (target, index) => targets.indexOf(target) !== index,
    )
    throw new Error(`Duplicate targets are not allowed: ${duplicateTarget}`)
  }

  const parsedTargets = targets.map(parseTriple)
  const outputTargets = new Map<string, string>()
  for (const [index, target] of parsedTargets.entries()) {
    const previous = outputTargets.get(target.platformArchABI)
    if (previous) {
      throw new Error(
        `Targets ${previous} and ${targets[index]} produce the same ${target.platformArchABI} artifact set. Choose one target spelling.`,
      )
    }
    outputTargets.set(target.platformArchABI, targets[index])
  }

  napiConfig.targets = parsedTargets

  return napiConfig
}
