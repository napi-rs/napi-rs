export interface ArgSchema {
  name: string
  type: 'string'
  description: string
  required?: boolean
}

export interface OptionSchema {
  name: string
  type: string
  description: string
  required?: boolean
  default?: any
  short?: string
  long?: string
}

export interface CommandSchema {
  name: string
  description: string
  args: ArgSchema[]
  options: OptionSchema[]
}

export type CommandDefineSchema = CommandSchema[]

const NEW_OPTIONS: CommandSchema = {
  name: 'new',
  description: 'Create a new project with pre-configured boilerplate',
  args: [
    {
      name: 'path',
      type: 'string',
      description: 'The path where the NAPI-RS project will be created.',
      required: true,
    },
  ],
  options: [
    {
      name: 'name',
      type: 'string',
      description:
        'The name of the project, default to the name of the directory if not provided',
      short: 'n',
    },
    {
      name: 'minNodeApiVersion',
      type: 'number',
      description: 'The minimum Node-API version to support',
      default: 4,
      short: 'v',
      long: 'min-node-api',
    },
    // will support it later
    // {
    //   name: 'packageManager',
    //   type: 'string',
    //   description: 'The package manager to use',
    //   default: "'yarn'",
    // },
    {
      name: 'license',
      type: 'string',
      description: 'License for open-sourced project',
      short: 'l',
      default: "'MIT'",
    },
    {
      name: 'targets',
      type: 'string[]',
      description: 'All targets the crate will be compiled for.',
      short: 't',
      default: '[]',
    },
    {
      name: 'enableDefaultTargets',
      type: 'boolean',
      description: 'Whether enable default targets',
      default: true,
    },
    {
      name: 'enableAllTargets',
      type: 'boolean',
      description: 'Whether enable all targets',
      default: false,
    },
    {
      name: 'enableTypeDef',
      type: 'boolean',
      description:
        'Whether enable the `type-def` feature for typescript definitions auto-generation',
      default: true,
    },
    {
      name: 'enableGithubActions',
      type: 'boolean',
      description: 'Whether generate preconfigured GitHub Actions workflow',
      default: true,
    },
    {
      name: 'dryRun',
      type: 'boolean',
      description: 'Whether to run the command in dry-run mode',
      default: false,
    },
  ],
}

const BUILD_OPTIONS: CommandSchema = {
  name: 'build',
  description: 'Build the NAPI-RS project',
  args: [],
  options: [
    {
      name: 'target',
      type: 'string',
      description:
        'Build for the target triple, bypassed to `cargo build --target`',
      short: 't',
    },
    {
      name: 'cwd',
      type: 'string',
      description:
        'The working directory of where napi command will be executed in, all other paths options are relative to this path',
    },
    {
      name: 'manifestPath',
      type: 'string',
      description: 'Path to `Cargo.toml`',
    },
    {
      name: 'configPath',
      type: 'string',
      description: 'Path to `napi` config json file',
      short: 'c',
    },
    {
      name: 'packageJsonPath',
      type: 'string',
      description: 'Path to `package.json`',
    },
    {
      name: 'targetDir',
      type: 'string',
      description:
        'Directory for all crate generated artifacts, see `cargo build --target-dir`',
    },
    {
      name: 'outputDir',
      type: 'string',
      description:
        'Path to where all the built files would be put. Default to the crate folder',
      short: 'o',
    },
    {
      name: 'platform',
      type: 'boolean',
      description:
        'Add platform triple to the generated nodejs binding file, eg: `[name].linux-x64-gnu.node`',
    },
    {
      name: 'jsPackageName',
      type: 'string',
      description:
        'Package name in generated js binding file. Only works with `--platform` flag',
    },
    {
      name: 'constEnum',
      type: 'boolean',
      description: 'Whether generate const enum for typescript bindings',
    },
    {
      name: 'jsBinding',
      type: 'string',
      description:
        'Path and filename of generated JS binding file. Only works with `--platform` flag. Relative to `--output_dir`.',
      long: 'js',
    },
    {
      name: 'noJsBinding',
      type: 'boolean',
      description:
        'Whether to disable the generation JS binding file. Only works with `--platform` flag.',
      long: 'no-js',
    },
    {
      name: 'dts',
      type: 'string',
      description:
        'Path and filename of generated type def file. Relative to `--output_dir`',
    },
    {
      name: 'dtsHeader',
      type: 'string',
      description:
        'Custom file header for generated type def file. Only works when `typedef` feature enabled.',
    },
    {
      name: 'noDtsHeader',
      type: 'boolean',
      description:
        'Whether to disable the default file header for generated type def file. Only works when `typedef` feature enabled.',
    },
    {
      name: 'strip',
      type: 'boolean',
      description: 'Whether strip the library to achieve the minimum file size',
      short: 's',
    },
    {
      name: 'release',
      type: 'boolean',
      description: 'Build in release mode',
      short: 'r',
    },
    {
      name: 'verbose',
      type: 'boolean',
      description: 'Verbosely log build command trace',
      short: 'v',
    },
    {
      name: 'bin',
      type: 'string',
      description: 'Build only the specified binary',
    },
    {
      name: 'package',
      type: 'string',
      description: 'Build the specified library or the one at cwd',
      short: 'p',
    },
    {
      name: 'profile',
      type: 'string',
      description: 'Build artifacts with the specified profile',
    },
    {
      name: 'crossCompile',
      type: 'boolean',
      description:
        '[experimental] cross-compile for the specified target with `cargo-xwin` on windows and `cargo-zigbuild` on other platform',
      short: 'x',
    },
    {
      name: 'useCross',
      type: 'boolean',
      description:
        '[experimental] use [cross](https://github.com/cross-rs/cross) instead of `cargo`',
    },
    {
      name: 'useNapiCross',
      type: 'boolean',
      description:
        '[experimental] use @napi-rs/cross-toolchain to cross-compile Linux arm/arm64/x64 gnu targets.',
    },
    {
      name: 'watch',
      type: 'boolean',
      description:
        'watch the crate changes and build continuously with `cargo-watch` crates',
      short: 'w',
    },
    {
      name: 'features',
      type: 'string[]',
      description: 'Space-separated list of features to activate',
      short: 'F',
    },
    {
      name: 'allFeatures',
      type: 'boolean',
      description: 'Activate all available features',
    },
    {
      name: 'noDefaultFeatures',
      type: 'boolean',
      description: 'Do not activate the `default` feature',
    },
  ],
}

