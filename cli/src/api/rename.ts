import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'

import { parse as parseToml, stringify as stringifyToml } from '@std/toml'
import { load as yamlParse, dump as yamlStringify } from 'js-yaml'
import { isNil, merge, omitBy, pick } from 'es-toolkit'
import { findUp } from 'find-up'

import { applyDefaultRenameOptions, RenameOptions } from '../def/rename.js'
import { readConfig, readFileAsync, writeFileAsync } from '../utils/index.js'

export async function renameProject(userOptions: RenameOptions) {
  const options = applyDefaultRenameOptions(userOptions)
  const napiConfig = await readConfig(options)
  const oldName = napiConfig.binaryName

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

  if (options.configPath) {
    const configPath = resolve(options.cwd, options.configPath)
    const configContent = await readFileAsync(configPath, 'utf8')
    const configData = JSON.parse(configContent)
    configData.binaryName = options.binaryName
    configData.packageName = options.packageName
    await writeFileAsync(configPath, JSON.stringify(configData, null, 2))
  }

  await writeFileAsync(
    packageJsonPath,
    JSON.stringify(packageJsonData, null, 2),
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
  if (oldName !== options.binaryName) {
    const githubActionsPath = await findUp('.github', {
      cwd: options.cwd,
      type: 'directory',
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
    const oldWasiBrowserBindingPath = join(
      options.cwd,
      `${oldName}.wasi-browser.js`,
    )
    if (existsSync(oldWasiBrowserBindingPath)) {
      await rename(
        oldWasiBrowserBindingPath,
        join(options.cwd, `${options.binaryName}.wasi-browser.js`),
      )
    }
    const oldWasiBindingPath = join(options.cwd, `${oldName}.wasi.cjs`)
    if (existsSync(oldWasiBindingPath)) {
      await rename(
        oldWasiBindingPath,
        join(options.cwd, `${options.binaryName}.wasi.cjs`),
      )
    }
    const gitAttributesPath = join(options.cwd, '.gitattributes')
    if (existsSync(gitAttributesPath)) {
      const gitAttributesContent = await readFileAsync(
        gitAttributesPath,
        'utf8',
      )
      const gitAttributesData = gitAttributesContent
        .split('\n')
        .map((line) => {
          return line
            .replace(
              `${oldName}.wasi-browser.js`,
              `${options.binaryName}.wasi-browser.js`,
            )
            .replace(`${oldName}.wasi.cjs`, `${options.binaryName}.wasi.cjs`)
        })
        .join('\n')
      await writeFileAsync(gitAttributesPath, gitAttributesData)
    }
  }
}
