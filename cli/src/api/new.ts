import { exec, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { parse as parseToml, stringify as stringifyToml } from '@std/toml'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'

import {
  applyDefaultNewOptions,
  type NewOptions as RawNewOptions,
} from '../def/new.js'
import {
  AVAILABLE_TARGETS,
  CLI_VERSION,
  debugFactory,
  DEFAULT_TARGETS,
  getWasiTarget,
  mkdirAsync,
  parseTriple,
  readdirAsync,
  statAsync,
  wasiTargetHasThreads,
  type SupportedPackageManager,
} from '../utils/index.js'
import {
  napiEngineRequirement,
  SUPPORTED_NAPI_VERSIONS,
  restrictWasiNodeEngine,
} from '../utils/version.js'
import { renameProject } from './rename.js'
import { createCjsBinding } from './templates/index.js'

// Template imports removed as we're now using external templates

const debug = debugFactory('new')

type NewOptions = Required<RawNewOptions>

const TEMPLATE_REPOS = {
  yarn: 'https://github.com/napi-rs/package-template',
  pnpm: 'https://github.com/napi-rs/package-template-pnpm',
} as const

const TEMPLATE_LOCKFILES: Record<SupportedPackageManager, string> = {
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
}
const WASI_CI_ARTIFACT_PATTERNS = [
  'index.js',
  'browser.js',
  '*.wasi*.cjs',
  '*.wasi*.d.cts',
  '*.wasi*-browser.js',
  '*.wasi*-deferred.js',
  '*.wasi*-deferred.d.ts',
  'wasi-worker*.mjs',
]
// Exported for tests.
export const GENERATED_WASI_BINDING =
  /(?:\.(?:wasi|wasip\d+)(?:-browser|-deferred)?\.(?:cjs|js|d\.[cm]?ts)|wasi-worker(?:-browser)?\.mjs)/
const TYPE_DEF_FILE = /\.d\.[cm]?ts$/
const GLOB_PATTERN = /[*?[\]{}]/

function createWasiBrowserEntry(
  packageName: string,
  platformArchABI: string,
  enableTypeDef: boolean,
) {
  const packageSpecifier = `${packageName}-${platformArchABI}`
  return (
    `export * from '${packageSpecifier}'\n` +
    (enableTypeDef ? '' : `export { default } from '${packageSpecifier}'\n`)
  )
}

function stripTypeConditions(
  value: unknown,
  typeDefPaths: Set<string>,
): unknown {
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => stripTypeConditions(entry, typeDefPaths))
      .filter((entry) => entry !== undefined)
    return entries.length > 0 ? entries : undefined
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'types') {
      if (typeof entry === 'string') {
        typeDefPaths.add(entry)
      }
      continue
    }
    const stripped = stripTypeConditions(entry, typeDefPaths)
    if (stripped !== undefined) {
      result[key] = stripped
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

async function removeTypeDefOutput(
  packageJson: Record<string, any>,
  packageDir: string,
) {
  const typeDefPaths = new Set<string>(['index.d.ts'])
  for (const field of ['types', 'typings']) {
    if (typeof packageJson[field] === 'string') {
      typeDefPaths.add(packageJson[field])
    }
    delete packageJson[field]
  }
  delete packageJson.typesVersions

  if (packageJson.exports !== undefined) {
    const exports = stripTypeConditions(packageJson.exports, typeDefPaths)
    if (exports === undefined) {
      delete packageJson.exports
    } else {
      packageJson.exports = exports
    }
  }

  if (Array.isArray(packageJson.files)) {
    packageJson.files = packageJson.files.filter((file: unknown) => {
      if (typeof file !== 'string' || !TYPE_DEF_FILE.test(file)) {
        return true
      }
      typeDefPaths.add(file)
      return false
    })
  }

  for (const typeDefPath of typeDefPaths) {
    const relativePath = typeDefPath.replace(/^\.\//, '')
    if (!TYPE_DEF_FILE.test(relativePath) || GLOB_PATTERN.test(relativePath)) {
      continue
    }
    const absolutePath = path.resolve(packageDir, relativePath)
    const relativeToPackage = path.relative(packageDir, absolutePath)
    if (
      relativeToPackage === '' ||
      relativeToPackage.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToPackage)
    ) {
      continue
    }
    await fs.rm(absolutePath, { force: true })
  }
}

async function checkGitCommand(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const cp = exec('git --version')
    cp.on('error', () => {
      resolve(false)
    })
    cp.on('exit', (code) => {
      resolve(code === 0)
    })
  })
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
      await new Promise<void>((resolve, reject) => {
        const cp = exec('git fetch origin', { cwd: templatePath })
        cp.on('error', reject)
        cp.on('exit', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(
              new Error(
                `Failed to fetch latest changes, git process exited with code ${code}`,
              ),
            )
          }
        })
      })
      execSync('git reset --hard origin/main', {
        cwd: templatePath,
        stdio: 'ignore',
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

async function copyDirectory(
  src: string,
  dest: string,
  hasWasiTargets: boolean,
): Promise<void> {
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
      await copyDirectory(srcPath, destPath, hasWasiTargets)
    } else {
      if (
        entry.name === 'browser.js' ||
        GENERATED_WASI_BINDING.test(entry.name) ||
        (hasWasiTargets && entry.name === 'index.js')
      ) {
        continue
      }
      await fs.copyFile(srcPath, destPath)
    }
  }
}

