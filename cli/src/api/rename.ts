import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

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
  writeFileAsync,
} from '../utils/index.js'

const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'

function createManagedWasiRenames(
  oldName: string,
  newName: string,
  targets: Target[],
) {
  const renames = new Map<string, string>()
  const add = (suffix: string) => {
    renames.set(`${oldName}.${suffix}`, `${newName}.${suffix}`)
  }
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
  return renames
}

function replaceManagedWasiReferences(
  content: string,
  renames: Map<string, string>,
) {
  if (renames.size === 0) {
    return content
  }
  const pattern = new RegExp(
    [...renames.keys()]
      .sort((left, right) => right.length - left.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'g',
  )
  return content.replace(pattern, (name) => renames.get(name)!)
}

async function renameManagedWasiFiles(
  directory: string,
  renames: Map<string, string>,
) {
  for (const [oldFile, newFile] of renames) {
    const oldPath = join(directory, oldFile)
    if (existsSync(oldPath)) {
      await rename(oldPath, join(directory, newFile))
    }
  }
}

async function rewriteManagedWasiReferences(
  path: string,
  renames: Map<string, string>,
) {
  if (!existsSync(path) || path.endsWith('.wasm')) {
    return
  }
  const content = await readFileAsync(path, 'utf8')
  const updated = replaceManagedWasiReferences(content, renames)
  if (updated !== content) {
    await writeFileAsync(path, updated)
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

export async function renameProject(userOptions: RenameOptions) {
  const options = applyDefaultRenameOptions(userOptions)
  const napiConfig = await readConfig(options)
  const oldName = napiConfig.binaryName
  const managedWasiRenames =
    options.binaryName && oldName !== options.binaryName
      ? createManagedWasiRenames(
          oldName,
          options.binaryName,
          napiConfig.targets,
        )
      : new Map<string, string>()

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)
  const cargoTomlPath = resolve(options.cwd, options.manifestPath)

  const packageJsonContent = await readFileAsync(packageJsonPath, 'utf8')
  const packageJsonData = JSON.parse(packageJsonContent)

  merge(
    merge(
      packageJsonData,
      omitBy(
        // @ts-expect-error missing fields: author and license
        pick(options, ['name', 'description', 'author', 'license']),
        isNil,
      ),
    ),
    {
      napi: omitBy(
        {
          binaryName: options.binaryName,
          packageName: options.packageName,
        },
        isNil,
      ),
    },
  )

  if (options.repository) {
    if (
      packageJsonData.repository &&
      typeof packageJsonData.repository === 'object' &&
      !Array.isArray(packageJsonData.repository)
    ) {
      packageJsonData.repository.url = options.repository
    } else {
      packageJsonData.repository = options.repository
    }
  }

  if (options.configPath) {
    const configPath = resolve(options.cwd, options.configPath)
    const configContent = await readFileAsync(configPath, 'utf8')
    const configData = JSON.parse(configContent)
    merge(
      configData,
      omitBy(
        {
          binaryName: options.binaryName,
          packageName: options.packageName,
        },
        isNil,
      ),
    )
    await writeFileAsync(configPath, JSON.stringify(configData, null, 2))
  }

  await writeFileAsync(
    packageJsonPath,
    replaceManagedWasiReferences(
      JSON.stringify(packageJsonData, null, 2),
      managedWasiRenames,
    ),
  )

  const tomlContent = await readFileAsync(cargoTomlPath, 'utf8')
  const cargoToml = parseToml(tomlContent) as any

  // Update the package name
  if (cargoToml.package && options.binaryName) {
    // Sanitize the binary name for Rust package naming conventions
    const sanitizedName = options.binaryName
      .replace('@', '')
      .replace('/', '_')
      .replace(/-/g, '_')
      .toLowerCase()
    cargoToml.package.name = sanitizedName
  }

  // Stringify the updated TOML
  const updatedTomlContent = stringifyToml(cargoToml)

  await writeFileAsync(cargoTomlPath, updatedTomlContent)
  if (options.binaryName && oldName !== options.binaryName) {
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
          githubActionsData.env.APP_NAME = options.binaryName
          await writeFileAsync(
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

    const managedRootEntryNames = new Set<string>()
    for (const field of ['main', 'module', 'browser', 'types'] as const) {
      const entry = packageJsonData[field]
      if (typeof entry === 'string') {
        managedRootEntryNames.add(entry)
      }
    }
    for (const oldFile of managedWasiRenames.keys()) {
      if (!oldFile.endsWith('.cjs')) {
        continue
      }
      const loaderPath = join(options.cwd, oldFile)
      if (existsSync(loaderPath)) {
        for (const entry of managedRootEntries(
          await readFileAsync(loaderPath, 'utf8'),
        )) {
          managedRootEntryNames.add(entry)
        }
      }
    }

    const managedDirectories = new Set([options.cwd])
    for (const target of napiConfig.targets) {
      if (target.platform === 'wasi') {
        managedDirectories.add(
          resolve(options.cwd, options.npmDir, target.platformArchABI),
        )
      }
    }
    for (const directory of managedDirectories) {
      if (!existsSync(directory)) {
        continue
      }
      await renameManagedWasiFiles(directory, managedWasiRenames)
      for (const newFile of managedWasiRenames.values()) {
        await rewriteManagedWasiReferences(
          join(directory, newFile),
          managedWasiRenames,
        )
      }
      await rewriteManagedWasiReferences(
        join(directory, 'package.json'),
        managedWasiRenames,
      )
    }

    for (const entry of managedRootEntryNames) {
      const path = resolveProjectEntry(
        options.cwd,
        replaceManagedWasiReferences(entry, managedWasiRenames),
      )
      if (path) {
        await rewriteManagedWasiReferences(path, managedWasiRenames)
      }
    }

    const gitAttributesPath = join(options.cwd, '.gitattributes')
    await rewriteManagedWasiReferences(gitAttributesPath, managedWasiRenames)
  }
}
