import { lstatSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

import { parse as parseToml, stringify as stringifyToml } from '@std/toml'
import { load as yamlParse, dump as yamlStringify } from 'js-yaml'
import { isNil, omitBy, pick } from 'es-toolkit'

import { applyDefaultRenameOptions, type RenameOptions } from '../def/rename.js'
import {
  commitFileSystemTransaction,
  getPackageReconciliationRoot,
  readConfig,
  readFileAsync,
  type Target,
  wasiLoaderSuffix,
  wasiTargetHasThreads,
  withFileSystemReconciliation,
} from '../utils/index.js'

const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'
const SCOPED_PACKAGE_PATTERN = /^(?:@([^/]+?)\/)?([^/]+?)$/
const EXCLUDED_PACKAGE_NAMES = new Set(['node_modules', 'favicon.ico'])
const WINDOWS_RESERVED_FILENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const PACKAGE_REFERENCE_FIELDS = new Set([
  'browser',
  'exports',
  'files',
  'imports',
  'main',
  'man',
  'module',
  'types',
  'typesVersions',
  'typings',
])
const DEPENDENCY_FIELDS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
])
const RECURSIVE_PACKAGE_KEY_FIELDS = new Set(['overrides', 'resolutions'])

type JsonRecord = Record<string, unknown>
type RenameCommitPhase =
  | 'managed-rename'
  | 'package-manifest'
  | 'config'
  | 'cargo'
  | 'workflow'
  | 'flavor-manifest'
  | 'managed-text'
  | 'readme'

interface RenameTestOptions extends RenameOptions {
  __testFailCommitPhase?: RenameCommitPhase
}

interface ManagedFileRename {
  source: string
  destination: string
}

interface PreparedWrite {
  content: Buffer
  destination: string
  phase: RenameCommitPhase
}

class RenameTransactionPlan {
  readonly removals = new Set<string>()
  readonly writes = new Map<string, PreparedWrite>()

  addWrite(
    destination: string,
    content: Buffer | string,
    phase: RenameCommitPhase,
  ) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const existing = this.writes.get(destination)
    if (existing) {
      if (!existing.content.equals(buffer)) {
        throw new Error(
          `Rename prepared conflicting updates for ${destination}`,
        )
      }
      return
    }
    this.writes.set(destination, {
      content: buffer,
      destination,
      phase,
    })
  }

  hasWrite(destination: string) {
    return this.writes.has(destination)
  }
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