async function filterTargetsInPackageJson(
  filePath: string,
  enabledTargets: string[],
  enableTypeDef: boolean,
  packageManager: SupportedPackageManager,
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8')
  const packageJson = JSON.parse(content)
  const wasiTargets = enabledTargets
    .map(parseTriple)
    .filter((target) => target.platform === 'wasi')
  const includeWasiBindings = wasiTargets.length > 0
  const includeThreadlessWasi = wasiTargets.some(
    (target) => !wasiTargetHasThreads(target),
  )

  // The external templates may not yet list newly supported targets. The
  // requested target set is authoritative rather than a filter over the
  // template's current contents.
  packageJson.napi ??= {}
  packageJson.napi.targets = enabledTargets

  if (includeThreadlessWasi) {
    packageJson.devDependencies ??= {}
    packageJson.devDependencies['@napi-rs/cli'] = `^${CLI_VERSION}`
    // Template lockfiles can pin an older CLI that predates this target even
    // when package.json's range is updated. The first install must resolve a
    // lockfile from the generated manifest.
    await fs.rm(
      path.join(path.dirname(filePath), TEMPLATE_LOCKFILES[packageManager]),
      { force: true },
    )
  }

  if (!enableTypeDef) {
    await removeTypeDefOutput(packageJson, path.dirname(filePath))
  }

  if (includeWasiBindings) {
    packageJson.browser = 'browser.js'
    packageJson.files ??= []
    if (!packageJson.files.includes('browser.js')) {
      packageJson.files.push('browser.js')
    }
    const browserTarget =
      wasiTargets.find(
        (target) => getWasiTarget(target)?.flavor === 'single',
      ) ?? wasiTargets[0]
    await fs.writeFile(
      path.join(path.dirname(filePath), 'browser.js'),
      createWasiBrowserEntry(
        packageJson.name,
        browserTarget.platformArchABI,
        enableTypeDef,
      ),
    )
    if (!enableTypeDef) {
      const wasiFlavors = [
        ...wasiTargets.filter(wasiTargetHasThreads),
        ...wasiTargets.filter((target) => !wasiTargetHasThreads(target)),
      ].map((target) => target.platformArchABI)
      packageJson.main = 'index.js'
      if (
        !packageJson.files.includes('index.js') &&
        !packageJson.files.includes('./index.js')
      ) {
        packageJson.files.push('index.js')
      }
      await fs.writeFile(
        path.join(path.dirname(filePath), 'index.js'),
        createCjsBinding(
          packageJson.napi.binaryName,
          packageJson.napi.packageName ?? packageJson.name,
          [],
          packageJson.version,
          wasiFlavors,
        ),
      )
    }
  } else {
    if (
      packageJson.browser === 'browser.js' ||
      packageJson.browser === './browser.js'
    ) {
      delete packageJson.browser
    }

    if (Array.isArray(packageJson.files)) {
      packageJson.files = packageJson.files.filter(
        (file: unknown) => file !== 'browser.js' && file !== './browser.js',
      )
    }
  }

  await fs.writeFile(filePath, JSON.stringify(packageJson, null, 2) + '\n')
  await updateGeneratedWasiAttributes(
    path.join(path.dirname(filePath), '.gitattributes'),
    packageJson.napi.binaryName,
    wasiTargets,
  )
}

