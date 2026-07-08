import { existsSync, lstatSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { parse as parseToml, stringify as stringifyToml } from '@std/toml'
import { load as yamlParse, dump as yamlStringify } from 'js-yaml'
import { isNil, merge, omitBy, pick } from 'es-toolkit'
import * as find from 'empathic/find'

import { applyDefaultRenameOptions, type RenameOptions } from '../def/rename.js'
import {
  readConfig,
  readFileAsync,
  type Target,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  writeFileAtomic,
} from '../utils/index.js'

const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'
const SCOPED_PACKAGE_PATTERN = /^(?:@([^/]+?)\/)?([^/]+?)$/
const EXCLUDED_PACKAGE_NAMES = new Set(['node_modules', 'favicon.ico'])
const WINDOWS_RESERVED_FILENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

type JsonRecord = Record<string, unknown>

interface ManagedFileRename {
  source: string
  destination: string
}

interface StagedManagedFileRename extends ManagedFileRename {
  temporary: string
}

function pathExists(path: string) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function assertSafeBinaryName(name: unknown, description: string) {
  const hasControlCharacter =
    typeof name === 'string' &&
    [...name].some((character) => character.charCodeAt(0) <= 0x1f)
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.trim() !== name ||
    isAbsolute(name) ||
    /[<>:"/\\|?*]/.test(name) ||
    hasControlCharacter ||
    name.endsWith('.') ||
    WINDOWS_RESERVED_FILENAME.test(name)
  ) {
    throw new Error(
      `${description} must be a safe filename stem: ${JSON.stringify(name)}`,
    )
  }
}

function npmPackageNameErrors(name: unknown) {
  if (typeof name !== 'string') {
    return ['name must be a string']
  }

  const errors: string[] = []
  if (name.length === 0) {
    errors.push('name length must be greater than zero')
  }
  if (name.length > 214) {
    errors.push('name cannot contain more than 214 characters')
  }
  if (name.startsWith('.')) {
    errors.push('name cannot start with a period')
  }
  if (name.startsWith('_')) {
    errors.push('name cannot start with an underscore')
  }
  if (name.trim() !== name) {
    errors.push('name cannot contain leading or trailing spaces')
  }
  if (name.toLowerCase() !== name) {
    errors.push('name cannot contain capital letters')
  }
  if (EXCLUDED_PACKAGE_NAMES.has(name.toLowerCase())) {
    errors.push(`${name} is not a valid package name`)
  }
  if (builtinModules.includes(name.toLowerCase())) {
    errors.push(`${name} is a core module name`)
  }

  const match = name.match(SCOPED_PACKAGE_PATTERN)
  const scope = match?.[1]
  const packageName = match?.[2]
  if (
    !packageName ||
    packageName.startsWith('.') ||
    /[~'!()*]/.test(packageName) ||
    (scope
      ? encodeURIComponent(scope) !== scope ||
        encodeURIComponent(packageName) !== packageName
      : encodeURIComponent(name) !== name)
  ) {
    errors.push('name can only contain URL-friendly characters')
  }
  return [...new Set(errors)]
}

function assertValidNpmPackageName(name: unknown, description: string) {
  const errors = npmPackageNameErrors(name)
  if (errors.length > 0) {
    throw new Error(
      `${description} is not a valid npm package name: ${errors.join('; ')}`,
    )
  }
}

function validatePackageIdentity(
  packageName: unknown,
  targets: Target[],
  description: string,
) {
  assertValidNpmPackageName(packageName, description)
  for (const target of targets) {
    assertValidNpmPackageName(
      `${packageName as string}-${target.platformArchABI}`,
      `${description} flavor for ${target.triple}`,
    )
  }
}

function createManagedWasiFiles(binaryName: string, targets: Target[]) {
  const files = new Set<string>()
  const add = (suffix: string) => files.add(`${binaryName}.${suffix}`)
  const wasiTargets = targets.filter((target) => target.platform === 'wasi')
  const flavors =
    wasiTargets.length > 0
      ? wasiTargets.map((target) => ({
          hasThreads: wasiTargetHasThreads(target),
          platformArchABI: target.platformArchABI,
        }))
      : [{ hasThreads: true, platformArchABI: 'wasm32-wasi' }]

  for (const flavor of flavors) {
    const loaderSuffix = wasiLoaderSuffix(flavor.platformArchABI)
    for (const suffix of [
      `${flavor.platformArchABI}.wasm`,
      `${flavor.platformArchABI}.debug.wasm`,
      `${loaderSuffix}.cjs`,
      `${loaderSuffix}.d.cts`,
      `${loaderSuffix}-browser.js`,
    ]) {
      add(suffix)
    }
    if (!flavor.hasThreads) {
      for (const suffix of [
        `${flavor.platformArchABI}.wasm.d.ts`,
        `${flavor.platformArchABI}.wasm.d.mts`,
        `${flavor.platformArchABI}.workerd.mjs`,
        `${flavor.platformArchABI}.workerd.d.mts`,
        `${loaderSuffix}-deferred.js`,
        `${loaderSuffix}-deferred.d.ts`,
      ]) {
        add(suffix)
      }
    }
  }

  add('wasm')
  add('debug.wasm')
  return files
}

function createManagedWasiRenames(
  oldName: string,
  newName: string,
  targets: Target[],
) {
  const renames = new Map<string, string>()
  for (const oldFile of createManagedWasiFiles(oldName, targets)) {
    renames.set(oldFile, `${newName}${oldFile.slice(oldName.length)}`)
  }
  return renames
}

function createManagedPackageRenames(
  oldPackageName: string,
  newPackageName: string,
  targets: Target[],
) {
  return new Map(
    targets.map((target) => [
      `${oldPackageName}-${target.platformArchABI}`,
      `${newPackageName}-${target.platformArchABI}`,
    ]),
  )
}

function replaceManifestReference(
  value: string,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  const directFile = fileRenames.get(value)
  if (directFile) {
    return directFile
  }
  if (value.startsWith('./')) {
    const relativeFile = fileRenames.get(value.slice(2))
    if (relativeFile) {
      return `./${relativeFile}`
    }
  }
  for (const [oldPackageName, newPackageName] of packageRenames) {
    if (value === oldPackageName) {
      return newPackageName
    }
    if (value.startsWith(`${oldPackageName}/`)) {
      return `${newPackageName}${value.slice(oldPackageName.length)}`
    }
  }
  return value
}

function rewriteManifestReferences(
  value: unknown,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
): unknown {
  if (typeof value === 'string') {
    return replaceManifestReference(value, fileRenames, packageRenames)
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteManifestReferences(entry, fileRenames, packageRenames),
    )
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }

  const updated: JsonRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    const updatedKey = replaceManifestReference(
      key,
      fileRenames,
      packageRenames,
    )
    if (Object.prototype.hasOwnProperty.call(updated, updatedKey)) {
      throw new Error(
        `Renaming managed manifest reference ${key} conflicts with existing key ${updatedKey}`,
      )
    }
    updated[updatedKey] = rewriteManifestReferences(
      entry,
      fileRenames,
      packageRenames,
    )
  }
  return updated
}