function assertRegularFile(path: string, description: string) {
  const stats = lstatSync(path)
  if (!stats.isFile()) {
    throw new Error(`${description} must be a regular file: ${path}`)
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

function npmPackageNameIssues(name: unknown) {
  if (typeof name !== 'string') {
    return { errors: ['name must be a string'], warnings: [] }
  }

  const errors: string[] = []
  const warnings: string[] = []
  if (name.length === 0) {
    errors.push('name length must be greater than zero')
  }
  if (name.length > 214) {
    warnings.push('name can no longer contain more than 214 characters')
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
    warnings.push('name can no longer contain capital letters')
  }
  if (EXCLUDED_PACKAGE_NAMES.has(name.toLowerCase())) {
    errors.push(`${name} is not a valid package name`)
  }
  if (builtinModules.includes(name.toLowerCase())) {
    warnings.push(`${name} is a core module name`)
  }

  const match = name.match(SCOPED_PACKAGE_PATTERN)
  const scope = match?.[1]
  const packageName = match?.[2]
  if (packageName && /[~'!()*]/.test(packageName)) {
    warnings.push('name can no longer contain special characters ("~\'!()*")')
  }
  if (
    !packageName ||
    packageName.startsWith('.') ||
    (scope
      ? encodeURIComponent(scope) !== scope ||
        encodeURIComponent(packageName) !== packageName
      : encodeURIComponent(name) !== name)
  ) {
    errors.push('name can only contain URL-friendly characters')
  }
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  }
}

function assertValidNpmPackageName(
  name: unknown,
  description: string,
  strict: boolean,
): asserts name is string {
  const { errors, warnings } = npmPackageNameIssues(name)
  const issues = strict ? [...errors, ...warnings] : errors
  if (issues.length > 0) {
    throw new Error(
      `${description} is not a valid npm package name: ${issues.join('; ')}`,
    )
  }
}

function validatePackageIdentity(
  packageName: unknown,
  targets: Target[],
  description: string,
  strict: boolean,
) {
  assertValidNpmPackageName(packageName, description, strict)
  for (const target of targets) {
    assertValidNpmPackageName(
      `${packageName}-${target.platformArchABI}`,
      `${description} flavor for ${target.triple}`,
      strict,
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

function defineJsonProperty(target: JsonRecord, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function createJsonRecord() {
  return Object.create(null) as JsonRecord
}

function rewriteReferenceTree(
  value: unknown,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
  rewriteKeys = true,
): unknown {
  if (typeof value === 'string') {
    return replaceManifestReference(value, fileRenames, packageRenames)
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteReferenceTree(entry, fileRenames, packageRenames, rewriteKeys),
    )
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }

  const updated = createJsonRecord()
  for (const [key, entry] of Object.entries(value)) {
    const updatedKey = rewriteKeys
      ? replaceManifestReference(key, fileRenames, packageRenames)
      : key
    if (Object.prototype.hasOwnProperty.call(updated, updatedKey)) {
      throw new Error(
        `Renaming managed manifest reference ${key} conflicts with existing key ${updatedKey}`,
      )
    }
    defineJsonProperty(
      updated,
      updatedKey,
      rewriteReferenceTree(entry, fileRenames, packageRenames, rewriteKeys),
    )
  }
  return updated
}

function rewritePackageMapKeys(
  value: unknown,
  packageRenames: Map<string, string>,
  recursive: boolean,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === 'string'
        ? replaceManifestReference(entry, new Map(), packageRenames)
        : entry,
    )
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }

  const updated = createJsonRecord()
  for (const [key, entry] of Object.entries(value)) {
    const updatedKey = replaceManifestReference(key, new Map(), packageRenames)
    if (Object.prototype.hasOwnProperty.call(updated, updatedKey)) {
      throw new Error(
        `Renaming package reference ${key} conflicts with existing key ${updatedKey}`,
      )
    }
    defineJsonProperty(
      updated,
      updatedKey,
      recursive ? rewritePackageMapKeys(entry, packageRenames, true) : entry,
    )
  }
  return updated
}

function replaceScriptArgument(
  argument: string,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  const direct = replaceManifestReference(argument, fileRenames, packageRenames)
  if (direct !== argument) {
    return direct
  }

  const assignment = argument.match(
    /^([A-Za-z_][A-Za-z0-9_]*|--?[A-Za-z0-9][A-Za-z0-9-]*)=(.+)$/,
  )
  if (!assignment) {
    return argument
  }
  const replacement = replaceManifestReference(
    assignment[2],
    fileRenames,
    packageRenames,
  )
  return replacement === assignment[2]
    ? argument
    : `${assignment[1]}=${replacement}`
}

function rewriteScriptCommand(
  command: string,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  let index = 0
  let updated = ''
  while (index < command.length) {
    const character = command[index]
    if (/\s|[|&;()<>]/.test(character)) {
      updated += character
      index += 1
      continue
    }

    if (character === '"' || character === "'") {
      const quote = character
      let end = index + 1
      while (end < command.length) {
        if (command[end] === quote) {
          break
        }
        if (
          quote === '"' &&
          command[end] === '\\' &&
          end + 1 < command.length
        ) {
          end += 2
        } else {
          end += 1
        }
      }
      if (end >= command.length) {
        updated += command.slice(index)
        break
      }
      const argument = command.slice(index + 1, end)
      updated += `${quote}${replaceScriptArgument(
        argument,
        fileRenames,
        packageRenames,
      )}${quote}`
      index = end + 1
      continue
    }

    let end = index + 1
    while (end < command.length && !/\s|[|&;()<>"']/.test(command[end])) {
      end += 1
    }
    updated += replaceScriptArgument(
      command.slice(index, end),
      fileRenames,
      packageRenames,
    )
    index = end
  }
  return updated
}

function rewriteScripts(
  value: unknown,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const updated = createJsonRecord()
  for (const [key, entry] of Object.entries(value)) {
    defineJsonProperty(
      updated,
      key,
      typeof entry === 'string'
        ? rewriteScriptCommand(entry, fileRenames, packageRenames)
        : entry,
    )
  }
  return updated
}

function rewritePublishConfig(
  value: unknown,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const updated = createJsonRecord()
  for (const [key, entry] of Object.entries(value)) {
    defineJsonProperty(
      updated,
      key,
      PACKAGE_REFERENCE_FIELDS.has(key)
        ? rewriteReferenceTree(entry, fileRenames, packageRenames)
        : entry,
    )
  }
  return updated
}

function rewritePackageManifest(
  manifest: JsonRecord,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  const updated = createJsonRecord()
  for (const [key, entry] of Object.entries(manifest)) {
    let rewritten = entry
    if (key === 'name' && typeof entry === 'string') {
      rewritten = replaceManifestReference(entry, new Map(), packageRenames)
    } else if (PACKAGE_REFERENCE_FIELDS.has(key)) {
      rewritten = rewriteReferenceTree(entry, fileRenames, packageRenames)
    } else if (key === 'bin') {
      rewritten = rewriteReferenceTree(
        entry,
        fileRenames,
        packageRenames,
        false,
      )
    } else if (DEPENDENCY_FIELDS.has(key)) {
      rewritten = rewritePackageMapKeys(entry, packageRenames, false)
    } else if (key === 'bundledDependencies' || key === 'bundleDependencies') {
      rewritten = rewritePackageMapKeys(entry, packageRenames, false)
    } else if (RECURSIVE_PACKAGE_KEY_FIELDS.has(key)) {
      rewritten = rewritePackageMapKeys(entry, packageRenames, true)
    } else if (key === 'scripts') {
      rewritten = rewriteScripts(entry, fileRenames, packageRenames)
    } else if (key === 'publishConfig') {
      rewritten = rewritePublishConfig(entry, fileRenames, packageRenames)
    }
    defineJsonProperty(updated, key, rewritten)
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

function isPathWithin(root: string, path: string, allowRoot: boolean) {
  const relativePath = relative(root, path)
  return (
    (allowRoot && relativePath === '') ||
    (relativePath !== '' &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  )
}

function assertPathWithin(
  root: string,
  path: string,
  description: string,
  allowRoot = false,
) {
  if (!isPathWithin(root, path, allowRoot)) {
    throw new Error(`${description} escapes project root ${root}: ${path}`)
  }
}

async function canonicalizePath(path: string) {
  let current = resolve(path)
  const missingSegments: string[] = []
  while (true) {
    try {
      return join(await realpath(current), ...missingSegments)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      const parent = dirname(current)
      if (parent === current) {
        return join(current, ...missingSegments)
      }
      missingSegments.unshift(basename(current))
      current = parent
    }
  }
}

async function resolveCanonicalRoot(
  projectRoot: string,
  path: string,
  description: string,
) {
  const lexicalPath = resolve(path)
  assertPathWithin(projectRoot, lexicalPath, description, true)
  const canonicalPath = await canonicalizePath(lexicalPath)
  assertPathWithin(projectRoot, canonicalPath, description, true)
  return canonicalPath
}

async function resolveCanonicalFile(
  projectRoot: string,
  path: string,
  description: string,
) {
  const lexicalPath = resolve(path)
  assertPathWithin(projectRoot, lexicalPath, description)
  const canonicalParent = await canonicalizePath(dirname(lexicalPath))
  assertPathWithin(projectRoot, canonicalParent, `${description} parent`, true)
  const canonicalPath = join(canonicalParent, basename(lexicalPath))
  assertPathWithin(projectRoot, canonicalPath, description)
  if (pathExists(canonicalPath)) {
    assertRegularFile(canonicalPath, description)
  }
  return canonicalPath
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
  assertPathWithin(root, path, description)
  return path
}

async function resolveProjectEntry(
  projectRoot: string,
  entry: string,
  description: string,
) {
  const path = resolve(projectRoot, entry)
  if (!isPathWithin(projectRoot, path, false)) {
    return
  }
  return resolveCanonicalFile(projectRoot, path, description)
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
      assertRegularFile(source, 'Managed rename source')
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

async function prepareManagedFileRenames(
  plan: RenameTransactionPlan,
  operations: ManagedFileRename[],
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  const destinations = new Set(
    operations.map((operation) => operation.destination),
  )
  for (const operation of operations) {
    const content = await readFileAsync(operation.source)
    plan.addWrite(
      operation.destination,
      operation.source.endsWith('.wasm')
        ? content
        : replaceManagedTextReferences(
            content.toString('utf8'),
            fileRenames,
            packageRenames,
          ),
      'managed-rename',
    )
    if (!destinations.has(operation.source)) {
      plan.removals.add(operation.source)
    }
  }
}

async function prepareManagedTextWrite(
  plan: RenameTransactionPlan,
  path: string,
  fileRenames: Map<string, string>,
  packageRenames: Map<string, string>,
) {
  if (plan.hasWrite(path) || !pathExists(path) || path.endsWith('.wasm')) {
    return
  }
  assertRegularFile(path, 'Managed text file')
  const content = await readFileAsync(path, 'utf8')
  const updated = replaceManagedTextReferences(
    content,
    fileRenames,
    packageRenames,
  )
  if (updated !== content) {
    plan.addWrite(path, updated, 'managed-text')
  }
}

function managedPackageReadme(packageName: string, target: Target) {
  return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`
}

async function prepareManagedPackageReadme(
  plan: RenameTransactionPlan,
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
  assertRegularFile(path, 'Managed package README')
  const content = await readFileAsync(path, 'utf8')
  if (content === managedPackageReadme(oldPackageName, target)) {
    plan.addWrite(path, managedPackageReadme(newPackageName, target), 'readme')
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

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function updateNapiConfigRecord(record: JsonRecord, options: RenameOptions) {
  if (options.binaryName !== undefined) {
    defineJsonProperty(record, 'binaryName', options.binaryName)
    delete record.name
  }
  if (options.packageName !== undefined) {
    defineJsonProperty(record, 'packageName', options.packageName)
  }
}

function serializeJsonLike(content: string, value: unknown) {
  return `${JSON.stringify(value, null, 2)}${content.endsWith('\n') ? '\n' : ''}`
}

function sanitizeCargoPackageName(binaryName: string) {
  return binaryName.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase()
}

async function executeRenameTransaction(
  projectRoot: string,
  plan: RenameTransactionPlan,
  failPhase?: RenameCommitPhase,
) {
  if (plan.writes.size === 0 && plan.removals.size === 0) {
    return
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), 'napi-rename-stage-'))
  try {
    const writes = []
    let sequence = 0
    for (const prepared of plan.writes.values()) {
      const source = join(stagingRoot, String(sequence++))
      await writeFile(source, prepared.content)
      writes.push({
        destination: prepared.destination,
        phase: prepared.phase,
        source,
      })
    }

    if (failPhase) {
      const injected = writes.find((write) => write.phase === failPhase)
      if (!injected) {
        throw new Error(
          `Cannot inject rename transaction failure: phase ${failPhase} was not planned`,
        )
      }
      injected.source = join(stagingRoot, `missing-${failPhase}`)
    }

    await commitFileSystemTransaction(
      projectRoot,
      writes.map(({ destination, source }) => ({ destination, source })),
      [...plan.removals],
    )
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}

async function renameProjectUnlocked(
  userOptions: RenameOptions,
  failPhase?: RenameCommitPhase,
) {
  const options = applyDefaultRenameOptions(userOptions)
  const projectRoot = await realpath(resolve(options.cwd))
  const packageJsonPath = await resolveCanonicalFile(
    projectRoot,
    resolve(projectRoot, options.packageJsonPath),
    'package.json',
  )
  const configPath = options.configPath
    ? await resolveCanonicalFile(
        projectRoot,
        resolve(projectRoot, options.configPath),
        'NAPI config',
      )
    : undefined
  const npmRoot = await resolveCanonicalRoot(
    projectRoot,
    resolve(projectRoot, options.npmDir),
    'npm package root',
  )
  const normalizedOptions = {
    ...options,
    cwd: projectRoot,
    packageJsonPath,
    configPath,
    npmDir: npmRoot,
  }

  const napiConfig = await readConfig(normalizedOptions)
  const oldName = napiConfig.binaryName
  const oldPackageName = napiConfig.packageName

  assertSafeBinaryName(oldName, 'Configured binary name')
  validatePackageIdentity(
    oldPackageName,
    napiConfig.targets,
    'Configured package name',
    false,
  )
  if (options.binaryName !== undefined) {
    assertSafeBinaryName(options.binaryName, 'Requested binary name')
  }
  if (options.name !== undefined) {
    assertValidNpmPackageName(options.name, 'Requested root package name', true)
  }
  if (options.packageName !== undefined) {
    validatePackageIdentity(
      options.packageName,
      napiConfig.targets,
      'Requested package name',
      true,
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

  assertRegularFile(packageJsonPath, 'package.json')
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
        projectRoot,
        oldFile,
        'Managed WASI loader',
      )
      if (pathExists(loaderPath)) {
        assertRegularFile(loaderPath, 'Managed WASI loader')
        for (const entry of managedRootEntries(
          await readFileAsync(loaderPath, 'utf8'),
        )) {
          managedRootEntryNames.add(entry)
        }
      }
    }
  }

  for (const [key, value] of Object.entries(
    omitBy(
      // @ts-expect-error missing fields: author and license
      pick(options, ['name', 'description', 'author', 'license']),
      isNil,
    ),
  )) {
    defineJsonProperty(packageJsonData, key, value)
  }
  if (options.binaryName !== undefined || options.packageName !== undefined) {
    const napi = asJsonRecord(packageJsonData.napi) ?? createJsonRecord()
    updateNapiConfigRecord(napi, options)
    defineJsonProperty(packageJsonData, 'napi', napi)
  }
  if (options.repository) {
    const repository = asJsonRecord(packageJsonData.repository)
    if (repository) {
      defineJsonProperty(repository, 'url', options.repository)
    } else {
      defineJsonProperty(packageJsonData, 'repository', options.repository)
    }
  }

  const plan = new RenameTransactionPlan()
  plan.addWrite(
    packageJsonPath,
    serializeJsonLike(
      packageJsonContent,
      rewritePackageManifest(
        packageJsonData,
        managedWasiRenames,
        managedPackageRenames,
      ),
    ),
    'package-manifest',
  )

  if (configPath) {
    assertRegularFile(configPath, 'NAPI config')
    const configContent = await readFileAsync(configPath, 'utf8')
    const configData = asJsonRecord(JSON.parse(configContent))
    if (!configData) {
      throw new Error(`NAPI config must contain a JSON object: ${configPath}`)
    }
    updateNapiConfigRecord(configData, options)
    plan.addWrite(
      configPath,
      serializeJsonLike(configContent, configData),
      'config',
    )
  }

  if (binaryNameChanged) {
    const cargoTomlPath = await resolveCanonicalFile(
      projectRoot,
      resolve(projectRoot, options.manifestPath),
      'Cargo manifest',
    )
    assertRegularFile(cargoTomlPath, 'Cargo manifest')
    const tomlContent = await readFileAsync(cargoTomlPath, 'utf8')
    const cargoToml = parseToml(tomlContent) as any
    if (cargoToml.package) {
      cargoToml.package.name = sanitizeCargoPackageName(newName)
      plan.addWrite(cargoTomlPath, stringifyToml(cargoToml), 'cargo')
    }

    const workflowPath = join(projectRoot, '.github', 'workflows', 'CI.yml')
    if (pathExists(workflowPath)) {
      const canonicalWorkflowPath = await resolveCanonicalFile(
        projectRoot,
        workflowPath,
        'GitHub Actions workflow',
      )
      const workflowContent = await readFileAsync(canonicalWorkflowPath, 'utf8')
      const workflowData = yamlParse(workflowContent) as any
      if (workflowData.env?.APP_NAME) {
        workflowData.env.APP_NAME = newName
        plan.addWrite(
          canonicalWorkflowPath,
          yamlStringify(workflowData, {
            lineWidth: -1,
            noRefs: true,
            sortKeys: false,
          }),
          'workflow',
        )
      }
    }
  }

  const targetDirectories: Array<{ directory: string; target: Target }> = []
  for (const target of napiConfig.targets) {
    const directory = await resolveCanonicalRoot(
      projectRoot,
      resolve(npmRoot, target.platformArchABI),
      `npm package directory for ${target.triple}`,
    )
    targetDirectories.push({ directory, target })
  }

  const managedFileRenames = collectManagedFileRenames(
    projectRoot,
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
        assertRegularFile(targetPackageJsonPath, 'Managed package manifest')
        const content = await readFileAsync(targetPackageJsonPath, 'utf8')
        const manifest = asJsonRecord(JSON.parse(content))
        if (!manifest) {
          throw new Error(
            `Managed package manifest must contain a JSON object: ${targetPackageJsonPath}`,
          )
        }
        const updatedContent = serializeJsonLike(
          content,
          rewritePackageManifest(
            manifest,
            managedWasiRenames,
            managedPackageRenames,
          ),
        )
        if (updatedContent !== content) {
          plan.addWrite(
            targetPackageJsonPath,
            updatedContent,
            'flavor-manifest',
          )
        }
      }
    }
  }

  const plannedFileRenames = preflightManagedFileRenames(managedFileRenames)
  await prepareManagedFileRenames(
    plan,
    plannedFileRenames,
    managedWasiRenames,
    managedPackageRenames,
  )

  if (hasManagedReferenceRenames) {
    for (const file of createManagedWasiFiles(newName, napiConfig.targets)) {
      await prepareManagedTextWrite(
        plan,
        resolveManagedPath(projectRoot, file, 'Managed WASI file'),
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
          await prepareManagedTextWrite(
            plan,
            resolveManagedPath(directory, file, 'Managed package WASI file'),
            managedWasiRenames,
            managedPackageRenames,
          )
        }
      }
      if (managedPackageRenames.size > 0) {
        await prepareManagedPackageReadme(
          plan,
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
      const path = await resolveProjectEntry(
        projectRoot,
        updatedEntry,
        'Managed root entry',
      )
      if (path) {
        await prepareManagedTextWrite(
          plan,
          path,
          managedWasiRenames,
          managedPackageRenames,
        )
      }
    }

    if (managedWasiRenames.size > 0) {
      await prepareManagedTextWrite(
        plan,
        resolveManagedPath(
          projectRoot,
          '.gitattributes',
          'Managed .gitattributes file',
        ),
        managedWasiRenames,
        new Map(),
      )
    }
  }

  await executeRenameTransaction(projectRoot, plan, failPhase)
}

export async function renameProject(userOptions: RenameOptions) {
  const failPhase = (userOptions as RenameTestOptions).__testFailCommitPhase
  const options = applyDefaultRenameOptions(userOptions)
  const reconciliationRoot = getPackageReconciliationRoot(
    options.cwd,
    options.packageJsonPath,
  )
  return withFileSystemReconciliation(reconciliationRoot, () =>
    renameProjectUnlocked(options, failPhase),
  )
}
