import path from 'node:path'

import {
  applyDefaultNewOptions,
  NewOptions as RawNewOptions,
} from '../def/new.js'
import {
  AVAILABLE_TARGETS,
  CLI_VERSION,
  debugFactory,
  DEFAULT_TARGETS,
  mkdirAsync,
  readdirAsync,
  statAsync,
  type SupportedTestFramework,
  writeFileAsync,
  SupportedPackageManager,
} from '../utils/index.js'
import { napiEngineRequirement } from '../utils/version.js'

import {
  createBuildRs,
  createCargoToml,
  createGithubActionsCIYml,
  createLibRs,
  createPackageJson,
  gitIgnore,
  npmIgnore,
} from './templates/index.js'

const debug = debugFactory('new')

interface Output {
  target: string
  content: string
}

type NewOptions = Required<RawNewOptions>

function processOptions(options: RawNewOptions) {
  debug('Processing options...')
  if (!options.path) {
    throw new Error('Please provide the path as the argument')
  }
  options.path = path.resolve(process.cwd(), options.path)
  debug(`Resolved target path to: ${options.path}`)

  if (!options.name) {
    options.name = path.parse(options.path).base
    debug(`No project name provided, fix it to dir name: ${options.name}`)
  }

  if (!options.targets?.length) {
    if (options.enableAllTargets) {
      options.targets = AVAILABLE_TARGETS.concat()
      debug('Enable all targets')
    } else if (options.enableDefaultTargets) {
      options.targets = DEFAULT_TARGETS.concat()
      debug('Enable default targets')
    } else {
      throw new Error('At least one target must be enabled')
    }
  }

  return applyDefaultNewOptions(options) as NewOptions
}

export async function newProject(userOptions: RawNewOptions) {
  debug('Will create napi-rs project with given options:')
  debug(userOptions)

  const options = processOptions(userOptions)

  debug('Targets to be enabled:')
  debug(options.targets)

  const outputs = await generateFiles(options)

  await ensurePath(options.path, options.dryRun)

  await dumpOutputs(outputs, options.dryRun)
  debug(`Project created at: ${options.path}`)
}

async function ensurePath(path: string, dryRun = false) {
  const stat = await statAsync(path, {}).catch(() => undefined)

  // file descriptor exists
  if (stat) {
    if (stat.isFile()) {
      throw new Error(
        `Path ${path} for creating new napi-rs project already exists and it's not a directory.`,
      )
    } else if (stat.isDirectory()) {
      const files = await readdirAsync(path)
      if (files.length) {
        throw new Error(
          `Path ${path} for creating new napi-rs project already exists and it's not empty.`,
        )
      }
    }
  }

  if (!dryRun) {
    try {
      debug(`Try to create target directory: ${path}`)
      if (!dryRun) {
        await mkdirAsync(path, { recursive: true })
      }
    } catch (e) {
      throw new Error(`Failed to create target directory: ${path}`, {
        cause: e,
      })
    }
  }
}

async function generateFiles(options: NewOptions): Promise<Output[]> {
  const packageJson = await generatePackageJson(options)
  return [
    generateCargoToml,
    generateLibRs,
    generateBuildRs,
    generateGithubWorkflow,
    generateIgnoreFiles,
  ]
    .flatMap((generator) => {
      const output = generator(options)

      if (!output) {
        return []
      }

      if (Array.isArray(output)) {
        return output.map((o) => ({
          ...o,
          target: path.join(options.path, o.target),
        }))
      } else {
        return [{ ...output, target: path.join(options.path, output.target) }]
      }
    })
    .concat([
      { ...packageJson, target: path.join(options.path, packageJson.target) },
    ])
}

function generateCargoToml(options: NewOptions): Output {
  return {
    target: './Cargo.toml',
    content: createCargoToml({
      name: options.name,
      license: options.license,
      features: [`napi${options.minNodeApiVersion}`],
      deriveFeatures: options.enableTypeDef ? ['type-def'] : [],
    }),
  }
}

function generateLibRs(_options: NewOptions): Output {
  return {
    target: './src/lib.rs',
    content: createLibRs(),
  }
}

function generateBuildRs(_options: NewOptions): Output {
  return {
    target: './build.rs',
    content: createBuildRs(),
  }
}

async function generatePackageJson(options: NewOptions): Promise<Output> {
  return {
    target: './package.json',
    content: await createPackageJson({
      name: options.name,
      binaryName: getBinaryName(options.name),
      targets: options.targets,
      license: options.license,
      engineRequirement: napiEngineRequirement(options.minNodeApiVersion),
      cliVersion: CLI_VERSION,
      testFramework: options.testFramework as SupportedTestFramework,
    }),
  }
}

function generateGithubWorkflow(options: NewOptions): Output | null {
  if (!options.enableGithubActions) {
    return null
  }

  return {
    target: './.github/workflows/ci.yml',
    content: createGithubActionsCIYml(
      options.targets,
      options.packageManager as SupportedPackageManager,
    ),
  }
}

function generateIgnoreFiles(_options: NewOptions): Output[] {
  return [
    {
      target: './.gitignore',
      content: gitIgnore,
    },
    {
      target: './.npmignore',
      content: npmIgnore,
    },
  ]
}

async function dumpOutputs(outputs: Output[], dryRun?: boolean) {
  for (const output of outputs) {
    if (!output) {
      continue
    }

    debug(`Writing project file: ${output.target}`)
    // only output content to logger instead of writing to file system
    if (dryRun) {
      debug(output.content)
      continue
    }

    try {
      await mkdirAsync(path.dirname(output.target), { recursive: true })
      await writeFileAsync(output.target, output.content, 'utf-8')
    } catch (e) {
      throw new Error(`Failed to write file: ${output.target}`, { cause: e })
    }
  }
}

function getBinaryName(name: string): string {
  return name.split('/').pop()!
}

export { NewOptions }