const ARTIFACTS_OPTIONS: CommandSchema = {
  name: 'artifacts',
  description:
    'Copy artifacts from Github Actions into npm packages and ready to publish',
  args: [],
  options: [
    {
      name: 'cwd',
      type: 'string',
      description:
        'The working directory of where napi command will be executed in, all other paths options are relative to this path',
      default: 'process.cwd()',
    },
    {
      name: 'configPath',
      type: 'string',
      description: 'Path to `napi` config json file',
      short: 'c',
    },
    {
      name: 'packageJsonPath',
      type: 'string',
      description: 'Path to `package.json`',
      default: "'package.json'",
    },
    {
      name: 'outputDir',
      type: 'string',
      description:
        'Path to the folder where all built `.node` files put, same as `--output-dir` of build command',
      short: 'o',
      default: "'./artifacts'",
    },
    {
      name: 'npmDir',
      type: 'string',
      description: 'Path to the folder where the npm packages put',
      default: "'npm'",
    },
  ],
}

const CREATE_NPM_DIRS_OPTIONS: CommandSchema = {
  name: 'createNpmDirs',
  description: 'Create npm package dirs for different platforms',
  args: [],
  options: [
    {
      name: 'cwd',
      type: 'string',
      description:
        'The working directory of where napi command will be executed in, all other paths options are relative to this path',
      default: 'process.cwd()',
    },
    {
      name: 'configPath',
      type: 'string',
      description: 'Path to `napi` config json file',
      short: 'c',
    },
    {
      name: 'packageJsonPath',
      type: 'string',
      description: 'Path to `package.json`',
      default: "'package.json'",
    },
    {
      name: 'npmDir',
      type: 'string',
      description: 'Path to the folder where the npm packages put',
      default: "'npm'",
    },
    {
      name: 'dryRun',
      type: 'boolean',
      description: 'Dry run without touching file system',
      default: false,
    },
  ],
}