async function updateGeneratedWasiAttributes(
  filePath: string,
  binaryName: string,
  wasiTargets: ReturnType<typeof parseTriple>[],
) {
  if (!existsSync(filePath)) {
    return
  }

  const lines = (await fs.readFile(filePath, 'utf8'))
    .split('\n')
    .filter((line) => !GENERATED_WASI_BINDING.test(line))
  const generatedFiles = new Set<string>()
  for (const target of wasiTargets) {
    const suffix = target.platformArchABI.replace(/^wasm32-/, '')
    generatedFiles.add(`${binaryName}.${suffix}.cjs`)
    generatedFiles.add(`${binaryName}.${suffix}.d.cts`)
    generatedFiles.add(`${binaryName}.${suffix}-browser.js`)
    if (getWasiTarget(target)?.flavor === 'threads') {
      generatedFiles.add('wasi-worker.mjs')
      generatedFiles.add('wasi-worker-browser.mjs')
    } else {
      generatedFiles.add(`${binaryName}.${suffix}-deferred.js`)
      generatedFiles.add(`${binaryName}.${suffix}-deferred.d.ts`)
    }
  }
  if (generatedFiles.size > 0) {
    while (lines[lines.length - 1] === '') {
      lines.pop()
    }
    lines.push(
      '',
      ...[...generatedFiles].map((file) => `${file} linguist-detectable=false`),
    )
  }
  await fs.writeFile(filePath, `${lines.join('\n')}\n`)
}

async function updateCargoTomlTypeDef(
  filePath: string,
  enableTypeDef: boolean,
): Promise<void> {
  if (enableTypeDef) {
    return
  }

  const content = await fs.readFile(filePath, 'utf-8')
  const cargoToml = parseToml(content) as Record<string, any>
  const dependencies = cargoToml.dependencies

  if (!dependencies || !dependencies['napi-derive']) {
    return
  }

  const napiDeriveDependency = dependencies['napi-derive']
  const dependencyConfig =
    typeof napiDeriveDependency === 'string'
      ? { version: napiDeriveDependency }
      : { ...napiDeriveDependency }

  const existingFeatures: string[] = Array.isArray(dependencyConfig.features)
    ? dependencyConfig.features.filter(
        (feature: unknown): feature is string => typeof feature === 'string',
      )
    : []

  dependencyConfig['default-features'] = false
  dependencyConfig.features = [
    'strict',
    ...existingFeatures.filter((feature) => feature !== 'strict'),
  ].filter((feature) => feature !== 'type-def')

  dependencies['napi-derive'] = dependencyConfig

  await fs.writeFile(filePath, stringifyToml(cargoToml))
}

export async function updateCargoTomlNodeApiVersion(
  filePath: string,
  minNodeApiVersion: number,
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8')
  const cargoToml = parseToml(content) as Record<string, any>
  const dependencies = cargoToml.dependencies

  if (!dependencies || !dependencies.napi) {
    return
  }

  const napiDependency = dependencies.napi
  const dependencyConfig =
    typeof napiDependency === 'string'
      ? { version: napiDependency }
      : { ...napiDependency }
  const usedDefaultFeatures = dependencyConfig['default-features'] !== false
  const existingFeatures: string[] = Array.isArray(dependencyConfig.features)
    ? dependencyConfig.features.filter(
        (feature: unknown): feature is string => typeof feature === 'string',
      )
    : []

  dependencyConfig.features = [
    `napi${minNodeApiVersion}`,
    ...existingFeatures.filter((feature) => !/^napi\d+$/.test(feature)),
  ]

  // napi's default features include napi4. Disable them for lower requested
  // levels, while retaining the default dynamic Node-API symbol loading mode.
  if (minNodeApiVersion < 4) {
    dependencyConfig['default-features'] = false
    if (
      usedDefaultFeatures &&
      !dependencyConfig.features.includes('dyn-symbols')
    ) {
      dependencyConfig.features.push('dyn-symbols')
    }
  }

  dependencies.napi = dependencyConfig

  await fs.writeFile(filePath, stringifyToml(cargoToml))
}

