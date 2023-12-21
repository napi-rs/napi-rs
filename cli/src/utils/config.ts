import { underline, yellow } from 'colorette'
import { merge, omit } from 'lodash-es'

import { fileExists, readFileAsync } from './misc.js'
import { DEFAULT_TARGETS, parseTriple, Target } from './target.js'

export type ValueOfConstArray<T> = T[Exclude<keyof T, keyof Array<any>>]

export const SupportedPackageManagers = ['yarn'] as const
export const SupportedTestFrameworks = ['ava'] as const

export type SupportedPackageManager = ValueOfConstArray<
  typeof SupportedPackageManagers
>
export type SupportedTestFramework = ValueOfConstArray<
  typeof SupportedTestFrameworks
>

export interface UserNapiConfig {
  /**
   * Name of the binary to be generated, default to `index`
   */
  binaryName?: string
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
  exports?: any

  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>

  ava?: {
    timeout?: string
  }
}

export type NapiConfig = Required<
  Pick<UserNapiConfig, 'binaryName' | 'packageName' | 'npmClient'>
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
    omit(userNapiConfig, 'targets'),
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

  napiConfig.targets = targets.map(parseTriple)

  return napiConfig
}