function replaceManagedTextReferences(
  content: string,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  const references = new Map<
    string,
    { replacement: string; packageName: boolean }
  >()
  for (const [name, replacement] of fileRenames) {
    references.set(name, { replacement, packageName: false })
  }
  for (const [name, replacement] of packageRenames) {
    references.set(name, { replacement, packageName: true })
  }
  if (references.size === 0) {
    return content
  }

  const pattern = new RegExp(
    [...references.keys()]
      .sort((left, right) => right.length - left.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'g',
  )
  return content.replace(pattern, (name: string, offset: number) => {
    const reference = references.get(name)!
    const previous = content[offset - 1]
    const next = content[offset + name.length]
    if (reference.packageName) {
      if (previous && /[A-Za-z0-9._~@/-]/.test(previous)) {
        return name
      }
      if (next && next !== '/' && /[A-Za-z0-9._~-]/.test(next)) {
        return name
      }
    } else {
      if (previous && /[A-Za-z0-9._-]/.test(previous)) {
        return name
      }
      if (next && /[A-Za-z0-9._-]/.test(next)) {
        return name
      }
    }
    return reference.replacement
  })
}

function resolveManagedPath(
  directory: string,
  entry: string,
  description: string,
) {
  if (!entry || isAbsolute(entry)) {
    throw new Error(
      `${description} must be a non-empty relative path: ${entry}`,
    )
  }
  const root = resolve(directory)
  const path = resolve(root, entry)
  const relativePath = relative(root, path)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${description} escapes ${root}: ${entry}`)
  }
  return path
}

function collectManagedFileRenames(
  directory: string,
  renames: Map<string, string>,
) {
  const operations: ManagedFileRename[] = []
  for (const [oldFile, newFile] of renames) {
    const source = resolveManagedPath(
      directory,
      oldFile,
      'Managed rename source',
    )
    const destination = resolveManagedPath(
      directory,
      newFile,
      'Managed rename destination',
    )
    if (source !== destination && pathExists(source)) {
      operations.push({ source, destination })
    }
  }
  return operations
}

function preflightManagedFileRenames(operations: ManagedFileRename[]) {
  const operationsBySource = new Map<string, ManagedFileRename>()
  const sources = new Set<string>()
  const destinations = new Map<string, string>()

  for (const operation of operations) {
    const existingSource = operationsBySource.get(operation.source)
    if (existingSource) {
      if (existingSource.destination !== operation.destination) {
        throw new Error(
          `Managed rename source ${operation.source} has conflicting destinations ${existingSource.destination} and ${operation.destination}`,
        )
      }
      continue
    }
    operationsBySource.set(operation.source, operation)
    sources.add(operation.source)

    const existingDestination = destinations.get(operation.destination)
    if (existingDestination) {
      throw new Error(
        `Managed rename destination ${operation.destination} is targeted by both ${existingDestination} and ${operation.source}`,
      )
    }
    destinations.set(operation.destination, operation.source)
  }

  for (const operation of operationsBySource.values()) {
    if (
      pathExists(operation.destination) &&
      !sources.has(operation.destination)
    ) {
      throw new Error(
        `Cannot rename managed file ${operation.source}: destination already exists: ${operation.destination}`,
      )
    }
  }
  return [...operationsBySource.values()]
}

function stageManagedFileRenames(operations: ManagedFileRename[]) {
  const reservedPaths = new Set(
    operations.flatMap(({ source, destination }) => [source, destination]),
  )
  let sequence = 0
  return operations.map((operation) => {
    let temporary: string
    do {
      temporary = resolveManagedPath(
        dirname(operation.source),
        `.napi-rename.${process.pid}.${sequence++}.tmp`,
        'Managed rename temporary path',
      )
    } while (reservedPaths.has(temporary) || pathExists(temporary))
    reservedPaths.add(temporary)
    return { ...operation, temporary }
  })
}

async function executeManagedFileRenames(operations: ManagedFileRename[]) {
  if (operations.length === 0) {
    return
  }

  const stagedOperations = stageManagedFileRenames(operations)
  const staged: StagedManagedFileRename[] = []
  const committed: StagedManagedFileRename[] = []
  try {
    for (const operation of stagedOperations) {
      if (pathExists(operation.temporary)) {
        throw new Error(
          `Managed rename temporary path was occupied during execution: ${operation.temporary}`,
        )
      }
      await rename(operation.source, operation.temporary)
      staged.push(operation)
    }
    for (const operation of stagedOperations) {
      if (pathExists(operation.destination)) {
        throw new Error(
          `Managed rename destination was occupied during execution: ${operation.destination}`,
        )
      }
      await rename(operation.temporary, operation.destination)
      committed.push(operation)
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const operation of [...committed].reverse()) {
      try {
        if (pathExists(operation.destination)) {
          await rename(operation.destination, operation.temporary)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    for (const operation of [...staged].reverse()) {
      try {
        if (pathExists(operation.temporary)) {
          await rename(operation.temporary, operation.source)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Managed file rename failed and could not be fully rolled back',
      )
    }
    throw error
  }
}

async function rewriteManagedTextFile(
  path: string,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  if (!pathExists(path) || path.endsWith('.wasm')) {
    return
  }
  const content = await readFileAsync(path, 'utf8')
  const updated = replaceManagedTextReferences(
    content,
    fileRenames,
    packageRenames,
  )
  if (updated !== content) {
    await writeFileAtomic(path, updated)
  }
}

function managedPackageReadme(packageName: string, target: Target) {
  return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`
}

async function rewriteManagedPackageReadme(
  directory: string,
  oldPackageName: string,
  newPackageName: string,
  target: Target,
) {
  const path = resolveManagedPath(
    directory,
    'README.md',
    'Managed package README',
  )
  if (!pathExists(path)) {
    return
  }
  const content = await readFileAsync(path, 'utf8')
  if (content === managedPackageReadme(oldPackageName, target)) {
    await writeFileAtomic(path, managedPackageReadme(newPackageName, target))
  }
}

function managedRootEntries(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0]
  if (!firstLine.startsWith(WASI_ARTIFACT_METADATA_PREFIX)) {
    return []
  }
  try {
    const metadata = JSON.parse(
      firstLine.slice(WASI_ARTIFACT_METADATA_PREFIX.length),
    ) as {
      rootEntry?: unknown
      managedRootEntries?: unknown
    }
    return [
      ...(typeof metadata.rootEntry === 'string' ? [metadata.rootEntry] : []),
      ...(Array.isArray(metadata.managedRootEntries)
        ? metadata.managedRootEntries.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : []),
    ]
  } catch {
    return []
  }
}

