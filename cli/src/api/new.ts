import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { load as yamlLoad, dump as yamlDump } from 'js-yaml'

import {
  applyDefaultNewOptions,
  NewOptions as RawNewOptions,
} from '../def/new.js'
import {
  AVAILABLE_TARGETS,
  debugFactory,
  DEFAULT_TARGETS,
  mkdirAsync,
  readdirAsync,
  statAsync,
  SupportedPackageManager,
} from '../utils/index.js'
import { napiEngineRequirement } from '../utils/version.js'
import { renameProject } from './rename.js'

// Template imports removed as we're now using external templates

const debug = debugFactory('new')

type NewOptions = Required<RawNewOptions>

const TEMPLATE_REPOS = {
  yarn: 'https://github.com/napi-rs/package-template',
  pnpm: 'https://github.com/napi-rs/package-template-pnpm',
} as const

function checkGitCommand(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function ensureCacheDir(
  packageManager: SupportedPackageManager,
): Promise<string> {
  const cacheDir = path.join(homedir(), '.napi-rs', 'template', packageManager)
  await mkdirAsync(cacheDir, { recursive: true })
  return cacheDir
}

async function downloadTemplate(
  packageManager: SupportedPackageManager,
  cacheDir: string,
): Promise<void> {
  const repoUrl = TEMPLATE_REPOS[packageManager]
  const templatePath = path.join(cacheDir, 'repo')

  if (existsSync(templatePath)) {
    debug(`Template cache found at ${templatePath}, updating...`)
    try {
      // Fetch latest changes and reset to remote
      execSync('git fetch origin', { cwd: templatePath, stdio: 'inherit' })
      execSync('git reset --hard origin/main', {
        cwd: templatePath,
        stdio: 'inherit',
      })
      debug('Template updated successfully')
    } catch (error) {
      debug(`Failed to update template: ${error}`)
      throw new Error(`Failed to update template from ${repoUrl}: ${error}`)
    }
  } else {
    debug(`Cloning template from ${repoUrl}...`)
    try {
      execSync(`git clone ${repoUrl} repo`, { cwd: cacheDir, stdio: 'inherit' })
      debug('Template cloned successfully')
    } catch (error) {
      throw new Error(`Failed to clone template from ${repoUrl}: ${error}`)
    }
  }
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdirAsync(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    // Skip .git directory
    if (entry.name === '.git') {
      continue
    }

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

async function filterTargetsInPackageJson(
  filePath: string,
  enabledTargets: string[],
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8')
  const packageJson = JSON.parse(content)

  // Filter napi.targets
  if (packageJson.napi?.targets) {
    packageJson.napi.targets = packageJson.napi.targets.filter(
      (target: string) => enabledTargets.includes(target),
    )
  }

  await fs.writeFile(filePath, JSON.stringify(packageJson, null, 2) + '\n')
}

async function filterTargetsInGithubActions(
  filePath: string,
  enabledTargets: string[],
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8')
  const yaml = yamlLoad(content) as any

  // Filter the matrix configurations in the build job
  if (yaml?.jobs?.build?.strategy?.matrix?.settings) {
    yaml.jobs.build.strategy.matrix.settings =
      yaml.jobs.build.strategy.matrix.settings.filter((setting: any) => {
        if (setting.target) {
          return enabledTargets.includes(setting.target)
        }
        return true
      })
  }

  // Filter the matrix configurations in the test-macOS-windows-binding job
  if (yaml?.jobs?.['test-macOS-windows-binding']?.strategy?.matrix?.settings) {
    yaml.jobs['test-macOS-windows-binding'].strategy.matrix.settings =
      yaml.jobs['test-macOS-windows-binding'].strategy.matrix.settings.filter(
        (setting: any) => {
          if (setting.target) {
            return enabledTargets.includes(setting.target)
          }
          return true
        },
      )
  }

  // Filter the matrix configurations in the test-linux-x64-gnu-binding job
  if (yaml?.jobs?.['test-linux-x64-gnu-binding']?.strategy?.matrix?.settings) {
    yaml.jobs['test-linux-x64-gnu-binding'].strategy.matrix.settings =
      yaml.jobs['test-linux-x64-gnu-binding'].strategy.matrix.settings.filter(
        (setting: any) => {
          if (setting.target) {
            return enabledTargets.includes(setting.target)
          }
          return true
        },
      )
  }

  // Filter other test jobs based on target
  const jobsToRemove: string[] = []
  for (const [jobName, jobConfig] of Object.entries(yaml.jobs || {})) {
    if (
      jobName.startsWith('test-') &&
      jobName !== 'test-macOS-windows-binding' &&
      jobName !== 'test-linux-x64-gnu-binding'
    ) {
      // Extract target from job name or config
      const job = jobConfig as any
      if (job.strategy?.matrix?.settings?.[0]?.target) {
        const target = job.strategy.matrix.settings[0].target
        if (!enabledTargets.includes(target)) {
          jobsToRemove.push(jobName)
        }
      }
    }
  }

  // Remove jobs for disabled targets
  for (const jobName of jobsToRemove) {
    delete yaml.jobs[jobName]
  }

  // Write back the filtered YAML
  const updatedYaml = yamlDump(yaml, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  })
  await fs.writeFile(filePath, updatedYaml)
}

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
  if (
    options.targets.some((target) => target === 'wasm32-wasi-preview1-threads')
  ) {
    const out = execSync(`rustup target list`, {
      encoding: 'utf8',
    })
    if (out.includes('wasm32-wasip1-threads')) {
      options.targets = options.targets.map((target) =>
        target === 'wasm32-wasi-preview1-threads'
          ? 'wasm32-wasip1-threads'
          : target,
      )
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

  // Check if git is available
  if (!checkGitCommand()) {
    throw new Error(
      'Git is not installed or not available in PATH. Please install Git to continue.',
    )
  }

  const packageManager = options.packageManager as SupportedPackageManager

  // Ensure target directory exists and is empty
  await ensurePath(options.path, options.dryRun)

  if (!options.dryRun) {
    try {
      // Download or update template
      const cacheDir = await ensureCacheDir(packageManager)
      await downloadTemplate(packageManager, cacheDir)

      // Copy template files to target directory
      const templatePath = path.join(cacheDir, 'repo')
      await copyDirectory(templatePath, options.path)

      // Rename project using the rename API
      await renameProject({
        cwd: options.path,
        name: options.name,
        binaryName: getBinaryName(options.name),
      })

      // Filter targets in package.json
      const packageJsonPath = path.join(options.path, 'package.json')
      if (existsSync(packageJsonPath)) {
        await filterTargetsInPackageJson(packageJsonPath, options.targets)
      }

      // Filter targets in GitHub Actions CI
      const ciPath = path.join(options.path, '.github', 'workflows', 'CI.yml')
      if (existsSync(ciPath) && options.enableGithubActions) {
        await filterTargetsInGithubActions(ciPath, options.targets)
      } else if (
        !options.enableGithubActions &&
        existsSync(path.join(options.path, '.github'))
      ) {
        // Remove .github directory if GitHub Actions is not enabled
        await fs.rm(path.join(options.path, '.github'), {
          recursive: true,
          force: true,
        })
      }

      // Update package.json with additional configurations
      const pkgJsonContent = await fs.readFile(packageJsonPath, 'utf-8')
      const pkgJson = JSON.parse(pkgJsonContent)

      // Update engine requirement
      if (!pkgJson.engines) {
        pkgJson.engines = {}
      }
      pkgJson.engines.node = napiEngineRequirement(options.minNodeApiVersion)

      // Update license if different from template
      if (options.license && pkgJson.license !== options.license) {
        pkgJson.license = options.license
      }

      // Update test framework if needed
      if (options.testFramework !== 'ava') {
        // This would require more complex logic to update test scripts and dependencies
        debug(
          `Test framework ${options.testFramework} requested but not yet implemented`,
        )
      }

      await fs.writeFile(
        packageJsonPath,
        JSON.stringify(pkgJson, null, 2) + '\n',
      )
    } catch (error) {
      throw new Error(`Failed to create project: ${error}`)
    }
  }

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

function getBinaryName(name: string): string {
  return name.split('/').pop()!
}

export { NewOptions }
