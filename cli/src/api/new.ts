import path from 'path'

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
  writeFileAsync,
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

  const outputs = generateFiles(options)

  try {
    debug(`Try to create target directory: ${options.path}`)
    if (!options.dryRun) {
      await mkdirAsync(options.path, { recursive: true })
    }
  } catch (e) {
    throw new Error(`Failed to create target directory: ${options.path}`, {
      cause: e,
    })
  }

  await dumpOutputs(outputs, options.dryRun)
  debug(`Project created at: ${options.path}`)
}

function generateFiles(options: NewOptions): Output[] {
  return [
    generateCargoToml,
    generateLibRs,
    generateBuildRs,
    generatePackageJson,
    generateGithubWorkflow,
    generateIgnoreFiles,
  ].flatMap((generator) => {
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

function generatePackageJson(options: NewOptions): Output {
  return {
    target: './package.json',
    content: createPackageJson({
      name: options.name,
      binaryName: getBinaryName(options.name),
      targets: options.targets,
      license: options.license,
      engineRequirement: napiEngineRequirement(options.minNodeApiVersion),
      cliVersion: CLI_VERSION,
      esm: options.esm,
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
      getBinaryName(options.name),
      options.targets,
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