function resolveProjectEntry(cwd: string, entry: string) {
  const path = resolve(cwd, entry)
  const relativePath = relative(cwd, path)
  if (
    relativePath === '' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === '..' ||
    isAbsolute(relativePath)
  ) {
    return
  }
  return path
}

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function updateNapiConfigRecord(record: JsonRecord, options: RenameOptions) {
  if (options.binaryName !== undefined) {
    record.binaryName = options.binaryName
    delete record.name
  }
  if (options.packageName !== undefined) {
    record.packageName = options.packageName
  }
}

function serializeJsonLike(content: string, value: unknown) {
  return `${JSON.stringify(value, null, 2)}${content.endsWith('\n') ? '\n' : ''}`
}

function addPreparedWrite(
  writes: Map<string, string>,
  path: string,
  content: string,
) {
  const existing = writes.get(path)
  if (existing !== undefined && existing !== content) {
    throw new Error(`Rename prepared conflicting updates for ${path}`)
  }
  writes.set(path, content)
}

function sanitizeCargoPackageName(binaryName: string) {
  return binaryName.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase()
}

export async function renameProject(userOptions: RenameOptions) {
  const options = applyDefaultRenameOptions(userOptions)
  const napiConfig = await readConfig(options)
  const oldName = napiConfig.binaryName
  const oldPackageName = napiConfig.packageName

  assertSafeBinaryName(oldName, 'Configured binary name')
  validatePackageIdentity(
    oldPackageName,
    napiConfig.targets,
    'Configured package name',
  )
  if (options.binaryName !== undefined) {
    assertSafeBinaryName(options.binaryName, 'Requested binary name')
  }
  if (options.name !== undefined) {
    assertValidNpmPackageName(options.name, 'Requested root package name')
  }
  if (options.packageName !== undefined) {
    validatePackageIdentity(
      options.packageName,
      napiConfig.targets,
      'Requested package name',
    )
  }

  const newName = options.binaryName ?? oldName
  const newPackageName = options.packageName ?? oldPackageName
  const binaryNameChanged =
    options.binaryName !== undefined && oldName !== options.binaryName
  const packageNameChanged =
    options.packageName !== undefined && oldPackageName !== options.packageName
  const managedWasiRenames = binaryNameChanged
    ? createManagedWasiRenames(oldName, newName, napiConfig.targets)
    : new Map<string, string>()
  const managedPackageRenames = packageNameChanged
    ? createManagedPackageRenames(
        oldPackageName,
        newPackageName,
        napiConfig.targets,
      )
    : new Map<string, string>()
  const hasManagedReferenceRenames =
    managedWasiRenames.size > 0 || managedPackageRenames.size > 0

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)
  const packageJsonContent = await readFileAsync(packageJsonPath, 'utf8')
  const parsedPackageJson = JSON.parse(packageJsonContent)
  const packageJsonData = asJsonRecord(parsedPackageJson)
  if (!packageJsonData) {
    throw new Error(
      `package.json must contain a JSON object: ${packageJsonPath}`,
    )
  }

  const managedRootEntryNames = new Set<string>()
  if (hasManagedReferenceRenames) {
    for (const field of ['main', 'module', 'browser', 'types'] as const) {
      const entry = packageJsonData[field]
      if (typeof entry === 'string') {
        managedRootEntryNames.add(entry)
      }
    }
    for (const oldFile of createManagedWasiFiles(oldName, napiConfig.targets)) {
      if (!oldFile.endsWith('.cjs')) {
        continue
      }
      const loaderPath = resolveManagedPath(
        options.cwd,
        oldFile,
        'Managed WASI loader',
      )
      if (pathExists(loaderPath)) {
        for (const entry of managedRootEntries(
          await readFileAsync(loaderPath, 'utf8'),
        )) {
          managedRootEntryNames.add(entry)
        }
      }
    }
  }

  merge(
    packageJsonData,
    omitBy(
      // @ts-expect-error missing fields: author and license
      pick(options, ['name', 'description', 'author', 'license']),
      isNil,
    ),
  )
  if (options.binaryName !== undefined || options.packageName !== undefined) {
    const napi = asJsonRecord(packageJsonData.napi) ?? {}
    updateNapiConfigRecord(napi, options)
    packageJsonData.napi = napi
  }
  if (options.repository) {
    const repository = asJsonRecord(packageJsonData.repository)
    if (repository) {
      repository.url = options.repository
    } else {
      packageJsonData.repository = options.repository
    }
  }

  const updatedPackageJson = rewriteManifestReferences(
    packageJsonData,
    managedWasiRenames,
    managedPackageRenames,
  )
  const preparedWrites = new Map<string, string>()
  addPreparedWrite(
    preparedWrites,
    packageJsonPath,
    serializeJsonLike(packageJsonContent, updatedPackageJson),
  )

  if (options.configPath) {
    const configPath = resolve(options.cwd, options.configPath)
    const configContent = await readFileAsync(configPath, 'utf8')
    const configData = asJsonRecord(JSON.parse(configContent))
    if (!configData) {
      throw new Error(`NAPI config must contain a JSON object: ${configPath}`)
    }
    updateNapiConfigRecord(configData, options)
    addPreparedWrite(
      preparedWrites,
      configPath,
      serializeJsonLike(configContent, configData),
    )
  }

  if (binaryNameChanged) {
    const cargoTomlPath = resolve(options.cwd, options.manifestPath)
    const tomlContent = await readFileAsync(cargoTomlPath, 'utf8')
    const cargoToml = parseToml(tomlContent) as any
    if (cargoToml.package) {
      cargoToml.package.name = sanitizeCargoPackageName(newName)
      addPreparedWrite(preparedWrites, cargoTomlPath, stringifyToml(cargoToml))
    }

    const githubActionsPath = find.dir('.github', {
      cwd: options.cwd,
    })
    if (githubActionsPath) {
      const githubActionsCIYmlPath = join(
        githubActionsPath,
        'workflows',
        'CI.yml',
      )
      if (existsSync(githubActionsCIYmlPath)) {
        const githubActionsContent = await readFileAsync(
          githubActionsCIYmlPath,
          'utf8',
        )
        const githubActionsData = yamlParse(githubActionsContent) as any
        if (githubActionsData.env?.APP_NAME) {
          githubActionsData.env.APP_NAME = newName
          addPreparedWrite(
            preparedWrites,
            githubActionsCIYmlPath,
            yamlStringify(githubActionsData, {
              lineWidth: -1,
              noRefs: true,
              sortKeys: false,
            }),
          )
        }
      }
    }
  }

  const targetDirectories = napiConfig.targets.map((target) => ({
    target,
    directory: resolve(options.cwd, options.npmDir, target.platformArchABI),
  }))
  const managedFileRenames = collectManagedFileRenames(
    options.cwd,
    managedWasiRenames,
  )
  for (const { target, directory } of targetDirectories) {
    if (!pathExists(directory)) {
      continue
    }
    if (target.platform === 'wasi') {
      managedFileRenames.push(
        ...collectManagedFileRenames(directory, managedWasiRenames),
      )
    }
    if (hasManagedReferenceRenames) {
      const targetPackageJsonPath = resolveManagedPath(
        directory,
        'package.json',
        'Managed package manifest',
      )
      if (pathExists(targetPackageJsonPath)) {
        const content = await readFileAsync(targetPackageJsonPath, 'utf8')
        const manifest = JSON.parse(content)
        const updatedManifest = rewriteManifestReferences(
          manifest,
          managedWasiRenames,
          managedPackageRenames,
        )
        const updatedContent = serializeJsonLike(content, updatedManifest)
        if (updatedContent !== content) {
          addPreparedWrite(
            preparedWrites,
            targetPackageJsonPath,
            updatedContent,
          )
        }
      }
    }
  }

  const plannedFileRenames = preflightManagedFileRenames(managedFileRenames)
  await executeManagedFileRenames(plannedFileRenames)
  for (const [path, content] of preparedWrites) {
    await writeFileAtomic(path, content)
  }

  if (!hasManagedReferenceRenames) {
    return
  }

  for (const file of createManagedWasiFiles(newName, napiConfig.targets)) {
    await rewriteManagedTextFile(
      resolveManagedPath(options.cwd, file, 'Managed WASI file'),
      managedWasiRenames,
      managedPackageRenames,
    )
  }

  for (const { target, directory } of targetDirectories) {
    if (!pathExists(directory)) {
      continue
    }
    if (target.platform === 'wasi') {
      for (const file of createManagedWasiFiles(newName, [target])) {
        await rewriteManagedTextFile(
          resolveManagedPath(directory, file, 'Managed package WASI file'),
          managedWasiRenames,
          managedPackageRenames,
        )
      }
    }
    if (managedPackageRenames.size > 0) {
      await rewriteManagedPackageReadme(
        directory,
        oldPackageName,
        newPackageName,
        target,
      )
    }
  }

  for (const entry of managedRootEntryNames) {
    const updatedEntry = replaceManifestReference(
      entry,
      managedWasiRenames,
      new Map(),
    )
    const path = resolveProjectEntry(options.cwd, updatedEntry)
    if (path) {
      await rewriteManagedTextFile(
        path,
        managedWasiRenames,
        managedPackageRenames,
      )
    }
  }

  if (managedWasiRenames.size > 0) {
    await rewriteManagedTextFile(
      resolveManagedPath(
        options.cwd,
        '.gitattributes',
        'Managed .gitattributes file',
      ),
      managedWasiRenames,
      new Map(),
    )
  }
}