const RENAME_OPTIONS: CommandSchema = {
  name: 'rename',
  description: 'Rename the NAPI-RS project',
  args: [],
  options: [
    {
      name: 'cwd',
      type: 'string',
      description:
        'The working directory of where napi command will be executed in, all other paths options are relative to this path',
      default: 'process.cwd()',
    },
    {
      name: 'configPath',
      type: 'string',
      description: 'Path to `napi` config json file',
      short: 'c',
    },
    {
      name: 'packageJsonPath',
      type: 'string',
      description: 'Path to `package.json`',
      default: "'package.json'",
    },
    {
      name: 'npmDir',
      type: 'string',
      description: 'Path to the folder where the npm packages put',
      default: "'npm'",
    },
    {
      name: 'name',
      type: 'string',
      description: 'The new name of the project',
      short: 'n',
    },
    {
      name: 'binaryName',
      type: 'string',
      description: 'The new binary name *.node files',
      short: 'b',
    },
    {
      name: 'packageName',
      type: 'string',
      description: 'The new package name of the project',
    },
    {
      name: 'manifestPath',
      type: 'string',
      description: 'Path to `Cargo.toml`',
      default: "'Cargo.toml'",
    },
    {
      name: 'repository',
      type: 'string',
      description: 'The new repository of the project',
    },
    {
      name: 'description',
      type: 'string',
      description: 'The new description of the project',
    },
  ],
}

const UNIVERSALIZE_OPTIONS: CommandSchema = {
  name: 'universalize',
  description: 'Combile built binaries into one universal binary',
  args: [],
  options: [
    {
      name: 'cwd',
      type: 'string',
      description:
        'The working directory of where napi command will be executed in, all other paths options are relative to this path',
      default: 'process.cwd()',
    },
    {
      name: 'configPath',
      type: 'string',
      description: 'Path to `napi` config json file',
      short: 'c',
    },
    {
      name: 'packageJsonPath',
      type: 'string',
      description: 'Path to `package.json`',
      default: "'package.json'",
    },
    {
      name: 'outputDir',
      type: 'string',
      description:
        'Path to the folder where all built `.node` files put, same as `--output-dir` of build command',
      short: 'o',
      default: "'./'",
    },
  ],
}

const VERSION_OPTIONS: CommandSchema = {
  name: 'version',
  description: 'Update version in created npm packages',
  args: [],
  options: [
    {
      name: 'cwd',
      type: 'string',
      description:
        'The working directory of where napi command will be executed in, all other paths options are relative to this path',
      default: 'process.cwd()',
    },
    {
      name: 'configPath',
      type: 'string',
      description: 'Path to `napi` config json file',
      short: 'c',
    },
    {
      name: 'packageJsonPath',
      type: 'string',
      description: 'Path to `package.json`',
      default: "'package.json'",
    },
    {
      name: 'npmDir',
      type: 'string',
      description: 'Path to the folder where the npm packages put',
      default: "'npm'",
    },
  ],
}

const PRE_PUBLISH_OPTIONS: CommandSchema = {
  name: 'prePublish',
  description: 'Update package.json and copy addons into per platform packages',
  args: [],
  options: [
    {
      name: 'cwd',
      type: 'string',
      description:
        'The working directory of where napi command will be executed in, all other paths options are relative to this path',
      default: 'process.cwd()',
    },
    {
      name: 'configPath',
      type: 'string',
      description: 'Path to `napi` config json file',
      short: 'c',
    },
    {
      name: 'packageJsonPath',
      type: 'string',
      description: 'Path to `package.json`',
      default: "'package.json'",
    },
    {
      name: 'npmDir',
      type: 'string',
      description: 'Path to the folder where the npm packages put',
      default: "'npm'",
    },
    {
      name: 'tagStyle',
      type: "'npm' | 'lerna'",
      description: 'git tag style, `npm` or `lerna`',
      default: "'lerna'",
      short: 't',
    },
    {
      name: 'ghRelease',
      type: 'boolean',
      description: 'Whether create GitHub release',
      default: true,
    },
    {
      name: 'ghReleaseName',
      type: 'string',
      description: 'GitHub release name',
    },
    {
      name: 'ghReleaseId',
      type: 'string',
      description: 'Existing GitHub release id',
    },
    {
      name: 'dryRun',
      type: 'boolean',
      description: 'Dry run without touching file system',
      default: false,
    },
  ],
}

export const commandDefines: CommandDefineSchema = [
  NEW_OPTIONS,
  BUILD_OPTIONS,
  ARTIFACTS_OPTIONS,
  CREATE_NPM_DIRS_OPTIONS,
  RENAME_OPTIONS,
  UNIVERSALIZE_OPTIONS,
  VERSION_OPTIONS,
  PRE_PUBLISH_OPTIONS,
]