async function filterTargetsInGithubActions(
  filePath: string,
  enabledTargets: string[],
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8')
  const yaml = yamlLoad(content) as any

  const linuxTargets = new Set([
    'x86_64-unknown-linux-gnu',
    'x86_64-unknown-linux-musl',
    'aarch64-unknown-linux-gnu',
    'aarch64-unknown-linux-musl',
    'armv7-unknown-linux-gnueabihf',
    'armv7-unknown-linux-musleabihf',
    'loongarch64-unknown-linux-gnu',
    'loongarch64-unknown-linux-musl',
    'riscv64gc-unknown-linux-gnu',
    'powerpc64le-unknown-linux-gnu',
    's390x-unknown-linux-gnu',
    'aarch64-linux-android',
    'armv7-linux-androideabi',
  ])

  // Check if any Linux targets are enabled
  const hasLinuxTargets = enabledTargets.some((target) =>
    linuxTargets.has(target),
  )
  const hasMacOSOrWindowsTargets = enabledTargets.some((target) => {
    const platform = parseTriple(target).platform
    return platform === 'darwin' || platform === 'win32'
  })
  const wasiTargets = enabledTargets.filter((target) => getWasiTarget(target))

  // Filter the matrix configurations in the build job
  if (yaml?.jobs?.build?.strategy?.matrix?.settings) {
    const settings = yaml.jobs.build.strategy.matrix.settings
    const wasiTemplate = settings.find(
      (setting: any) => setting.target && getWasiTarget(setting.target),
    )
    const wasiTemplateTarget =
      typeof wasiTemplate?.target === 'string' ? wasiTemplate.target : undefined
    const wasiTargetComparison = wasiTemplateTarget
      ? new RegExp(
          `matrix\\.settings\\.target\\s*(==|!=)\\s*(['"])${wasiTemplateTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\2`,
        )
      : undefined
    const filteredSettings = settings.filter((setting: any) => {
      if (setting.target && getWasiTarget(setting.target)) {
        return false
      }
      if (setting.target) {
        return enabledTargets.includes(setting.target)
      }
      return true
    })
    if (wasiTargets.length > 0 && !wasiTemplate) {
      throw new Error('Template CI is missing a WASI build matrix entry')
    }
    for (const target of wasiTargets) {
      const setting = { ...wasiTemplate }
      const templateTarget = setting.target
      setting.target = target
      if (typeof setting.build === 'string') {
        setting.build = setting.build.replaceAll(templateTarget, target)
      }
      filteredSettings.push(setting)
    }
    yaml.jobs.build.strategy.matrix.settings = filteredSettings

    for (const step of yaml.jobs.build.steps ?? []) {
      const operator =
        typeof step.if === 'string' && wasiTargetComparison
          ? step.if.match(wasiTargetComparison)?.[1]
          : undefined
      if (operator === '!=') {
        step.if = "${{ !startsWith(matrix.settings.target, 'wasm32-') }}"
      } else if (operator === '==') {
        step.if = "${{ startsWith(matrix.settings.target, 'wasm32-') }}"
      }
      if (
        wasiTargets.length > 0 &&
        typeof step.uses === 'string' &&
        step.uses.startsWith('actions/upload-artifact@') &&
        typeof step.with?.path === 'string' &&
        step.with.path.includes('.wasm')
      ) {
        const existingPatterns = step.with.path
          .split('\n')
          .map((pattern: string) => pattern.trim())
          .filter(Boolean)
        step.with.path = [
          ...new Set([...existingPatterns, ...WASI_CI_ARTIFACT_PATTERNS]),
        ].join('\n')
      }
    }
  }

  const jobsToRemove: string[] = []

  if (!hasMacOSOrWindowsTargets) {
    jobsToRemove.push('test-macOS-windows-binding')
  } else {
    // Filter the matrix configurations in the test-macOS-windows-binding job
    if (
      yaml?.jobs?.['test-macOS-windows-binding']?.strategy?.matrix?.settings
    ) {
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
  }

  // If no Linux targets are enabled, remove Linux-specific jobs
  if (!hasLinuxTargets) {
    // Remove test-linux-binding job
    if (yaml?.jobs?.['test-linux-binding']) {
      jobsToRemove.push('test-linux-binding')
    }
  } else {
    // Filter the matrix configurations in the test-linux-x64-gnu-binding job
    if (yaml?.jobs?.['test-linux-binding']?.strategy?.matrix?.target) {
      yaml.jobs['test-linux-binding'].strategy.matrix.target = yaml.jobs[
        'test-linux-binding'
      ].strategy.matrix.target.filter((target: string) => {
        if (target) {
          return enabledTargets.includes(target)
        }
        return true
      })
    }
  }

  if (wasiTargets.length === 0) {
    jobsToRemove.push('test-wasi')
  } else if (yaml.jobs?.['test-wasi']) {
    const wasiJob = yaml.jobs['test-wasi']
    if (wasiTargets.length > 1) {
      wasiJob.strategy = {
        'fail-fast': false,
        matrix: {
          target: wasiTargets,
        },
      }
      wasiJob.name = 'Test WASI target - ${{ matrix.target }}'
    }
    const downloadStep = wasiJob.steps?.find(
      (step: any) =>
        typeof step.uses === 'string' &&
        step.uses.startsWith('actions/download-artifact@'),
    )
    if (downloadStep?.with) {
      downloadStep.with.name =
        wasiTargets.length === 1
          ? `bindings-${wasiTargets[0]}`
          : 'bindings-${{ matrix.target }}'
    }
    for (const step of wasiJob.steps ?? []) {
      if (
        step.env &&
        Object.prototype.hasOwnProperty.call(step.env, 'NAPI_RS_FORCE_WASI')
      ) {
        step.env.NAPI_RS_FORCE_WASI = 'true'
      }
    }
  }

  if (!enabledTargets.includes('x86_64-unknown-freebsd')) {
    jobsToRemove.push('build-freebsd')
  }

  // Filter other test jobs based on target
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

  if (Array.isArray(yaml.jobs?.publish?.needs)) {
    yaml.jobs.publish.needs = yaml.jobs.publish.needs.filter(
      (need: string) => !jobsToRemove.includes(need),
    )
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
  const minNodeApiVersion = options.minNodeApiVersion ?? 4
  if (
    !Number.isInteger(minNodeApiVersion) ||
    !SUPPORTED_NAPI_VERSIONS.some((version) => version === minNodeApiVersion)
  ) {
    throw new RangeError(
      `Unsupported Node-API version ${minNodeApiVersion}. Expected one of: ${SUPPORTED_NAPI_VERSIONS.join(', ')}`,
    )
  }
  options.minNodeApiVersion = minNodeApiVersion

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
  const requestedTargets = options.targets.map((target) => ({
    target,
    parsed: parseTriple(target),
  }))
  options.targets = requestedTargets.map(({ parsed }) => parsed.triple)
  const outputTargets = new Map<string, string>()
  for (const { target, parsed } of requestedTargets) {
    const { platformArchABI } = parsed
    const previous = outputTargets.get(platformArchABI)
    if (previous) {
      throw new Error(
        `Targets ${previous} and ${target} produce the same ${platformArchABI} artifact set. Choose one target spelling.`,
      )
    }
    outputTargets.set(platformArchABI, target)
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
  if (!(await checkGitCommand())) {
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
      await copyDirectory(
        templatePath,
        options.path,
        options.targets.some((target) => getWasiTarget(target) !== undefined),
      )

      // Rename project using the rename API
      await renameProject({
        cwd: options.path,
        name: options.name,
        binaryName: getBinaryName(options.name),
      })

      const cargoTomlPath = path.join(options.path, 'Cargo.toml')
      if (existsSync(cargoTomlPath)) {
        await updateCargoTomlTypeDef(cargoTomlPath, options.enableTypeDef)
        await updateCargoTomlNodeApiVersion(
          cargoTomlPath,
          options.minNodeApiVersion,
        )
      }

      // Filter targets in package.json
      const packageJsonPath = path.join(options.path, 'package.json')
      if (existsSync(packageJsonPath)) {
        await filterTargetsInPackageJson(
          packageJsonPath,
          options.targets,
          options.enableTypeDef,
          packageManager,
        )
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
      const nodeEngineRequirement = napiEngineRequirement(
        options.minNodeApiVersion,
      )
      pkgJson.engines.node = options.targets.every(
        (target) => parseTriple(target).platform === 'wasi',
      )
        ? restrictWasiNodeEngine(nodeEngineRequirement)
        : nodeEngineRequirement

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

export type { NewOptions }
